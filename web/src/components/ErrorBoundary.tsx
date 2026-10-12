import { Component, type ReactNode } from "react";
import { useI18n } from "../i18n";

/** A crash anywhere in the game shows a message and a reload button, never an empty page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <CrashNotice /> : this.props.children;
  }
}

function CrashNotice() {
  const { t } = useI18n();
  return (
    <main className="status crash" role="alert">
      <h1>{t("app.title")}</h1>
      <p>{t("app.crash")}</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
        {t("app.reload")}
      </button>
    </main>
  );
}
