# AEGIS — Illustrated demonstration guide

Six-page landscape PDF presenting a repeatable Delos mission and its heritage-interpretation and observation features.

- AEGIS_Demo_Guide.pdf: illustrated guide, also included in submissionPackage/.
- build_demo.py: editable PDF source, using ReportLab and Pillow.
- Original captures: doc/abstract_slides/AEGIS_LaTeX/images/en/.
- Fonts and licence notices: doc/abstract_slides/AEGIS_LaTeX/fonts/.

Run from the repository root in a Python environment with reportlab and Pillow:

    python3 docs/submission/demo/build_demo.py

The guide uses retained English AEGIS interface captures. Their content supplies the illustrated example; results during play depend on mission and sensor choices.

## Image provenance

| Guide page | Original image | Role |
|---|---|---|
| 1 | slide01_3.png | Opening screen |
| 2 | slide05_1.png | Sensor-network design |
| 3 | slide06_1.png | Recorded alarm and detection explanation |
| 3 | slide05_2.png | Three-dimensional replay inset |
| 4 | slide06_2.png | Comparison with installed ARGUS instruments |
| 5 | slide07_1.png | Heritage model and conservation interpretation |
| 5 | slide03_1.png | Paired illustrative deterioration images |
| 6 | slide09_1.png | Visitor observation report |

Captures retain the source and imagery attribution displayed by the application. The guide has six PDF bookmarks and a clickable application link on every page.
