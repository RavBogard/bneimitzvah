import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { HttpBoundaryError, privateJson } from "./responses";
import { requireCookieMutation } from "./mutations";
import { closedObject, uniqueQuery } from "./query";
import { PRODUCTION_ORIGINS } from "../runtime/config";

const LIFETIME = 10 * 60_000;
const localName = "portal_pending_invitation";
const secureName = "__Host-portal_pending_invitation";
const tokenValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
  && Buffer.from(value, "base64url").length === 32 && Buffer.from(value, "base64url").toString("base64url") === value;

export function createPendingInvitations(input: { secret: string; origin: string; environment: "production" | "preview" | "local"; now?: () => number }) {
  const configuredOrigin = input.origin;
  let key: Buffer;
  let name: string;
  let secure: boolean;
  try {
    if (typeof input.secret !== "string" || input.secret.length < 32 || input.secret.length > 512 || /[\s\x00-\x1f\x7f]/.test(input.secret)) throw 0;
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.username || origin.password || !/^[a-z0-9.-]+$/.test(origin.hostname)) throw 0;
    const local = input.environment === "local";
    if (!["production", "preview", "local"].includes(input.environment)) throw 0;
    if (local ? !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname) && origin.port)
      : !(origin.protocol === "https:" && !origin.port && !/^\d+(?:\.\d+){3}$/.test(origin.hostname) && origin.hostname !== "localhost" && !origin.hostname.endsWith(".localhost"))) throw 0;
    if (input.environment === "production" && !PRODUCTION_ORIGINS.includes(input.origin)) throw 0;
    if (input.environment === "preview" && PRODUCTION_ORIGINS.includes(input.origin)) throw 0;
    secure = !local; name = secure ? secureName : localName;
    key = createHmac("sha256", input.secret).update(`crc-portal:v1:pending-invitations:${input.environment}:${input.origin}`).digest();
  } catch { throw new Error("Pending invitation configuration unavailable"); }
  const now = input.now ?? Date.now;
  const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - LIFETIME) throw 0; return value; };
  const cookie = (value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const requestUrl = (request: Request, allowed: readonly string[]) => {
    if (request.headers.has("X-Practice-Context")) throw 0;
    const query = uniqueQuery(request.url, allowed);
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (url.origin !== configuredOrigin || (host !== null && host !== url.host)) throw 0;
    return { url, query };
  };
  const unseal = (request: Request): string => {
    const header = request.headers.get("cookie");
    if (!header || Buffer.byteLength(header) > 16 * 1024) throw 0;
    const values = new Map<string, string>();
    for (const part of header.split(";")) {
      const pair = part.trim();
      if (!pair) continue;
      const equal = pair.indexOf("=");
      const cookieName = pair.slice(0, equal);
      if (equal < 1 || !/^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/.test(cookieName) || values.has(cookieName)) throw 0;
      values.set(cookieName, pair.slice(equal + 1));
    }
    if (values.has(secure ? localName : secureName)) throw 0;
    const sealed = values.get(name);
    if (!sealed || sealed.length > 2048 || !/^v1\.[A-Za-z0-9_-]+$/.test(sealed)) throw 0;
    const encoded = sealed.slice(3);
    const packed = Buffer.from(encoded, "base64url");
    if (packed.toString("base64url") !== encoded || packed.length < 29) throw 0;
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(configuredOrigin));
    decipher.setAuthTag(packed.subarray(-16));
    const plaintext = Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()]).toString("utf8");
    const body = closedObject(JSON.parse(plaintext), ["version", "token", "origin", "issuedAt", "expiresAt"]);
    const current = time();
    if (body.version !== 1 || body.origin !== configuredOrigin || !tokenValid(body.token) || !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt)
      || Number(body.issuedAt) < 0 || Number(body.issuedAt) > current || Number(body.expiresAt) <= current || Number(body.expiresAt) - Number(body.issuedAt) !== LIFETIME) throw 0;
    return body.token;
  };
  return Object.freeze({
    exchange(request: Request, token: unknown): Response {
      try {
        const { url } = requestUrl(request, []);
        requireCookieMutation(request, configuredOrigin);
        if (request.method !== "POST" || url.pathname !== "/api/invitations/open" || !tokenValid(token)) throw 0;
        const issuedAt = time();
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(Buffer.from(configuredOrigin));
        const plaintext = JSON.stringify({ version: 1, token, origin: configuredOrigin, issuedAt, expiresAt: issuedAt + LIFETIME });
        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const sealed = `v1.${Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64url")}`;
        const response = privateJson({ ok: true, next: "/invitations/accept" });
        response.headers.append("set-cookie", cookie(sealed, LIFETIME / 1000));
        return response;
      } catch { throw new HttpBoundaryError(404); }
    },
    read(request: Request): string {
      try {
        const { url } = requestUrl(request, []);
        if (!((request.method === "GET" && url.pathname === "/api/invitations/pending") || (request.method === "POST" && url.pathname === "/api/invitations/accept"))) throw 0;
        return unseal(request);
      } catch { throw new HttpBoundaryError(404); }
    },
    hasPendingForSignIn(request: Request): boolean {
      try {
        const { url } = requestUrl(request, []);
        if (request.method !== "POST" || !["/api/auth/sign-in/magic-link", "/api/auth/sign-in/code", "/api/auth/email/confirm", "/api/auth/google/challenge", "/api/auth/google/redirect"].includes(url.pathname)) return false;
        unseal(request); return true;
      } catch { return false; }
    },
    clear(): string { return cookie("", 0); },
  });
}
