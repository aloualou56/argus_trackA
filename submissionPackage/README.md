# AEGIS — Submission package

**ARGUS Open Innovation Challenge 2026 · Track A: Heritage and Citizen Science**
**Project:** AEGIS: Translating Heritage Monitoring Data into Participatory Learning and Citizen Engagement
**Members:** Ilias Akritidis, Georgios Mallousis and Vasileios Sevetlidis
International Hellenic University, Polytechnic School, Department of Computer, Informatics and Telecommunications Engineering

Ilias Akritidis and Georgios Mallousis contributed equally. Contact: [iliakrit@ihu.gr](mailto:iliakrit@ihu.gr), [geomallo@ihu.gr](mailto:geomallo@ihu.gr), [vasiseve@ihu.gr](mailto:vasiseve@ihu.gr).

## Start here

- [Play AEGIS](https://aloualou56.github.io/argus_trackA/).
- Read the [abstract](AEGIS_Abstract_EN.pdf).
- View the [presentation](AEGIS_Presentation_EN.pdf) (10 slides).
- Watch the [gameplay video](aegis_gameplay.mp4) (2 minutes 54 seconds).
- Follow the [illustrated demonstration guide](AEGIS_Demo_Guide.pdf) (6 pages, with game screenshots).
- Consult the [API workflow report](AEGIS_API_Workflow.pdf) and [data-analysis report](AEGIS_Data_Analysis.pdf) for implementation details.
- Download the [application source](https://github.com/aloualou56/argus_trackA/archive/refs/heads/readyToSubmit.zip) to inspect or run the implementation locally.

## Requested material and corresponding evidence

The following table retains every entry from the expanded submission checklist. **Required** reflects the organizer's submission-package table: the abstract, presentation and tangible digital output are required; demonstration media and source/repository material are encouraged. Source is required where necessary to inspect the output. The tangible-output examples are alternatives, so the entries marked **yes** in that group do not imply that separate applications are required. AEGIS provides one web-based serious game, supported by its API workflow and data-analysis pipeline. Entries 4, 12 and 13 refer to that same game.


| Item                                     | Required | Filename, link or applicability                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Abstract — 300–500 words            | yes      | [AEGIS_Abstract_EN.pdf](AEGIS_Abstract_EN.pdf)                                                                                                                                                                                                                                                                                    |
| 2. Presentation — 5–10 slides          | yes      | [AEGIS_Presentation_EN.pdf](AEGIS_Presentation_EN.pdf), 10 slides                                                                                                                                                                                                                                                                 |
| 3. Short PDF — presentation alternative | yes      | Covered by[AEGIS_Presentation_EN.pdf](AEGIS_Presentation_EN.pdf); no separate presentation document                                                                                                                                                                                                                               |
| 4. Web prototype                         | yes      | [Playable AEGIS web game](https://aloualou56.github.io/argus_trackA/); source in [Branch source archive](https://github.com/aloualou56/argus_trackA/archive/refs/heads/readyToSubmit.zip)                                                                                                                                                                                             |
| 5. Desktop application                   | yes      | Not applicable                                                                                                                                                                                                                                                                                                                    |
| 6. Mobile application                    | yes      | Not applicable                                                                                                                                                                                                                                                                                                                    |
| 7. Dashboard                             | yes      | Not applicable                                                                                                                                                                                                                                                                                                                    |
| 8. Notebook                              | yes      | Not applicable                                                                                                                                                                                                                                                                                                                    |
| 9. API-based workflow                    | yes      | [AEGIS_API_Workflow.pdf](AEGIS_API_Workflow.pdf)                                                                                                                                                                                                                                                                                  |
| 10. Data-analysis pipeline               | yes      | [AEGIS_Data_Analysis.pdf](AEGIS_Data_Analysis.pdf), [supporting documentation](data-analysis/README.md), [analysis results](data-analysis/Analysis_Results.md), [pipeline diagram](data-analysis/1-pipeline.png) and [alarm-selection diagram](data-analysis/2-alarm-funnel.png); executable implementation in the source archive |
| 11. AI/ML demonstration                  | yes      | Not applicable                                                                                                                                                                                                                                                                                                                   |
| 12. Prototype URL                        | yes      | [https://aloualou56.github.io/argus_trackA/](https://aloualou56.github.io/argus_trackA/) — same output as item 4                                                                                                                                                                                                                 |
| 13. Equivalent demonstrable artefact     | yes      | [Playable AEGIS web game](https://aloualou56.github.io/argus_trackA/) — same output and URL as items 4 and 12                                                                                                                                                                                                                    |
| 14. Demonstration                        | optional | [AEGIS_Demo_Guide.pdf](AEGIS_Demo_Guide.pdf) — six-page illustrated walkthrough; [playable application](https://aloualou56.github.io/argus_trackA/) and [text guide](Demo_Guide.md)                                                                                                                                              |
| 15. Screenshots                          | optional | [screenshots/README.md](screenshots/README.md), with six desktop/mobile images; screenshots also appear in the presentation                                                                                                                                                                                                       |
| 16. Video — maximum 3 minutes           | optional | [aegis_gameplay.mp4](aegis_gameplay.mp4) — 2 minutes 54 seconds, 1920 × 1080, with audio                                                                                                                                                                                                                                        |
| 17. Source code                          | optional | [Branch source archive](https://github.com/aloualou56/argus_trackA/archive/refs/heads/readyToSubmit.zip) — application, processing tools, retained inputs, tests, documentation and editable LaTeX sources                                                                                                                                                                                 |
| 18. Repository                           | optional | [GitHub repository](https://github.com/aloualou56/argus_trackA); the submission source is available in [Branch source archive](https://github.com/aloualou56/argus_trackA/archive/refs/heads/readyToSubmit.zip)                                                                                                                                                                          |


## Technical inspection and local execution

Download the branch source archive linked above and open its extracted `argus_trackA-readyToSubmit/` directory. Python 3.9+ and Node.js 20+ are required for the documented local workflow. Retained inputs and the generated gameplay data are included; fetching new ARGUS data is unnecessary for an initial review.

```sh
cd argus_trackA-readyToSubmit
python3 -I tools/build_game_data.py --check
cd web
npm ci
npm run dev
```

Open the local URL printed by Vite. To generate a production build, run `npm run build` in `web/`. The archive's root `README.md` documents the wider application, tests and deployment. The API workflow report describes the monitoring feed and its operational limitations. External imagery and other network services may require connectivity.

Submission branch: [readyToSubmit](https://github.com/aloualou56/argus_trackA/tree/readyToSubmit). The generated distribution ZIPs are retained locally; GitHub supplies the downloadable branch source archive.
