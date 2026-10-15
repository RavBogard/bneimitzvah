"""Cloud renderer for the trope engine: SoulX-Singer on Modal GPUs (renderer ladder step 2, remote).

Driven by scripts/trope-render.mjs --backend modal, which writes the same jobs.json the local runner reads
and then runs:
    modal run trope/modal_render.py::render --jobs <jobs.json>
Nothing here scores or fetches text; it only turns finished SoulX metadata into WAVs. The inference path
is trope/soulx_runner.py's load() and render_one(), the same code the local CLI uses (score control, no
auto_shift, pitch_shift 0, fp16 by default), so local and cloud renders differ only by GPU numerics.

One-time setup (see docs/superpowers/plans/2026-10-15-trope-cloud-render.md):
    pip install modal            # into its own venv, not soulx-env
    modal token new
    modal run trope/modal_render.py::download_weights    # optional: render also does this on first use

Knobs (environment, read when the app module loads, locally and in the container):
    SOULX_MODAL_GPU          GPU type string (default "L4"; "A10", "L40S", "A100-40GB", "A100-80GB", "T4"...)
    SOULX_MODAL_CONCURRENCY  max GPU containers running at once (default 10)
    SOULX_MODAL_FP16         "1" (default, matches local) or "0" for fp32; on Ampere or newer, bf16 is
                             also fine but this script keeps fp16 so renders match the local ones
Per-run flags on the entrypoint: --per-call N (verses per GPU call, default 3), --no-fp16.

The checkpoint (2.8 GB) is downloaded from Hugging Face once into the private Modal Volume
"soulx-singer-weights" in the user's workspace. It is not in the image and not public. The prompt wav and
the metadata travel to the container as call arguments and are not stored; rendered WAVs return to the
caller and are written to the local out folder.
"""
import json
import os
import tempfile
import time

import modal

APP_NAME = "haftarah-soulx"
SOULX_REPO = "https://github.com/Soul-AILab/SoulX-Singer"
SOULX_COMMIT = "81aeb3ae772c70093c3de74dc23c92d983801ae4"
HF_REPO = "Soul-AILab/SoulX-Singer"
HF_FILE = "model.pt"
REPO_DIR = "/opt/SoulX-Singer"
WEIGHTS_DIR = "/weights"
MODEL_PATH = f"{WEIGHTS_DIR}/{HF_FILE}"
MODEL_BYTES = 2_818_092_278  # the checkpoint the local runs use; a short download is an error

GPU = os.environ.get("SOULX_MODAL_GPU", "L4")
MAX_CONTAINERS = int(os.environ.get("SOULX_MODAL_CONCURRENCY", "10"))
FP16_DEFAULT = os.environ.get("SOULX_MODAL_FP16", "1") != "0"

# Same pins as C:\Users\dsbog\haftarah-audio\soulx-env\requirements.lock.txt, minus Windows-only colorama
# and the torch pair, which come from the cu121 index (Linux wheel 2.2.0+cu121, the same build).
PINS = """
accelerate==1.15.0
audioread==3.1.0
certifi==2026.7.22
cffi==2.1.1
charset-normalizer==3.5.2
cloudpickle==3.1.2
decorator==5.3.1
filelock==3.32.3
fsspec==2026.7.0
huggingface_hub==0.36.2
idna==3.20
Jinja2==3.1.6
joblib==1.6.0
lazy-loader==0.6
librosa==0.11.0
llvmlite==0.50.0
MarkupSafe==3.0.3
mpmath==1.3.0
msgpack==1.2.3
narwhals==2.27.1
networkx==3.6.1
numba==0.68.0
numpy==1.26.4
omegaconf==2.4.0
packaging==26.3
platformdirs==4.13.0
pooch==1.9.0
psutil==7.2.2
pycparser==3.11
PyYAML==6.0.3
regex==2026.9.29
requests==2.34.2
safetensors==0.8.0
scikit-learn==1.9.1
scipy==1.17.1
soundfile==0.14.0
soxr==1.1.0
sympy==1.14.0
threadpoolctl==3.7.0
tokenizers==0.19.1
tqdm==4.70.1
transformers==4.41.2
typing_extensions==4.16.0
urllib3==2.8.0
""".split()

