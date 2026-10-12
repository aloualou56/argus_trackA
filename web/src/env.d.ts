/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional shared store (see README "Community stats and class codes"). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "1": ask nothing from outside the game's own server (drawn plan only, no cloud store). */
  readonly VITE_LOCAL_ONLY?: string;
}
