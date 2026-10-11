/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional shared store (see README "Community stats and class codes"). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
