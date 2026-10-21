import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import next from "next";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { authRouteMethods } from "../../src/server/http/auth";
import { portalRouteMethods } from "../../src/server/http/portal";
import { sourceAssignmentsRouteMethods } from "../../src/server/http/source-assignments";
import { honorsRouteMethods } from "../../src/server/http/honors";
import { honoreeManagementRouteMethods } from "../../src/server/http/honoree";
import { sourceContentRouteMethods } from "../../src/server/http/source-content";
import { serviceLearningRouteMethods } from "../../src/server/http/service-learning";
import { serviceEcosystemRouteMethods } from "../../src/server/http/service-ecosystem";
import { referenceReviewRouteMethods } from "../../src/server/http/reference-review";
import { studentWorkRouteMethods } from "../../src/server/http/student-work";
import { progressRouteMethods } from "../../src/server/http/progress";
import { lessonLogRouteMethods } from "../../src/server/http/lesson-log";
import { practiceCalendarRouteMethods } from "../../src/server/http/practice-calendar";
import { closeNextDevelopment } from "./next-lifecycle";

export const BROWSER_PORT = 3187;
export const BROWSER_ORIGIN = `http://127.0.0.1:${BROWSER_PORT}`;
const critical = new Set(["host", "cookie", "origin", "content-type", "content-length", "transfer-encoding", "authorization",
  "x-practice-context", "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "sec-fetch-site"]);

export function assertBrowserStartupAllowed() {
  const env = process.env;
  if (env.HTTP_BROWSER_TEST !== "1" || env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV || env.CI_DEPLOYMENT || env.DEPLOYMENT_ID)
    throw new Error("Isolated browser server startup denied");
}

async function isolatedNextProject() {
  const source = process.cwd(), logRoot = resolve(source, ".local-logs");
  await mkdir(logRoot, { recursive: true });
  const dir = await mkdtemp(join(logRoot, "http-browser-project-"));
  if (!resolve(dir).startsWith(`${logRoot}${sep}`)) throw new Error("Isolated Next directory escaped workspace");
  try {
    await cp(join(source, "src"), join(dir, "src"), { recursive: true });
    for (const [family, font] of [["noto-serif-hebrew", "NotoSerifHebrew.ttf"], ["bricolage-grotesque", "BricolageGrotesque.ttf"]]) {
      const fontDirectory = join("public", "fonts", family);
      await mkdir(join(dir, fontDirectory), { recursive: true });
      for (const file of [font, "OFL.txt"]) await cp(join(source, fontDirectory, file), join(dir, fontDirectory, file));
    }
    for (const file of ["package.json", "next.config.ts", "tsconfig.json"]) await cp(join(source, file), join(dir, file));
    return { dir };
  } catch {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    throw new Error("Isolated Next project setup failed");
  }
}

function safeRequest(req: IncomingMessage): Request | null {
  if (!req.url?.startsWith("/") || req.url.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(req.url) || req.url.length > 2048) return null;
  const rawPath = req.url.split("?", 1)[0];
  if (/%(?:2e|2f|5c|25)/i.test(rawPath) || rawPath.split("/").includes("..") || rawPath.includes("//")) return null;
  const counts = new Map<string, number>();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if ([...critical].some(key => (counts.get(key) ?? 0) > 1) || (counts.get("transfer-encoding") && counts.get("content-length"))
    || req.headers.host !== `127.0.0.1:${BROWSER_PORT}`) return null;
  const url = new URL(req.url, BROWSER_ORIGIN);
  if (url.origin !== BROWSER_ORIGIN || url.username || url.password || url.hash) return null;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) { for (const part of value) headers.append(name, part); }
    else headers.set(name, value);
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req) as ReadableStream<Uint8Array>;
  return new Request(url, { method: req.method, headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) if (name !== "set-cookie") res.setHeader(name, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  if (response.body) for await (const chunk of Readable.fromWeb(response.body as never)) res.write(chunk);
  res.end();
}

export async function startBrowserServer(withRuntime: HttpRuntimeScope) {
  // This bootstrap never belongs to the Next production import graph.
  assertBrowserStartupAllowed();
  // Pinned Next's custom-server prepare() drops `conf`; a private project
  // gives its compiler its own tsconfig and .next without production branches.
  const project = await isolatedNextProject();
  const app = next({ dev: true, dir: project.dir, hostname: "127.0.0.1", port: BROWSER_PORT, quiet: true });
  try { await app.prepare(); }
  catch { await closeNextDevelopment(() => app.close()); throw new Error("Isolated Next preparation failed"); }
  const nextHandler = app.getRequestHandler();
  const dispatch = createHttpDispatcher(withRuntime);
  const server = createServer(async (req, res) => {
    try {
      const request = safeRequest(req);
      if (!request) { await send(res, new Response(null, { status: 400 })); return; }
      const pathname = new URL(request.url).pathname;
      if (referenceReviewRouteMethods(pathname)) { await send(res, await dispatch(request)); return; }
      if (!serviceEcosystemRouteMethods(pathname) && !honoreeManagementRouteMethods(pathname) && !honorsRouteMethods(pathname) && !sourceContentRouteMethods(pathname) && !sourceAssignmentsRouteMethods(pathname) && !authRouteMethods(pathname) && !portalRouteMethods(pathname) && !studentWorkRouteMethods(pathname) && !serviceLearningRouteMethods(pathname) && !progressRouteMethods(pathname) && !lessonLogRouteMethods(pathname) && !practiceCalendarRouteMethods(pathname)) { await nextHandler(req, res); return; }
      await send(res, await dispatch(request));
    } catch { if (!res.headersSent) await send(res, new Response(null, { status: 503 })); else res.destroy(); }
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(BROWSER_PORT, "127.0.0.1", resolve); });
  } catch { await closeNextDevelopment(() => app.close()); throw new Error("Isolated browser server listen failed"); }
  return async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeNextDevelopment(() => app.close());
    // NextCustomServer.close and AsyncCallbackSet.runAll use allSettled: a
    // resolved close is not proof that native cleanup succeeded. Retain this
    // ignored, synthetic-only copy rather than deleting live Turbopack .sst files.
    // Copy failures before Next starts are still cleaned in isolatedNextProject.
  };
}
