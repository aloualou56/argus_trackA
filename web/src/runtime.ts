// Settings the page gets from where it is served, not from the build: the same web/dist works on a
// public host and on the class server (tools/class_server.py), which adds a small script to
// index.html: window.__GUARDIAN__ = { store: "lan", localOnly: true, publicUrl: "http://..." }.

export interface RuntimeConfig {
  /** "lan": the server that sent this page also keeps the class's records (see README "Class server"). */
  store: "lan" | null;
  /** Ask nothing from outside this server: no satellite or street-map pictures, no cloud store. */
  localOnly: boolean;
  /** The address students can reach on the school network, when the class server knows it. */
  publicUrl: string | null;
}

declare global {
  interface Window {
    __GUARDIAN__?: unknown;
  }
}

/** Pure: `injected` is window.__GUARDIAN__, `search` the page's query string, `buildFlag` VITE_LOCAL_ONLY. */
export function readRuntime(injected: unknown, search = "", buildFlag?: string): RuntimeConfig {
  const given = injected && typeof injected === "object" ? (injected as Record<string, unknown>) : {};
  const publicUrl = typeof given.publicUrl === "string" && /^https?:\/\//.test(given.publicUrl) ? given.publicUrl : null;
  return {
    store: given.store === "lan" ? "lan" : null,
    localOnly: given.localOnly === true || buildFlag === "1" || new URLSearchParams(search).has("local"),
    publicUrl: publicUrl && (publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`),
  };
}

let cached: RuntimeConfig | null = null;

export function runtimeConfig(): RuntimeConfig {
  cached ??= readRuntime(window.__GUARDIAN__, window.location.search, import.meta.env.VITE_LOCAL_ONLY);
  return cached;
}
