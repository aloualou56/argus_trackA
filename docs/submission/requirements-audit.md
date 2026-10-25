# AEGIS submission requirements and repository mapping

Reviewed: 25 October 2026 (Athens). Branch: `readyToSubmit`. Baseline: `b61c190`.

Source: [official ARGUS Open Innovation Challenge 2026 page](https://argus.athenarc.gr/open-innovation-challenge-2026/), read on 25 October 2026. The team confirmed that its supplied material uses the same Submission package table. No access token is needed for this audit. The private final-submission form has not been inspected; its fields below are those described on the public page.

## How to use this checklist

Every listed alternative remains visible for traceability. Under the team's clarified scope, M05–M08 and M11 (desktop app, mobile app, dashboard, notebook and AI/ML demo) are not applicable: AEGIS is a web-based serious game. The same game covers M04 as the web prototype, M12 through its prototype URL, and M13 as the demonstrable artifact accessible at that same URL; M17 is the source code of that actual application. Other entries retain their current status until reviewed. The organizer accepts alternative tangible outputs and encourages demo/media/source material; this checklist must not imply that every example requires a separate product.

“Present” means a file or implementation exists, not that it has passed a fresh acceptance test. This was a document/source inventory, not a build, functional test, deployment check, accessibility certification, or jury score prediction.

## Complete published jury allocation

| Criterion | Weight / points when expressed out of 100 | Existing evidence to present | Evidence still to establish |
|---|---:|---|---|
| Relevance to cultural heritage preservation and ARGUS objectives | 25% / 25 | Five ARGUS sites; sensor locations, risk scenarios, alarm replay, observation reports; `doc/api-workflow/README.md`, `doc/data-analysis/README.md`, `docs/teacher_guide.md` | A concise explanation connecting each user action to preventive preservation and Track A outcomes; review factual claims |
| Innovation and creativity | 25% / 25 | Budgeted sensor-placement game; comparison with ARGUS's installed network; illustrated consequences on ARGUS 3D models; fictional guardian narrative | Explain the team's original contribution separately from ARGUS assets, existing tools and models; support novelty rather than merely asserting it |
| Technical quality and feasibility | 20% / 20 | Source, pinned package dependencies/lockfile, Python and web tests, API workflow, reproducible data builder, offline/class-server design | Fresh build/test results; reproducible local instructions; verify external dependencies and content/data assumptions recorded in README |
| Potential impact and usability | 20% / 20 | Teacher flow, citizen checklist/report, quiz, responsive screens, narration, five language packs, survey-response PDF | Summarize actual evaluation methods, sample and limitations; distinguish post-play knowledge from measured learning gains; review translations and manual accessibility |
| Quality of presentation and communication | 10% / 10 | Approved English abstract and 10-slide English presentation, diagrams and English screenshots | Curated demo, video, clear entry links, consistency between claims and current implementation |
| **Total** | **100% / 100** | | |

The page publishes no subcriterion weights, per-track scoring changes, score anchors, tie-breaking rules or numerical bonus for extra deliverables. Do not invent them. The evidence suggestions above are our preparation analysis, not additional published jury rules.

## Complete expanded material checklist

Entries marked not applicable are excluded from the team’s deliverable requirements. Multiple entries can refer to the same application rather than separate deliverables.

| ID | Material / alternative | Published constraint | Current mapping and status |
|---|---|---|---|
| M01 | Abstract | 300–500 words | **Approved final by the team.** English LaTeX abstract: `docs/submission/abstract-en-draft/main.tex`. The folder name is retained; it does not indicate pending text approval. |
| M02 | Presentation slides | 5–10 slides | **Approved final by the team.** `doc/abstract_slides/AEGIS_presentation_en.pdf` is the English 10-slide presentation, including English interface screenshots. Editable source: `doc/abstract_slides/AEGIS_LaTeX/AEGIS_presentation_en.tex`. |
| M03 | Short PDF | Alternative to slides in the official table | **Present.** The one-page `AEGIS_2.pdf` is a natural short-PDF artifact; the deck is also PDF. No separate page cap for “short” is published. |
| M04 | Web prototype | Tangible-output example | **Present.** The AEGIS web-based serious game is the tangible output. React/TypeScript application in `web/`, with data in `web/public/data/`. The same application also covers M12 and M13 through its playable URL; M17 supplies its source code. |
| M05 | Desktop app | Tangible-output alternative | **Not applicable.** The submission is a web-based serious game under M04/M12; a separate desktop application is outside scope. |
| M06 | Mobile app | Tangible-output alternative | **Not applicable.** The submission is a web-based serious game under M04/M12; a separate mobile application is outside scope. Mobile-browser support is a feature of the web game. |
| M07 | Dashboard | Tangible-output example | **Not applicable.** No separate dashboard deliverable is required for this submission. The teacher view remains a feature of the web game. |
| M08 | Notebook | Tangible-output example | **Not applicable.** No notebook deliverable is required for this web-game submission. |
| M09 | API-based workflow | Tangible-output example | **Approved final and packaged.** `docs/submission/api-workflow/main.tex` and `AEGIS_API_Workflow.pdf` present the architecture, resource catalogue, data contracts, publication, operational limits, reproduction procedures and verification evidence. Local checks passed: 9 live-reader tests, 12 browser live-data tests, and data-pack validation. Live deployment operation remains unverified. Original notes and diagrams remain in `doc/api-workflow/`. The current report is included in `submissionPackage/AEGIS_API_Workflow.pdf`. |
| M10 | Data-analysis pipeline | Tangible-output example | **Approved final and packaged.** `docs/submission/data-analysis/main.tex` and `AEGIS_Data_Analysis.pdf` describe the pipeline, recalculated findings and optional SQL participation database. Original evidence remains in `doc/data-analysis/`, `tools/build_game_data.py`, `docs/data_notes.md` and `web/public/data/game_data.json`. The final report is included in `submissionPackage/AEGIS_Data_Analysis.pdf`. |
| M11 | AI/ML demo | Tangible-output example | **Not applicable.** The submission is a web-based serious game. Its use of ARGUS AI alarms is part of the game, rather than a separate AI/ML demonstration deliverable. |
| M12 | Prototype URL | Tangible-output example | **Same tangible output as M04.** Playable web-game URL: `https://aloualou56.github.io/argus_trackA/`. URL availability and correspondence to the final submission revision still need verification; deployment follows `main`. |
| M13 | Equivalent demonstrable artifact | Open-ended tangible-output alternative | **Covered by the same game URL as M12.** `https://aloualou56.github.io/argus_trackA/` provides access to the playable web game submitted under M04. No separate artifact or URL is required for this entry. |
| M14 | Demo | Encouraged by organizer; required by team | **Packaged illustrated demonstration.** `submissionPackage/AEGIS_Demo_Guide.pdf`: six landscape pages with eight retained game images, a Delos/Catastrophic starting state, actions and expected results. Editable source: `docs/submission/demo/build_demo.py`. `submissionPackage/Demo_Guide.md` supplies the corresponding text route. |
| M15 | Screenshots | Alternative/encouraged by organizer; required by team | **Present.** `docs/screenshots/` has desktop/mobile and language variants. Curate representative current images; verify they match final code. |
| M16 | Video | Alternative/encouraged by organizer; required by team | **Supplied and packaged.** `submissionPackage/aegis_gameplay.mp4`: 173.83 seconds (2 minutes 54 seconds), 1920 × 1080, H.264 video with AAC audio. Duration is within the three-minute limit. |
| M17 | Source code | Encouraged, or necessary for inspecting the output; required by team | **Present.** Source code of the actual AEGIS application submitted under M04/M12: `web/`, supported by `tools/`, `content/`, `supabase/`, configuration and tests. Final reviewer setup/access still needs verification. |
| M18 | Repository | Alternative/encouraged by organizer; required by team | **Present locally.** Git checkout of `https://github.com/aloualou56/argus_trackA`, new local branch `readyToSubmit`. No push has been made. Final reviewer access and exact revision/link remain to settle. |

The tangible output must make the result inspectable, runnable or understandable; an idea or slides alone do not satisfy it. The package must clearly show the use or extension of ARGUS data, APIs, concepts or pilot-site information. The existing API and data-analysis documents provide a strong starting point for this traceability.

## Complete form-field checklist described publicly

- [ ] Registered team name (confirm exact spelling; project name is not automatically team name).
- [ ] Selected track: A — Heritage and Citizen Science.
- [ ] Project title: finalize the AEGIS title/subtitle consistently.
- [ ] Abstract text, 300–500 words.
- [ ] Presentation/PDF link; our package should expose both the slides and short PDF.
- [ ] Tangible-output link; provide a clear index to all mapped outputs.
- [ ] Demo link (included under the team's stricter policy).
- [x] Video file linked in `submissionPackage/README.md`: `aegis_gameplay.mp4` (2 minutes 54 seconds).
- [ ] Repository link (included under the team's stricter policy).

Screenshots and source are material-checklist entries even though the public prose does not name separate form fields for them. Include accessible links through the package/index where the form permits. The actual form may contain additional fields or constraints; none are assumed verified here.

## Participation and delivery conditions

- Team size: 1–5 people; one selected track per team.
- Track A covers public understanding, awareness, storytelling, education, accessibility, outreach and citizen participation in heritage monitoring/preservation. These are the published scope themes, not individually weighted subcriteria.
- Register through the official registration process; use the separately supplied final-entry form for submission.
- Submit links; uploading files to the ARGUS platform is not required.
- Deadline: **25 October 2026, 23:59 Athens time** (today at the time of this audit).
- ARGUS challenge access is read-only: no SQL/admin access, writes or operational controls that modify services/data.
- Technologies, methods and tools are unrestricted by the public page.
- The public page does not specify a submission language, repository license, required hosting provider, README template, mandatory native app, or mandatory trained AI model. Do not treat suggestions on those subjects as organizer rules.

## Other published event information

The event is online and self-paced, with registration opening 30 September and work running 5–25 October 2026. Jury evaluation is 26–29 October; winners are announced online on 30 October. Jury membership comprises consortium representatives and invited heritage, digital-innovation and research experts.

Recognition covers the best solution in each of the three tracks plus a best overall idea. Valid final entries receive certificates. Each track-winning team is eligible for article publication-fee support in the named MDPI Heritage special issue; publication still depends on independent editorial assessment and peer review. These are outcomes, not additional submission deliverables.

## Repository evidence and risks to resolve before organization

1. **Approved documents:** the English abstract and English 10-slide presentation are final by team approval. Prepare their delivery links without changing the approved content.
2. **Video supplied:** `submissionPackage/aegis_gameplay.mp4` is 173.83 seconds and meets the three-minute duration limit.
3. **Applicability:** M05–M08 and M11 are not applicable and are not gaps. M04, M12 and M13 refer to the same web game; M12 and M13 share its playable URL, with its actual application source under M17. The remaining entries retain their recorded status pending review.
4. **Impact evidence:** `doc/research_data/AEGIS · Tell us what you think (response).pdf` contains survey responses. A reader-facing analysis with method, sample size and limitations was not identified in that folder. Do not claim causal learning improvement from a post-play questionnaire alone.
5. **Claim consistency:** README records unreviewed machine translations, human-review flags for heritage/science text and sensor mappings, assumed measurement units, and unresolved map-licensing questions. These are existing project notes whose present status must be reconciled with submission claims.
6. **Illustration versus prediction:** keep authored damage illustrations distinct from forecasts and team rules distinct from ARGUS machine-learning outputs.
7. **Accessibility:** describe WCAG 2.2 AA as a target unless the appropriate verification supports stronger wording. Existing automated test code is evidence of checks, not a certification.
8. **Delivery identity:** the online site follows `main`; a local branch is not yet a reviewer-accessible submission revision. Resolve hosting/access after the package is ready and the team authorizes publication.
9. **Documentation currency:** README is lengthy and includes dated next steps. Existing test-count statements are documentation claims; no fresh test totals were obtained in this audit.

No files were reorganized, application code changed, remote branch pushed, site published, or final entry submitted during this audit.

## Assembled submission package

The local `submissionPackage/README.md` maps all 18 material entries to the packaged PDFs, demonstration, screenshots, pipeline documentation, source archive and application/repository links. The source archive captures the local files rather than a published branch. The supplied gameplay video is included and linked in the package index. Packaging does not publish the branch, deploy the application or submit the entry.

## Remote branch publication

The approved submission files are prepared for publication on `readyToSubmit`. The package index links to the downloadable GitHub branch archive. Generated local ZIP archives and their local source manifest are excluded from Git, together with desktop metadata and LaTeX compiler output. The gameplay video and final PDFs are included.
