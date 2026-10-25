"""Build the illustrated AEGIS demo guide from retained game captures.

Run with a Python environment containing reportlab and Pillow:
    python3 docs/submission/demo/build_demo.py
The PDF is written beside this script; copying into submissionPackage is a
separate packaging operation.
"""
from pathlib import Path
from xml.sax.saxutils import escape
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
ASSETS = ROOT / "doc/abstract_slides/AEGIS_LaTeX/images/en"
FONTS = ROOT / "doc/abstract_slides/AEGIS_LaTeX/fonts"
OUTPUT = HERE / "AEGIS_Demo_Guide.pdf"
URL = "https://aloualou56.github.io/argus_trackA/"
GREEN = colors.HexColor("#0B5D4B")
INK = colors.HexColor("#202D29")
MUTED = colors.HexColor("#52645D")
LIGHT = colors.HexColor("#EEF4F1")
LINE = colors.HexColor("#CCD8D1")
W, H = 297 * mm, 210 * mm

for family, filename in [
    ("Fira", "FiraSans-Regular.ttf"),
    ("FiraSemi", "FiraSans-SemiBold.ttf"),
    ("FiraCond", "FiraSansExtraCondensed-SemiBold.ttf"),
]:
    pdfmetrics.registerFont(TTFont(family, str(FONTS / filename)))

STYLES = {
    "body": ParagraphStyle("body", fontName="Fira", fontSize=9.8, leading=13.4, textColor=INK),
    "small": ParagraphStyle("small", fontName="Fira", fontSize=8.2, leading=11, textColor=MUTED),
    "side": ParagraphStyle("side", fontName="Fira", fontSize=9.6, leading=13.4, textColor=INK),
    "note": ParagraphStyle("note", fontName="Fira", fontSize=9.4, leading=12.6, textColor=INK),
}
pdfmetrics.registerFontFamily("Fira", normal="Fira", bold="FiraSemi")


def paragraph(c, text, x, top, width, style="body", max_height=None):
    p = Paragraph(text, STYLES[style])
    _, height = p.wrap(width * mm, H)
    if max_height is not None and height > max_height * mm:
        raise ValueError(f"Text overflow: {text[:90]} ({height / mm:.1f}mm)")
    p.drawOn(c, x * mm, H - top * mm - height)
    return height / mm


def text(c, value, x, top, font="Fira", size=10, color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x * mm, H - top * mm, value)


def image(c, name, x, top, width, border=True):
    file = ASSETS / name
    with Image.open(file) as im:
        height = width * im.height / im.width
    c.drawImage(str(file), x * mm, H - (top + height) * mm,
                width * mm, height * mm, mask="auto")
    if border:
        c.setStrokeColor(LINE)
        c.setLineWidth(.5)
        c.rect(x * mm, H - (top + height) * mm, width * mm, height * mm, stroke=1, fill=0)
    return height


PAGES = [
    {
        "title": "Choose a site and enter the story",
        "intro": "Begin with Delos and follow a complete mission from a preservation challenge to an observation report.",
        "image": "slide01_3.png",
        "actions": [
            "Open the game and select English.",
            "Choose Delos and the Catastrophic level, then select Start.",
            "Complete or skip the opening quiz. Read the guardian's introduction and select See the dangers.",
        ],
        "look": "A real heritage site, its places and a mission linked to ARGUS preservation scenarios.",
        "note_title": "A repeatable jury route",
        "note": "Use the first mission at this level for the illustrated route. Allow around five minutes for the main sequence, then explore the interpretation and observation features. Initial guidance can be followed or dismissed using the displayed controls.",
        "caption": "Opening screen: site selection, language controls and an overview of the five heritage sites.",
    },
    {
        "title": "Design a monitoring network",
        "intro": "Work within the virtual budget and choose sensors in response to the mission's three preservation threats.",
        "image": "slide05_1.png",
        "actions": [
            "Expand the three danger descriptions and inspect the sensor cards.",
            "Add a soil moisture probe and a rain gauge for the illustrated example.",
            "Position the sensors using the map crosshair and add controls; drag them to adjust placement. Select Done.",
        ],
        "look": "The remaining coins, selected sensor counts and blue markers update as the network changes.",
        "note_title": "Read the choices as a design decision",
        "note": "The soil moisture probe supports detection of the recorded Delos alarm shown next. Threat coverage also depends on the other selected sensors. Sensor prices and threat-to-sensor mappings form part of the educational configuration.",
        "caption": "Mission screen: three dangers, a limited budget, sensor cards and the proposed network.",
    },
    {
        "title": "Interpret a recorded alarm",
        "intro": "Replay the historical event, then inspect the explanation of whether the proposed network could detect it.",
        "image": "slide06_1.png",
        "actions": [
            "Watch the replay after completing the network.",
            "Read the event date, principal signal and detection explanation.",
            "For the illustrated Delos alarm, check the soil moisture probe result. Select Show me what ARGUS did.",
        ],
        "look": "The event panel connects the recorded alarm with a sensor type and shows the proposed network's detection result.",
        "note_title": "Connect evidence to the heritage site",
        "note": "The illustrated event is an ARGUS AI alarm dated 31 August 2026, associated with moisture beneath a mosaic. The replay also uses the available ARGUS three-dimensional model. The result shown here follows the sensor choices in this example.",
        "caption": "Alarm explanation: source event, detected signal and feedback on the proposed network.",
        "thumb": "slide05_2.png",
    },
    {
        "title": "Compare choices with ARGUS",
        "intro": "Inspect the installed monitoring network and use the result summary to reflect on the sensor choices.",
        "image": "slide06_2.png",
        "actions": [
            "Compare the blue player markers with the orange ARGUS markers.",
            "Read the sensor-by-sensor comparison and discussion prompts.",
            "Select See my score. Inspect threat coverage, alarm detection and expenditure on useful sensors.",
        ],
        "look": "The comparison reveals the instruments actually installed at the site. The score explains the mission's applicable components.",
        "note_title": "Try a second design",
        "note": "Use the available network-improvement control to change a sensor choice and compare the feedback. The displayed score depends on the mission and selected cards. ARGUS's network provides a concrete reference for discussion.",
        "caption": "Comparison view: the proposed network alongside ARGUS's installed instruments.",
    },
    {
        "title": "Explore the conservation consequences",
        "intro": "Open the available three-dimensional heritage views and examine the educational illustrations of change over time.",
        "image": "slide07_1.png",
        "actions": [
            "From the results, open the available monument or consequence view.",
            "Move the years control and inspect the preservation scenarios.",
            "Read the explanation of the material, location and illustrated damage. Return to the map when finished.",
        ],
        "look": "The three-dimensional scene and paired illustrations connect the monitoring task with the heritage fabric.",
        "note_title": "Interpretation of the visual effects",
        "note": "Deterioration effects are authored educational illustrations. ARGUS supplies the available site models and monitoring context. The descriptions explain how the visual effects relate to preservation concerns.",
        "caption": "Heritage interpretation: the House of the Masks, its model and illustrative conservation effects.",
        "thumb": "slide03_1.png",
    },
    {
        "title": "Record an observation",
        "intro": "Extend the experience to a visitor's own observations through the structured reporting interface.",
        "image": "slide09_1.png",
        "actions": [
            "Open the observation-report feature from the results or the selected site's home screen.",
            "Choose the monument and select the type of observation. Add the available location and description details.",
            "Review the report and its export or contact options. A sample report can be inspected locally.",
        ],
        "look": "The form organises a visitor's observation so it can be reviewed and communicated to the responsible site staff.",
        "note_title": "Continue the review",
        "note": 'Play another site or level, try the mobile layout, or inspect the available quiz and classroom features. '
                'The submission also contains <b>AEGIS_Presentation_EN.pdf</b>, <b>AEGIS_API_Workflow.pdf</b>, '
                '<b>AEGIS_Data_Analysis.pdf</b> and the 2-minute 54-second gameplay video.',
        "caption": "Observation report: site selection, observation categories and map-based location.",
    },
]


