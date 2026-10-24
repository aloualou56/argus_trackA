# AEGIS — LaTeX sources

| File | Rebuilds |
|---|---|
| `AEGIS_2.tex` | `AEGIS_2.pdf` (A4 one-pager) |
| `AEGIS_presentation_v2.tex` | `AEGIS_presentation_v2.pdf` (10 slides, 960×540 bp) |

## Compile

Both files need **XeLaTeX** (they use xdvipdfmx features):

    xelatex AEGIS_2.tex
    xelatex AEGIS_presentation_v2.tex

Run each once. To be safe, run it twice; the second run changes nothing.
Keep the `fonts/` and `images/` folders next to the `.tex` files. All
fonts are included (Fira Sans / Fira Mono / Font Awesome 7 Free for the
one-pager, Carlito / Liberation Mono for the slides), so you don't need to
install anything. Required packages: fontspec, polyglossia, xcolor, tikz,
microtype, eso-pic, etoolbox, graphicx. A normal TeX Live or MiKTeX has them.

## How they were checked

The originals and the rebuilt PDFs were compared glyph by glyph and pixel
by pixel:

* Same text, fonts, sizes, colours and line breaks (including the Greek
  hyphenation) in both documents.
* Every glyph is within 0.02 bp (one-pager) or 0.04 bp (slides) of its
  original position. 1 bp = 1/72 inch.
* Shapes, pictures, shadows and borders sit at the same coordinates.
  The pictures are the original files, taken out of the PDFs unchanged.

## Editing

* Text: change the words inside the macros. Paragraphs on the one-pager
  are real TeX paragraphs, so they re-justify and hyphenate. Boxes have
  fixed sizes, so very long new text will spill out.
* Positions are absolute page coordinates (bp on the one-pager, CSS px of
  the 1280×720 slide on the presentation). Each file's header explains
  the macros.
