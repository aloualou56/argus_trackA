# AEGIS API workflow deliverable

Standalone technical report included in the submission package.

- `main.tex`: editable report, including the endpoint catalogue, processing, data contracts, deployment, reliability, reproduction procedures and implementation references.
- `figures/`: editable TikZ sources for the context, component and sequence diagrams.
- `AEGIS_API_Workflow.pdf`: compiled submission copy, matching the current source.

Open this folder in the LaTeX editor, or compile `main.tex` twice with XeLaTeX to resolve references. A standard TeX Live installation with TikZ, booktabs, longtable, listings and pdflscape is sufficient. Build into a temporary directory to keep auxiliary files out of the submission folder.

The report describes application source at commit `b61c190`. Local checks on 25 October 2026 passed: 9 live-reader Python tests, 12 browser live-data tests, and the data-pack validator. Live deployment availability was not assessed.
