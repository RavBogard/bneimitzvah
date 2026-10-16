// Restrict unexpected test-process fetches. Browser traffic has an additional
// Playwright route guard; SDK mail and reading transports are injected locally.
export function installLoopbackFetchGuard() {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input)); }
    catch { return Promise.reject(new Error("Nonloopback fetch denied")); }
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname))
      return Promise.reject(new Error("Nonloopback fetch denied"));
    // No implicit hop may escape the initial URL check, including a provider
    // redirect reached through an otherwise acceptable loopback endpoint.
    return original(input, { ...init, redirect: "error" });
  };
  return () => { globalThis.fetch = original; };
}
