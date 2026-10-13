import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applySettings } from "./a11y/settings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LangProvider } from "./i18n";
import "./fonts.css";
import "./styles.css";

// The accessibility settings this device chose (text size, contrast, motion, spacing), before
// anything is drawn, so the page never flashes in the default look first.
applySettings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </LangProvider>
  </StrictMode>,
);

// Offline support after the first visit (dist/sw.js is written by vite.config.ts at build time).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // e.g. a sandboxed preview: the game works the same, just not offline
    });
  });
}
