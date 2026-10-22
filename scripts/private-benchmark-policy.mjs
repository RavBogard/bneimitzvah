// Public code may name these schemas; schema-bearing data must remain private.
const LITERAL_SCHEMA = /"schema"\s*:\s*"chant-(?:benchmark-(?:input|pack|identity|run)|human-[a-z0-9-]+|listening-[a-z0-9-]+)\//;
const DECODED_SCHEMA = /^chant-(?:benchmark-(?:input|pack|identity|run)|human-[a-z0-9-]+|listening-[a-z0-9-]+)\//;
// Index v2 (refined word boundaries) carries the same source text as v1, so it is equally private.
// Cantor Finkel's private package catalog, its playback manifest and upload plan are private too.
const REFERENCE_LITERAL_SCHEMA = /"schema"\s*:\s*"(?:pockettorah-verse-index\/v[12]|(?:reference-catalog|finkel-prepared-catalog|finkel-reference-manifest|finkel-reference-upload-plan)\/v1)"/;
const REFERENCE_SCHEMAS = new Set(["pockettorah-verse-index/v1", "pockettorah-verse-index/v2", "reference-catalog/v1", "finkel-prepared-catalog/v1", "finkel-reference-manifest/v1", "finkel-reference-upload-plan/v1"]);
export const PRIVATE_BENCHMARK_REASON = "private chant-benchmark record";
export const PRIVATE_REFERENCE_INDEX_REASON = "private reference-audio index";
export const PRIVATE_BENCHMARK_BUDGET_REASON = "private benchmark inspection budget exceeded";
export const PRIVATE_BENCHMARK_LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxDepth: 64, maxNodes: 100_000 });

// A nonrecursive lexical depth bound precedes decoding. Brackets inside JSON
// strings and escaped quotes do not count. Invalid data may conservatively hit
// this bound; no exception or snippet from the candidate crosses the boundary.
function tooDeep(text) {
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > PRIVATE_BENCHMARK_LIMITS.maxDepth) return true;
    } else if (char === "}" || char === "]") depth--;
  }
  return false;
}

/** Return only fixed findings. Called once by entryProblems for each content
 * version, so candidate/index/font-notice paths share the same policy. The data
 * flag controls the inherited malformed literal rule and line-JSON fallback.
 * Whole JSON objects/arrays are also recognized under source extensions. */
export function privateBenchmarkProblem(text, data = false) {
  if (data && LITERAL_SCHEMA.test(text)) return PRIVATE_BENCHMARK_REASON;
  if (data && REFERENCE_LITERAL_SCHEMA.test(text)) return PRIVATE_REFERENCE_INDEX_REASON;
  // Common UTF-8 exports may carry a leading BOM. Remove framing only for
  // inspection, never quoted/content BOMs; the original bytes still set bounds.
  const inspectionText = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (!data && !/^[ \t\r\n]*[\[{]/.test(inspectionText)) return null;
  if (Buffer.byteLength(text, "utf8") > PRIVATE_BENCHMARK_LIMITS.maxBytes || tooDeep(inspectionText)) return PRIVATE_BENCHMARK_BUDGET_REASON;

  let nodes = 0;
  function inspect(value) {
    const stack = [{ value, depth: 0 }];
    if (++nodes > PRIVATE_BENCHMARK_LIMITS.maxNodes) return PRIVATE_BENCHMARK_BUDGET_REASON;
    while (stack.length) {
      const item = stack.pop();
      if (item.depth > PRIVATE_BENCHMARK_LIMITS.maxDepth) return PRIVATE_BENCHMARK_BUDGET_REASON;
      if (!item.value || typeof item.value !== "object") continue;
      if (Object.hasOwn(item.value, "schema") && typeof item.value.schema === "string" && DECODED_SCHEMA.test(item.value.schema)) return PRIVATE_BENCHMARK_REASON;
      if (Object.hasOwn(item.value, "schema") && REFERENCE_SCHEMAS.has(item.value.schema)) return PRIVATE_REFERENCE_INDEX_REASON;
      const keys = Object.keys(item.value);
      nodes += keys.length;
      if (nodes > PRIVATE_BENCHMARK_LIMITS.maxNodes) return PRIVATE_BENCHMARK_BUDGET_REASON;
      for (const key of keys) stack.push({ value: item.value[key], depth: item.depth + 1 });
    }
    return null;
  }
  try { return inspect(JSON.parse(inspectionText)); }
  catch {
    if (!data) return null;
    // One bad line must not hide a separately valid private record. Total bytes,
    // depth and traversal nodes remain bounded across the entire candidate.
    for (const rawLine of inspectionText.split(/\r?\n/)) {
      const line = rawLine.startsWith("\uFEFF") ? rawLine.slice(1) : rawLine;
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      const problem = inspect(value);
      if (problem) return problem;
    }
    return null;
  }
}
