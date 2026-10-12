// A visitor's own observation reports, kept on their device only (localStorage, or memory when
// storage is blocked). Unlike play records they hold the visitor's own words, so they are never
// sent to the class server or any shared store. Photos are never stored.
import { isReport, type ObservationReport } from "../game/report";

const KEY = "guardian.reports.v1";

export class ReportStore {
  private memory: ObservationReport[] = [];

  constructor(private storage: Storage | null = safeLocalStorage(), private max = 30) {}

  /** Newest first. */
  list(): ObservationReport[] {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) return parsed.filter(isReport);
    } catch {
      // storage blocked or damaged: this visit's reports are still in memory
    }
    return this.memory;
  }

  private write(reports: ObservationReport[]): void {
    this.memory = reports;
    try {
      this.storage?.setItem(KEY, JSON.stringify(reports));
    } catch {
      // quota or privacy mode: kept for this visit only
    }
  }

  add(report: ObservationReport): void {
    this.write([report, ...this.list().filter((r) => r.id !== report.id)].slice(0, this.max));
  }

  remove(id: string): void {
    this.write(this.list().filter((r) => r.id !== id));
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