def draw_page(c, n, page):
    c.setFillColor(colors.white)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.rect(0, H - 3 * mm, W, 3 * mm, fill=1, stroke=0)

    text(c, "AEGIS  /  ILLUSTRATED DEMONSTRATION", 16, 13, "FiraSemi", 9, GREEN)
    text(c, "ARGUS Open Innovation Challenge 2026 | Track A", 173, 13, size=8, color=MUTED)
    text(c, f"{n:02d}", 16, 32, "FiraCond", 29, GREEN)
    text(c, page["title"], 32, 31, "FiraCond", 24)
    paragraph(c, page["intro"], 16, 36, 265, "body", 10)

    image(c, page["image"], 16, 50, 190)
    paragraph(c, escape(page["caption"]), 16, 159.0, 190, "small", 8)
    c.setFillColor(LIGHT)
    c.roundRect(212 * mm, H - 157 * mm, 69 * mm, 107 * mm, 3 * mm, fill=1, stroke=0)
    text(c, "IN THE APP", 217, 58, "FiraSemi", 9, GREEN)
    top = 63
    for i, action in enumerate(page["actions"], 1):
        height = paragraph(c, f"<b>{i}.</b> {escape(action)}", 217, top, 59, "side")
        top += height + 3
    top += 1.5
    text(c, "LOOK FOR", 217, top + 3, "FiraSemi", 9, GREEN)
    top += 7
    last = paragraph(c, escape(page["look"]), 217, top, 59, "side")
    if top + last > 154:
        raise ValueError(f"Sidebar overflow on page {n}: {top + last}")

    note_x, note_w = 16, 265
    if page.get("thumb"):
        image(c, page["thumb"], 16, 167.5, 50)
        note_x, note_w = 72, 209
    text(c, page["note_title"].upper(), note_x, 173.0, "FiraSemi", 9, GREEN)
    paragraph(c, page["note"], note_x, 176, note_w, "note", 17)

    c.setStrokeColor(LINE)
    c.line(16 * mm, 197 * mm, 281 * mm, 197 * mm)
    text(c, "I. Akritidis · G. Mallousis · V. Sevetlidis | International Hellenic University", 16, 202, size=7.6, color=MUTED)
    text(c, "Play AEGIS", 227, 202, "FiraSemi", 8, GREEN)
    c.linkURL(URL, (226 * mm, H - 204 * mm, 250 * mm, H - 198 * mm), relative=0, thickness=0)
    text(c, f"{n} / {len(PAGES)}", 269, 202, size=8, color=MUTED)
    c.bookmarkPage(f"step{n}")
    c.addOutlineEntry(page["title"], f"step{n}", level=0)
    c.showPage()


def main():
    c = canvas.Canvas(str(OUTPUT), pagesize=(W, H), pageCompression=1, invariant=1)
    c.setTitle("AEGIS: Illustrated Demonstration Guide")
    c.setAuthor("Ilias Akritidis, Georgios Mallousis, Vasileios Sevetlidis")
    c.setSubject("ARGUS Open Innovation Challenge 2026, Track A: Heritage and Citizen Science")
    for n, page in enumerate(PAGES, 1):
        draw_page(c, n, page)
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