HERE = os.path.dirname(os.path.abspath(__file__))

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libsndfile1")
    .pip_install("torch==2.2.0", "torchaudio==2.2.0", index_url="https://download.pytorch.org/whl/cu121")
    .pip_install(*PINS)
    .run_commands(
        f"git init {REPO_DIR}",
        f"git -C {REPO_DIR} remote add origin {SOULX_REPO}",
        f"git -C {REPO_DIR} fetch --depth 1 origin {SOULX_COMMIT}",
        f"git -C {REPO_DIR} checkout FETCH_HEAD",
        f"test \"$(git -C {REPO_DIR} rev-parse HEAD)\" = {SOULX_COMMIT}",
    )
    .env({"PYTHONUTF8": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
    # Last, so editing the runner does not rebuild the image: the shared inference code, importable as soulx_runner.
    .add_local_file(os.path.join(HERE, "soulx_runner.py"), "/root/soulx_runner.py")
)

weights = modal.Volume.from_name("soulx-singer-weights", create_if_missing=True)
app = modal.App(APP_NAME, image=image)


@app.function(volumes={WEIGHTS_DIR: weights}, timeout=3600)
def download_weights(force: bool = False) -> dict:
    """Fetch model.pt from Hugging Face into the private volume, once. Idempotent."""
    weights.reload()
    if os.path.exists(MODEL_PATH) and os.path.getsize(MODEL_PATH) == MODEL_BYTES and not force:
        return {"downloaded": False, "bytes": os.path.getsize(MODEL_PATH)}
    from huggingface_hub import hf_hub_download

    t0 = time.time()
    hf_hub_download(repo_id=HF_REPO, filename=HF_FILE, local_dir=WEIGHTS_DIR)
    size = os.path.getsize(MODEL_PATH)
    if size != MODEL_BYTES:
        raise RuntimeError(f"{MODEL_PATH} is {size} bytes, expected {MODEL_BYTES}: partial or changed download")
    weights.commit()
    return {"downloaded": True, "bytes": size, "seconds": round(time.time() - t0, 1)}


@app.cls(gpu=GPU, volumes={WEIGHTS_DIR: weights}, max_containers=MAX_CONTAINERS, timeout=3600,
         scaledown_window=60, retries=1)
class Renderer:
    """One resident SoulX model per container; each call renders a few verses with it."""
    fp16: bool = modal.parameter(default=FP16_DEFAULT)

    @modal.enter()
    def start(self):
        import soulx_runner

        spec = {
            "repo": REPO_DIR, "model": MODEL_PATH,
            "config": f"{REPO_DIR}/soulxsinger/config/soulxsinger.yaml",
            "phoneset": f"{REPO_DIR}/soulxsinger/utils/phoneme/phone_set.json",
            "prompt_wav": "", "prompt_meta": "",  # set per call
            "device": "cuda", "fp16": self.fp16,
        }
        if not os.path.exists(MODEL_PATH):
            raise RuntimeError(f"{MODEL_PATH} missing: run `modal run trope/modal_render.py::download_weights` first")
        t0 = time.time()
        self.runner = soulx_runner
        self.ctx = soulx_runner.load(spec)
        self.load_s = round(time.time() - t0, 1)

    @modal.method()
    def render(self, call: dict) -> list:
        """call = {prompt_wav: bytes, prompt_ext: ".mp3", prompt_meta: str,
                   settings: {control, n_steps, cfg, post}, jobs: [{i: int, meta: str}]}  ->  [{i, wav: bytes|None, seconds, render_s, error?, load_s}]"""
        import traceback

        tmp = tempfile.mkdtemp(prefix="job_")
        pw = os.path.join(tmp, "prompt" + call.get("prompt_ext", ".wav"))
        pm = os.path.join(tmp, "prompt.json")
        with open(pw, "wb") as f:
            f.write(call["prompt_wav"])
        with open(pm, "w", encoding="utf-8") as f:
            f.write(call["prompt_meta"])
        self.ctx.prompt_wav_path, self.ctx.prompt_metadata_path = pw, pm
        self.runner.apply_settings(self.ctx, call.get("settings") or {})
        out = []
        for job in call["jobs"]:
            meta = os.path.join(tmp, f"meta-{job['i']}.json")
            wav = os.path.join(tmp, f"out-{job['i']}.wav")
            with open(meta, "w", encoding="utf-8") as f:
                f.write(job["meta"])
            try:
                seconds, wall = self.runner.render_one(self.ctx, meta, wav)
                with open(wav, "rb") as f:
                    data = f.read()
                out.append({"i": job["i"], "wav": data, "seconds": round(seconds, 3), "render_s": round(wall, 1),
                            "load_s": self.load_s})
            except Exception as e:  # one bad verse must not cost the others in the call
                traceback.print_exc()
                out.append({"i": job["i"], "wav": None, "error": f"{type(e).__name__}: {e}", "render_s": 0,
                            "load_s": self.load_s})
        return out


def chunk(seq, n):
    return [seq[k:k + max(1, n)] for k in range(0, len(seq), max(1, n))]


def emit(obj):
    # Same "@@ {json}" protocol as soulx_runner.py, so scripts/trope-render.mjs parses both backends alike.
    print("@@ " + json.dumps(obj), flush=True)


@app.local_entrypoint()
def render(jobs: str, per_call: int = 3, no_fp16: bool = False):
    """Render every job in a jobs.json written by scripts/trope-render.mjs; write each WAV to its job["wav"].

    The jobs file is the local runner's: {prompt_wav, prompt_meta, jobs: [{meta, wav}], ...}. A batch of
    readings shares one file (one prompt, many jobs), so all of them fan out over the same containers."""
    with open(jobs, encoding="utf-8") as f:
        spec = json.load(f)
    pwav, pmeta = spec["prompt_wav"], spec["prompt_meta"]
    with open(pwav, "rb") as f:
        wav_bytes = f.read()
    with open(pmeta, encoding="utf-8") as f:
        meta_text = f.read()
    ext = os.path.splitext(pwav)[1] or ".wav"

    job_list = spec["jobs"]
    items = []
    for i, j in enumerate(job_list):
        with open(j["meta"], encoding="utf-8") as f:
            items.append({"i": i, "meta": f.read()})
    settings = {k: spec.get(k) for k in ("control", "n_steps", "cfg", "post")}
    calls = [{"prompt_wav": wav_bytes, "prompt_ext": ext, "prompt_meta": meta_text, "settings": settings, "jobs": c}
             for c in chunk(items, per_call)]

    info = download_weights.remote()  # no-op after the first run
    emit({"event": "weights", **info})
    emit({"event": "plan", "gpu": GPU, "max_containers": MAX_CONTAINERS, "verses": len(items), "calls": len(calls),
          "fp16": FP16_DEFAULT and not no_fp16})

    renderer = Renderer(fp16=FP16_DEFAULT and not no_fp16)
    loaded = 0.0
    t0 = time.time()
    # unordered: results stream back as calls finish, each verse reported (and written) as soon as it lands
    for results in renderer.render.map(calls, order_outputs=False, return_exceptions=True):
        if isinstance(results, BaseException):
            emit({"event": "call_error", "error": f"{type(results).__name__}: {results}"})
            continue
        for r in results:
            loaded = max(loaded, r.get("load_s", 0))
            data = r.pop("wav", None)
            dest = job_list[r["i"]]["wav"]
            if data is not None:
                os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
                with open(dest, "wb") as f:
                    f.write(data)
                r["wav"] = dest
            else:
                r["wav"] = None
            r.pop("load_s", None)
            emit({"event": "verse", **r})
    emit({"event": "loaded", "load_s": loaded})
    emit({"event": "remote_wall", "seconds": round(time.time() - t0, 1)})
    # A verse whose call raised never reports; the Node side marks it missing from the manifest and exits 1.
