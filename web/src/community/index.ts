import { LocalCommunityStore, SharedWithFallback, SupabaseCommunityStore, type CommunityStore } from "./store";

/**
 * The store the game uses. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set at build time
 * (see README), choices are shared by everyone; without them they stay on this device.
 */
export function createCommunityStore(): CommunityStore {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const local = new LocalCommunityStore();
  return url && key ? new SharedWithFallback(new SupabaseCommunityStore(url.replace(/\/$/, ""), key), local) : local;
}
