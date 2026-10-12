import { runtimeConfig } from "../runtime";
import { LanCommunityStore, LocalCommunityStore, SharedWithFallback, SupabaseCommunityStore, type CommunityStore } from "./store";

/**
 * The store the game uses:
 * - served by tools/class_server.py: records go to that server, on the teacher's computer;
 * - built with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README): shared by everyone;
 * - otherwise, or in local-only mode without a class server: they stay on this device.
 */
export function createCommunityStore(): CommunityStore {
  const runtime = runtimeConfig();
  const local = new LocalCommunityStore();
  if (runtime.store === "lan") {
    return new SharedWithFallback(new LanCommunityStore(new URL("api/", document.baseURI).href), local);
  }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key && !runtime.localOnly
    ? new SharedWithFallback(new SupabaseCommunityStore(url.replace(/\/$/, ""), key), local)
    : local;
}
