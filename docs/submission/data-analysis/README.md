# AEGIS — Data analysis and database design

Final academic technical deliverable, approved for inclusion in the submission package.

- main.tex: editable report.
- figures/: editable TikZ pipeline, alarm-selection and database diagrams.
- AEGIS_Data_Analysis.pdf: compiled final copy, matching the saved LaTeX source.
- verification.json: recalculated resource metadata, counts and site-level selection evidence.

The report covers the ARGUS snapshot analysis and the separate optional participation database defined by supabase/schema.sql. Database findings are based on the supplied schema and application source, not a live database inspection.

Open this project in the built-in LaTeX editor, or compile main.tex twice with XeLaTeX. The original pipeline notes and diagrams remain in doc/data-analysis/.

Verification on 25 October 2026 passed 125 targeted tests: 41 data-builder and 16 classroom-server Python tests; 13 community-store, 14 multi-day and 41 scoring/logic browser tests. Data-pack validation also passed. These checks do not execute the SQL schema in PostgreSQL.
