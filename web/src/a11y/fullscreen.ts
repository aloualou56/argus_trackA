// Full screen on phones and small tablets: the browser's address bar and buttons step aside and
// the game has the whole screen. Browsers allow it only from a tap, so the game asks when the
// player presses "Start" (if the accessibility menu's "Full screen" is on, the default). Android
// browsers allow it; iPhones do not let a web page go full screen, so nothing changes there.

/** A phone or small tablet whose browser lets the page go full screen. */
export function fullscreenAvailable(): boolean {
  if (typeof document === "undefined" || !document.fullscreenEnabled) return false;
  try {
    return window.matchMedia("(pointer: coarse) and (max-width: 59.99rem)").matches;
  } catch {
    return false;
  }
}

export function enterFullscreen(): void {
  if (!fullscreenAvailable() || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {
    // refused (no tap behind it, or the browser said no): the game works the same
  });
}

export function exitFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
