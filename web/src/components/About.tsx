import { useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";

/** The competition's page: none yet, so the line stays plain text until it is set here. */
const CHALLENGE_URL = "";

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Mail({ to }: { to: string }) {
  return <a href={`mailto:${to}`}>{to}</a>;
}

/**
 * About AEGIS: a small "i" in the top band that opens the credits as a dialog.
 * The text is the team's own, in English whatever the game's language.
 */
export function About() {
  const { t, lang } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const challenge = "ARGUS Open Innovation Challenge 2026 — Track A: Heritage and Citizen Science";

  return (
    <>
      <button
        ref={button}
        type="button"
        className="a11y-toggle about-toggle"
        aria-haspopup="dialog"
        aria-label={t("about.open")}
        title={t("about.open")}
        onClick={() => dialog.current?.showModal()}
      >
        <Icon name="info" size={22} />
      </button>
      <dialog
        ref={dialog}
        className="about-card"
        lang="en"
        aria-labelledby="about-title"
        onClose={() => button.current?.focus()}
        // A click on the shaded backdrop (outside the card) closes it.
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <div className="about-body">
          <h2 id="about-title">About AEGIS</h2>
          <p>Developed for the {CHALLENGE_URL ? <Out href={CHALLENGE_URL}>{challenge}</Out> : challenge}.</p>
          <p>
            AEGIS is a serious game about protecting cultural heritage. Become a temporary guardian of a European heritage
            site, explore its preservation challenges, and design a monitoring network within a limited virtual budget.
          </p>
          <p>
            The game uses <Out href="https://www.argus-project.eu">ARGUS</Out> risk assessments, instrument information
            and recorded alarms from five heritage sites: Delos, Baltanás, Monti Lucretili, Sant’Antonio di Ranverso and
            Schenkenberg. Your choices reveal how monitoring can support preventive conservation and help visitors
            understand their role in protecting heritage.
          </p>

          <h3>Data and interpretation</h3>
          <p>
            Heritage records originate from <Out href="https://argus.athenarc.gr">ARGUS</Out>. Sensor prices, missions,
            educational mappings and narrative content were developed for AEGIS. Deterioration effects are educational
            illustrations. Data dates and recent-monitoring availability are shown where relevant.
          </p>

          <h3>Created by</h3>
          <p className="about-names">Ilias Akritidis, Georgios Mallousis and Vasileios Sevetlidis</p>
          <p className="about-place">
            International Hellenic University · Polytechnic School
            <br />
            Department of Computer, Informatics and Telecommunications Engineering
          </p>
          <p>
            Ilias Akritidis and Georgios Mallousis contributed equally in the conception, development, implementation and
            testing of the application.
            <br />
            Under the supervision of Vasileios Sevetlidis.
          </p>
          <p className="about-contact">
            Contact: <Mail to="iliakrit@ihu.gr" /> · <Mail to="geomallo@ihu.gr" /> · <Mail to="vasiseve@ihu.gr" />
          </p>
        </div>
        <button type="button" className="btn btn-primary about-done" lang={lang} onClick={() => dialog.current?.close()}>
          {t("a11y.done")}
        </button>
      </dialog>
    </>
  );
}
