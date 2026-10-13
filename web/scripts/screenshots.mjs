// Plays the whole Ranverso slice in a real browser, in Greek and English, on a phone and a
// desktop viewport. Saves screenshots to docs/screenshots and fails on accessibility
// problems found by axe (WCAG 2.1 A/AA), console errors, horizontal scroll or lost focus.
//
//   npm run build && npm run screenshots
//
// Uses the Edge or Chrome already installed (playwright-core downloads no browser).
// Set BROWSER_CHANNEL=chrome to use Chrome instead of Edge, or BROWSER_PATH=/path/to/chromium for any
// other Chromium. SCREENSHOT_DIR saves the pictures somewhere else than docs/screenshots.
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const outDir = process.env.SCREENSHOT_DIR || join(web, "..", "docs", "screenshots");
const PORT = Number(process.env.SCREENSHOT_PORT) || 4180;
const URL_BASE = `http://localhost:${PORT}/`;

const dict = {
  el: JSON.parse(readFileSync(join(web, "src/i18n/el.json"), "utf8")),
  en: JSON.parse(readFileSync(join(web, "src/i18n/en.json"), "utf8")),
};
const data = JSON.parse(readFileSync(join(web, "public/data/game_data.json"), "utf8"));
const cardName = (lang, id) => data.cards.cards.find((c) => c.id === id).name[lang];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

const problems = [];
const note = (msg) => {
  problems.push(msg);
  console.log(`  PROBLEM: ${msg}`);
};

function startServer() {
  const server = spawn(process.execPath, [join(web, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], {
    cwd: web,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite preview did not start")), 20000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes(String(PORT))) {
        clearTimeout(timer);
        resolve(server);
      }
    });
    server.on("exit", (code) => reject(new Error(`vite preview exited (${code}). Run npm run build first.`)));
  });
}

async function checkPage(page, label) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of axe.violations) {
    note(`${label}: axe ${v.id} (${v.impact}) on ${v.nodes.length} node(s): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) note(`${label}: horizontal overflow of ${overflow}px`);
  // Fixed frame: the page never scrolls, and scrolling the panel leaves the top bar and the map in place.
  const frame = await page.evaluate(async () => {
    const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
    const before = [top(".topbar"), top(".board-map")];
    const panel = document.querySelector(".board-panel");
    const start = panel?.scrollTop ?? 0;
    panel?.scrollTo({ top: panel.scrollHeight });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const after = [top(".topbar"), top(".board-map")];
    const pageScroll = document.documentElement.scrollHeight - window.innerHeight;
    panel?.scrollTo({ top: start });
    window.scrollTo(0, 0);
    return { before, after, pageScroll };
  });
  if (frame.pageScroll > 1) note(`${label}: the page scrolls by ${frame.pageScroll}px (only the panel should)`);
  if (frame.before[0] !== frame.after[0] || frame.before[1] !== frame.after[1]) {
    note(`${label}: top bar or map moved when scrolling (${JSON.stringify(frame.before)} -> ${JSON.stringify(frame.after)})`);
  }
}

async function expectFocusOnHeading(page, label) {
  const tag = await page.evaluate(() => document.activeElement?.tagName);
  if (tag !== "H1") note(`${label}: focus is on ${tag}, expected the H1 after a screen change`);
}

const ranverso = data.monuments.find((m) => m.pilot_key === "ranverso");

/** Windows sometimes locks a screenshot file for a moment (antivirus, an open preview): retry. */
async function retryWrite(action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (e) {
      if (attempt >= 4 || !/UNKNOWN|EBUSY|EPERM|EACCES/.test(String(e))) throw e;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
}

/** Into the mission. An upright phone opens it with the "how to" card first: close it to play. */
async function toMission(page, t) {
  await page.getByRole("button", { name: t["story.continue"] }).click();
  if ((page.viewportSize()?.width ?? 1000) >= 640) return;
  const ok = page.getByRole("button", { name: t["mission.helpOk"] });
  await ok.waitFor({ timeout: 10000 });
  await ok.click();
}

/** The quiz before the game: skipped, or answered with the given choice per question (an index). */
async function preQuiz(page, t, answer = null) {
  await page.getByRole("heading", { level: 1, name: t["quiz.preTitle"] }).waitFor();
  if (answer === null) {
    await page.getByRole("button", { name: t["quiz.skip"] }).click();
    return;
  }
  for (const q of data.quiz.questions) await page.locator(`#q-${q.id}-${answer(q)}`).check();
  await page.getByRole("button", { name: t["quiz.submit"] }).click();
}

/** The map must show real tiles (not the failure notice) and the expected number of markers. */
async function checkMap(page, label, selector, expected) {
  try {
    await page.waitForFunction(() => document.querySelectorAll(".leaflet-tile-loaded").length >= 4, null, { timeout: 20000 });
  } catch {
    note(`${label}: map tiles did not load`);
  }
  if (await page.locator(".map-notice").count()) note(`${label}: map shows the tiles-failed notice`);
  if (selector) {
    const n = await page.locator(selector).count();
    if (n !== expected) note(`${label}: expected ${expected} × ${selector} on the map, found ${n}`);
  }
}

// Full-page captures cannot show the sticky map (the capture stretches the viewport), so
// desktop shots are what the screen shows; phones also get a full-page shot of the panel.
async function shot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  if (name.includes("-phone-")) {
    await retryWrite(() => page.screenshot({ path: join(outDir, `${name}-panel.png`), fullPage: true }));
  }
  await retryWrite(() => page.screenshot({ path: join(outDir, `${name}.png`) }));
  console.log(`  saved ${name}.png`);
}

async function play(browser, lang, vpName) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS[vpName], locale: lang === "el" ? "el-GR" : "en-GB", reducedMotion: "reduce" });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem("guardian.lang", l);
    } catch {}
  }, lang);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const prefix = `${lang}-${vpName}`;
  console.log(`\n${prefix}`);

  await page.goto(URL_BASE);
  await page.getByRole("heading", { level: 1, name: t["app.title"] }).waitFor();
  if ((await page.getAttribute("html", "lang")) !== lang) note(`${prefix}: <html lang> is not ${lang}`);
  await checkMap(page, `${prefix} home`, ".site-pin", data.monuments.length);
  await checkPage(page, `${prefix} home`);
  await shot(page, `${prefix}-1-home`);

  // Delos is selected first (the first playable monument); this walk-through plays Ranverso.
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await page.getByRole("heading", { level: 1, name: t["quiz.preTitle"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} quiz`);
  await page.getByRole("button", { name: t["quiz.submit"] }).click();
  if (!(await page.locator("#main").getByText(fill(t["quiz.needAll"], { n: 1 })).isVisible())) note(`${prefix}: no hint when the quiz is unanswered`);
  await checkPage(page, `${prefix} quiz before`);
  await shot(page, `${prefix}-0-quiz`);
  await preQuiz(page, t, () => 0);
  await page.getByRole("heading", { level: 1, name: data.monuments.find((m) => m.pilot_key === "ranverso").display_name[lang] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} story`);
  await checkMap(page, `${prefix} story`);
  await checkPage(page, `${prefix} story`);
  await shot(page, `${prefix}-2-story`);

  await page.getByRole("button", { name: t["story.continue"] }).click();
  const helpOk = page.getByRole("button", { name: t["mission.helpOk"] });
  if (vpName === "phone") {
    // An upright phone: the map is the whole screen, and a card explains how to place sensors.
    await helpOk.waitFor();
    if ((await page.locator(".help-dangers li").count()) !== 3) note(`${prefix}: the card does not list the 3 dangers`);
    if (await page.locator(".topbar").isVisible()) note(`${prefix}: the top bar takes room from the phone's map`);
    await checkPage(page, `${prefix} mission help`);
    await retryWrite(() => page.screenshot({ path: join(outDir, `${prefix}-3a-mission-help.png`) }));
    await helpOk.click();
  } else if (await helpOk.count()) {
    note(`${prefix}: the phone's "how to" card on a wide screen`);
  }
  await page.getByRole("heading", { level: 1, name: t["mission.heading"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} mission`);
  if (vpName === "phone") {
    const share = await page.evaluate(() => document.querySelector(".board-map").getBoundingClientRect().height / innerHeight);
    if (share < 0.95) note(`${prefix}: the map has only ${Math.round(share * 100)}% of the phone's height`);
    await page.getByRole("button", { name: t["mission.help"] }).click();
    await helpOk.waitFor();
    await page.keyboard.press("Escape");
    if (await helpOk.isVisible()) note(`${prefix}: Escape does not close the card`);
  }

  if (!(await page.locator(".crosshair-label").isVisible())) note(`${prefix}: no "sensors go here" label before the first pin`);
  await retryWrite(() => page.locator(".board-map").screenshot({ path: join(outDir, `${prefix}-3-reticle.png`) }));

  // "Done" with no sensors must explain itself instead of moving on. It is aria-disabled
  // (still focusable and clickable for assistive tech), so Playwright needs force.
  await page.getByRole("button", { name: t["mission.done"] }).click({ force: true });
  if (!(await page.locator("#main").getByText(t["mission.needOne"]).isVisible())) note(`${prefix}: no hint when finishing with zero sensors`);

  // Keyboard only: focus the "add humidity" button and press Space twice, then Enter once on soil.
  const add = (id) => page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, id) }), exact: true });
  await add("humidity").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await add("soil_moisture").focus();
  await page.keyboard.press("Enter");
  await add("crackmeter").click();
  const live = await page.locator("[aria-live=polite]").innerText();
  if (!live.includes(cardName(lang, "crackmeter"))) note(`${prefix}: live region did not announce the change (${live})`);
  // The walk-through plays Ranverso's preselected level: its most serious one.
  const budget = [...ranverso.levels].reverse().find((l) => l.available).budget;
  const coinsText = fill(t["mission.coinsLeft"], { left: budget - 2 * 1 - 2 - 2, budget });
  if (!(await page.locator("#main").getByText(coinsText).isVisible())) note(`${prefix}: expected "${coinsText}"`);

  // The human observer joins the network but gets no pin.
  await add("observer").click();

  // Drag and drop: the thermometer tile dragged onto the map lands where it is dropped, not at the cross.
  const tile = add("temperature");
  // To the middle of the panel: at its top edge the tile would sit under the sticky dock header.
  await tile.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const from = await tile.boundingBox();
  const mapBox = await page.locator(".board-map .map").boundingBox();
  const drop = { x: mapBox.x + mapBox.width * 0.3, y: mapBox.y + mapBox.height * 0.3 };
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 30, { steps: 4 });
  await page.mouse.move(drop.x, drop.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dropSaid = await page.locator("[aria-live=polite]").innerText();
  if (!dropSaid.includes(t["mission.dropped"])) note(`${prefix}: drag and drop was not announced (${dropSaid})`);
  const nearest = await page.$$eval(
    ".pin-you",
    (pins, at) =>
      Math.min(
        ...pins.map((p) => {
          const r = p.getBoundingClientRect();
          return Math.hypot(r.x + r.width / 2 - at.x, r.y + r.height / 2 - at.y);
        }),
      ),
    drop,
  );
  if (!(nearest < 30)) note(`${prefix}: dropped sensor is ${Math.round(nearest)} px from the drop point`);

  // Overspending is blocked and announced: cameras (4 coins) until one more no longer fits.
  let cameras = 0;
  while (budget - 2 * 1 - 2 - 2 - 1 - 1 - 4 * cameras >= 4) {
    await add("camera").click();
    cameras += 1;
  }
  await add("camera").click({ force: true });
  const afterCamera = await page.locator("[aria-live=polite]").innerText();
  if (!afterCamera.includes(fill(t["mission.notEnough"], { name: cardName(lang, "camera") }))) {
    note(`${prefix}: overspending was not announced (${afterCamera})`);
  }
  // humidity x2, soil and crack at the cross, thermometer where dropped, plus the cameras
  await checkMap(page, `${prefix} mission`, ".pin-you", 5 + cameras);
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (scroll > 0) note(`${prefix}: the mission page scrolls by ${scroll}px; it should fit the screen`);
  if (!(await page.locator(".crosshair").count())) note(`${prefix}: no crosshair on the mission map`);
  await checkPage(page, `${prefix} mission`);
  await shot(page, `${prefix}-3-mission`);

  // "Done": the real alarm plays on the map first. A phone shows only the map meanwhile, a desktop
  // keeps the panel; "Skip" is there and has the focus. Then the alarm's screen, then the reveal.
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.locator(".board-map.mode-replay").waitFor();
  if (!(await page.getByRole("button", { name: t["replay.skip"] }).isVisible())) note(`${prefix}: no "${t["replay.skip"]}" while the alarm plays`);
  const panelHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".board-panel")).display === "none");
  if (vpName === "phone" && !panelHidden) note(`${prefix}: the panel stays on a phone while the alarm plays`);
  if (vpName === "desktop" && panelHidden) note(`${prefix}: the panel disappears on a desktop while the alarm plays`);
  await retryWrite(() => page.screenshot({ path: join(outDir, `${prefix}-3b-replay.png`) }));
  await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} event`);
  // Before the reveal, the alarm's map shows only the ARGUS sensor that raised it.
  if ((await page.locator(".pin-argus").count()) > 1) note(`${prefix} event: ARGUS sensors shown before the reveal`);
  if (!(await page.getByText(t["event.human"]).isVisible())) note(`${prefix} event: no note on what people cannot catch`);
  await checkMap(page, `${prefix} event`, ".alarm-ring", 1);
  await checkPage(page, `${prefix} event`);
  await shot(page, `${prefix}-5-event`);

  await page.getByRole("button", { name: t["event.toReveal"] }).click();
  await page.getByRole("heading", { level: 1, name: t["reveal.heading"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} reveal`);
  await checkMap(page, `${prefix} reveal`);
  const shown = await page.$$eval(".pin-argus", (pins) => pins.reduce((n, p) => n + (Number(p.textContent) || 1), 0));
  const placed = ranverso.installed.points.reduce((n, p) => n + p.instruments.length, 0);
  if (shown !== placed) note(`${prefix} reveal: ARGUS markers show ${shown} instruments, expected ${placed}`);
  if (!(await page.getByText(fill(t["reveal.human"], { name: cardName(lang, "observer") })).isVisible())) {
    note(`${prefix} reveal: no note about the human observer`);
  }
  if (await page.locator(".mix").getByText(cardName(lang, "observer")).count()) note(`${prefix} reveal: observer in the ARGUS table`);
  await checkPage(page, `${prefix} reveal`);
  await shot(page, `${prefix}-4-reveal`);

  await page.getByRole("button", { name: t["reveal.continue"] }).click();
  await page.getByRole("heading", { level: 1, name: t["score.heading"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} score`);
  // No rain gauge or weather station: the replayed rain alarm is missed and that shows in the score.
  if (!(await page.getByText(t["score.alarmNo"]).isVisible())) note(`${prefix} score: missed alarm not shown`);
  // Soil probe, observer and humidity watch groundwater, woodworm and damp periods directly.
  if ((await page.locator(".learn.is-yes").count()) !== 3) note(`${prefix} score: expected 3 fully covered dangers`);
  await checkPage(page, `${prefix} score`);
  await shot(page, `${prefix}-6-score`);

  // The same quiz after the game, all right this time: the before/after comparison must show.
  await page.getByRole("button", { name: t["quiz.open"] }).click();
  await page.getByRole("heading", { level: 1, name: t["quiz.postTitle"] }).waitFor();
  for (const q of data.quiz.questions) await page.locator(`#q-${q.id}-${q.correct}`).check();
  await page.getByRole("button", { name: t["quiz.submit"] }).click();
  await page.getByRole("heading", { level: 1, name: t["quiz.resultTitle"] }).waitFor();
  const total = data.quiz.questions.length;
  const before = data.quiz.questions.filter((q) => q.correct === 0).length;
  if (!(await page.getByText(fill(t["quiz.compare"], { pre: before, post: total, total })).isVisible())) {
    note(`${prefix}: quiz before/after comparison missing`);
  }
  await expectFocusOnHeading(page, `${prefix} quiz results`);
  await checkPage(page, `${prefix} quiz results`);
  await shot(page, `${prefix}-7-quiz`);

  // Narrowest common phone width: nothing may scroll sideways.
  await page.setViewportSize({ width: 320, height: 700 });
  await checkPage(page, `${prefix} score at 320px`);

  if (errors.length) note(`${prefix}: console errors: ${errors.join(" | ")}`);
  await context.close();
}

// Low level replays the last alarm of the rain episode. The soil-moisture alarms from a flat signal
// (probably a stuck sensor) are never replayed; they come back as a discussion question in the reveal.
async function playLowLevel(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const prefix = `${lang}-phone-low`;
  console.log(`
${prefix}`);
  await page.goto(URL_BASE);
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("radio", { name: new RegExp(t["level.low"]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t);
  await toMission(page, t);
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
  if (await page.getByText(t["event.flatNote"]).count()) note(`${prefix}: a flat-signal alarm was replayed`);
  if (!(await page.getByText(fill(t["event.yes"], { names: cardName(lang, "rain_gauge") })).isVisible())) {
    note(`${prefix}: the rain gauge should detect the rain alarm`);
  }
  await checkPage(page, `${prefix} event`);
  await shot(page, `${prefix}-5-event`);
  await page.getByRole("button", { name: t["event.toReveal"] }).click();
  const stuck = ranverso.discussion_prompts.find((p) => p.en.includes("stuck"))[lang];
  await page.getByRole("heading", { level: 1, name: t["reveal.heading"] }).waitFor();
  if (!(await page.getByText(stuck).isVisible())) note(`${prefix}: stuck-sensor question missing from the reveal`);
  await context.close();
}

// Every level of every monument: reaches the alarm and score screens without errors or axe problems.
// The default level of each monument is also saved as a picture.
// Esri sends a grey "Map data not yet available" picture (not an error) where it has no imagery.
// At full zoom on every monument's mission map, no satellite tile may be requested deeper than the
// measured real imagery (content/imagery_zoom.json) and no tile may be that picture.
const SATELLITE_TILE = /World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/;

async function checkImageryDepth(browser) {
  const t = dict.en;
  const satellite = data.basemaps.layers.find((l) => l.id === "satellite");
  const nowhere = await fetch(satellite.url.replace("{z}", "21").replace("{y}", "1048576").replace("{x}", "873813"));
  const placeholder = Buffer.from(await nowhere.arrayBuffer());
  console.log(`
imagery depth (placeholder ${placeholder.length} B)`);
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript(() => localStorage.setItem("guardian.lang", "en"));
  const page = await context.newPage();
  let depths = [];
  let placeholders = 0;
  page.on("request", (r) => {
    const m = SATELLITE_TILE.exec(r.url());
    if (m) depths.push(Number(m[1]));
  });
  page.on("response", async (r) => {
    if (!SATELLITE_TILE.test(r.url())) return;
    const body = await r.body().catch(() => null);
    if (body && body.equals(placeholder)) placeholders += 1;
  });
  for (const mon of data.monuments.filter((m) => m.playable)) {
    const native = mon.map.max_native_zoom.satellite;
    // Count the whole visit: tiles loaded on the story screen are reused (not re-requested) later.
    depths = [];
    placeholders = 0;
    await page.goto(URL_BASE);
    await page.getByRole("radio", { name: new RegExp(mon.display_name.en) }).check();
    await page.getByRole("button", { name: t["home.start"] }).click();
    await preQuiz(page, t);
    await toMission(page, t);
    await page.getByRole("heading", { level: 1, name: t["mission.heading"] }).waitFor();

    // Site guide: one numbered marker per place, a list in the panel, and "Show on map" moves there.
    await checkMap(page, `${mon.pilot_key} site guide`, ".place-pin", mon.places.length);
    await checkPage(page, `${mon.pilot_key} site guide`);
    await shot(page, `en-phone-${mon.pilot_key}-3-guide`);
    const last = mon.places[mon.places.length - 1];
    const placesToggle = page.getByRole("button", { name: t["mission.places"], exact: true });
    if ((await placesToggle.getAttribute("aria-expanded")) !== "true") await placesToggle.click();
    await page.getByRole("button", { name: `${t["mission.showOnMap"]}: ${last.name.en}`, exact: true }).click();
    await page.waitForTimeout(1600);
    const said = await page.locator("[aria-live=polite]").innerText();
    if (!said.includes(last.name.en)) note(`${mon.pilot_key}: "Show on map" for ${last.name.en} was not announced (${said})`);
    await retryWrite(() => page.locator(".board-map").screenshot({ path: join(outDir, `en-phone-${mon.pilot_key}-3-guide-focus.png`) }));

    const zoomIn = page.getByRole("button", { name: t["map.zoomIn"] });
    for (let i = 0; i < 10 && !(await zoomIn.evaluate((el) => el.classList.contains("leaflet-disabled"))); i++) {
      await zoomIn.click();
      await page.waitForTimeout(250);
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);
    const deepest = Math.max(...depths);
    console.log(`  ${mon.pilot_key}: real imagery to ${native}, deepest requested ${deepest}, "not available" tiles ${placeholders}`);
    if (deepest > native) note(`${mon.pilot_key}: satellite tiles requested at zoom ${deepest}, real imagery stops at ${native}`);
    if (deepest < native) note(`${mon.pilot_key}: full zoom never reached the real imagery depth ${native} (got ${deepest})`);
    if (placeholders) note(`${mon.pilot_key}: ${placeholders} "Map data not yet available" tile(s) shown`);
    await retryWrite(() => page.locator(".board-map").screenshot({ path: join(outDir, `en-phone-${mon.pilot_key}-3-fullzoom.png`) }));
  }
  await context.close();
}

const LEVEL_ORDER = ["low", "medium", "high", "extreme", "catastrophic"];
const levelDistance = (a, b) => Math.abs(LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));

// A level picked on the home screen stays when the player then switches monument (or becomes the
// nearest level that monument has), and the game that starts says which level it is.
async function playKeepsChosenLevel(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const prefix = `${lang}-phone-keep-level`;
  console.log(`
${prefix}`);
  const baltanas = data.monuments.find((m) => m.pilot_key === "baltanas");
  const level = (id) => page.getByRole("radio", { name: new RegExp(t[`level.${id}`]) });
  await page.goto(URL_BASE);
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await level("low").check();
  await page.getByRole("radio", { name: new RegExp(baltanas.display_name[lang]) }).check();
  // Baltanás has no Low dangers: the nearest level it has is Medium, never its highest (Extreme).
  if (!(await level("medium").isChecked())) note(`${prefix}: Low at Ranverso, then Baltanás: Medium should be selected`);
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  if (!(await level("low").isChecked())) note(`${prefix}: back at Ranverso the chosen Low should be selected again`);
  await page.getByRole("radio", { name: new RegExp(baltanas.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t);
  const badge = fill(t["level.badge"], { level: t["level.medium"] });
  if (!(await page.locator(".mission-brief", { hasText: badge }).count())) note(`${prefix}: story does not show "${badge}"`);
  await checkPage(page, `${prefix} story`);
  await shot(page, `${prefix}-2-story`);
  await context.close();
}

// Sound: what the player does is heard (counted as notes the page starts, so no speaker is
// needed), the top bar turns it off, the choice survives a reload, and the alarm replay sounds.
async function checkSound(browser, lang) {
  const t = dict[lang];
  const prefix = `${lang}-phone-sound`;
  console.log(`\n${prefix}`);
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => {
    if (!sessionStorage.getItem("langSet")) {
      localStorage.setItem("guardian.lang", l);
      sessionStorage.setItem("langSet", "1");
    }
    window.__notes = 0;
    const Real = window.AudioContext;
    if (Real) {
      window.AudioContext = class extends Real {
        createOscillator() {
          const osc = super.createOscillator();
          const start = osc.start.bind(osc);
          osc.start = (...a) => {
            window.__notes += 1;
            return start(...a);
          };
          return osc;
        }
      };
    }
  }, lang);
  const page = await context.newPage();
  const notes = () => page.evaluate(() => window.__notes);
  const toggle = page.getByRole("button", { name: t["sound.label"], exact: true });
  await page.goto(URL_BASE);
  await page.getByRole("heading", { level: 1, name: t["app.title"] }).waitFor();
  if ((await toggle.getAttribute("aria-pressed")) !== "true") note(`${prefix}: sound is not on at first`);
  if ((await notes()) !== 0) note(`${prefix}: sound before the player did anything`);
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t);
  await toMission(page, t);
  const add = (id) => page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, id) }), exact: true });
  await add("humidity").click();
  const afterPlace = await notes();
  if (!(afterPlace > 0)) note(`${prefix}: placing a sensor made no sound`);
  // While placing sensors on a phone the top band is hidden: the sound button is in the "?" card.
  await page.getByRole("button", { name: t["mission.help"] }).click();
  const cardToggle = page.locator(".help-card .sound-toggle");
  await cardToggle.click();
  if ((await cardToggle.getAttribute("aria-pressed")) !== "false") note(`${prefix}: the sound button did not turn sound off`);
  await page.keyboard.press("Escape");
  await add("rain_gauge").click();
  if ((await notes()) !== afterPlace) note(`${prefix}: sound with sound turned off`);
  await page.reload();
  await page.getByRole("heading", { level: 1, name: t["app.title"] }).waitFor();
  if ((await toggle.getAttribute("aria-pressed")) !== "false") note(`${prefix}: "sound off" was not remembered`);
  await checkPage(page, `${prefix} home`);
  await toggle.click();
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t); // a reload is a new visit: the quiz comes first again
  await toMission(page, t);
  await add("rain_gauge").click();
  const beforeReplay = await notes();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
  if (!((await notes()) > beforeReplay)) note(`${prefix}: the alarm replay made no sound`);
  await context.close();
}

// A week on duty: every day's real alarm plays on the map before its screen, not only the first
// day's. On a phone the map takes the whole screen for it, also when it starts from the score.
async function checkWeekReplay(browser, lang) {
  const t = dict[lang];
  const prefix = `${lang}-phone-week`;
  console.log(`\n${prefix}`);
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t);
  await toMission(page, t);
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("button", { name: t["event.toReveal"] }).click();
  await page.getByRole("button", { name: t["reveal.continue"] }).click();
  for (const day of [2, 3]) {
    await page.getByRole("heading", { level: 1, name: t["score.heading"] }).waitFor();
    await page.getByRole("button", { name: fill(t["week.next"], { n: day }) }).click();
    const played = await page.locator(".board-map.mode-replay").waitFor({ timeout: 3000 }).then(() => true, () => false);
    if (!played) note(`${prefix}: day ${day}'s alarm did not play on the map`);
    else {
      const share = await page.evaluate(() => document.querySelector(".board-map").getBoundingClientRect().height / innerHeight);
      if (share < 0.95) note(`${prefix}: day ${day}: the map has only ${Math.round(share * 100)}% of the screen while the alarm plays`);
      if (day === 2) await retryWrite(() => page.screenshot({ path: join(outDir, `${prefix}-day2-replay.png`) }));
    }
    await page.getByRole("heading", { level: 1, name: fill(t["week.eventHeading"], { n: day }) }).waitFor();
    await page.getByRole("button", { name: t["event.continue"] }).click();
  }
  await context.close();
}

// The whole story: every monument's story screen offers it; it goes chapter by chapter and ends
// back at the story screen's danger, focused, so the mission is one step away.
async function checkHistory(browser, lang) {
  const t = dict[lang];
  const prefix = `${lang}-phone-history`;
  console.log(`\n${prefix}`);
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  let shown = false;
  for (const mon of data.monuments.filter((m) => m.playable)) {
    const label = `${prefix} ${mon.pilot_key}`;
    await page.goto(URL_BASE);
    await page.getByRole("radio", { name: new RegExp(mon.display_name[lang]) }).check();
    await page.getByRole("button", { name: t["home.start"] }).click();
    await preQuiz(page, t);
    const more = page.getByRole("button", { name: t["story.readMore"] });
    if (!mon.history) {
      if (await more.count()) note(`${label}: "${t["story.readMore"]}" without a story to read`);
      continue;
    }
    await more.click();
    await page.getByRole("heading", { level: 1, name: t["history.heading"] }).waitFor();
    const chapters = mon.history.chapters.length;
    for (let i = 1; i < chapters; i++) {
      if (i === 2 && !shown) {
        await checkPage(page, `${label} chapter`);
        await shot(page, `${prefix}-chapter`);
        shown = true;
      }
      await page.getByRole("button", { name: t["history.next"], exact: true }).click();
      await page.locator(".history-chapter .eyebrow", { hasText: fill(t["history.chapter"], { n: i + 1, total: chapters }) }).waitFor();
    }
    if (await page.getByRole("button", { name: t["history.next"], exact: true }).count()) note(`${label}: the last chapter still offers "${t["history.next"]}"`);
    await page.getByRole("button", { name: t["history.done"] }).click();
    await page.getByRole("heading", { level: 1, name: mon.display_name[lang] }).waitFor();
    if ((await page.evaluate(() => document.activeElement?.id)) !== "hook-title") note(`${label}: the story does not end at the danger`);
  }
  await context.close();
}

async function playEveryMonument(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  console.log(`\n${lang}-monuments`);
  let replayChecked = false;
  for (const mon of data.monuments.filter((m) => m.playable)) {
    const levels = mon.levels.filter((l) => l.available);
    for (const lv of levels) {
      const label = `${lang} ${mon.pilot_key} ${lv.id}`;
      await page.goto(URL_BASE);
      await page.getByRole("radio", { name: new RegExp(mon.display_name[lang]) }).check();
      await page.getByRole("radio", { name: new RegExp(t[`level.${lv.id}`]) }).check();
      await page.getByRole("button", { name: t["home.start"] }).click();
      await preQuiz(page, t);
      await page.getByRole("heading", { level: 1, name: mon.display_name[lang] }).waitFor();
      // The story says which level was chosen, and its danger card is one of this mission's dangers.
      const badge = fill(t["level.badge"], { level: t[`level.${lv.id}`] });
      if (!(await page.locator(".mission-brief", { hasText: badge }).count())) note(`${label}: story does not show "${badge}"`);
      const hookTitle = await page.locator(".threat-hook h2").innerText();
      const hookDanger = lv.mission.map((k) => mon.scenarios.find((sc) => sc.scenario_key === k)).find((sc) => sc.plain.title[lang] === hookTitle);
      if (!hookDanger) note(`${label}: the story's danger "${hookTitle}" is not in the mission`);
      else if (levelDistance(hookDanger.level, lv.id) > 1) note(`${label}: the story's danger is ${hookDanger.level}`);
      await toMission(page, t);
      // One card that helps with the first mission threat, when there is one.
      const first = mon.scenarios.find((s) => s.scenario_key === lv.mission[0]);
      const card = first.primary_cards[0] ?? "humidity";
      await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, card) }), exact: true }).click();
      await page.getByRole("button", { name: t["mission.done"] }).click();
      await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
      const alarm = mon.alarms.find((a) => a.id === lv.featured_alarm);
      if (alarm && !(await page.locator(".result").count())) note(`${label}: alarm ${alarm.id} not replayed`);
      if (!alarm && !(await page.getByText(mon.no_alarm_note?.[lang] ?? t["event.none"]).isVisible())) {
        note(`${label}: no explanation for the missing alarm`);
      }
      // A danger linked to this alarm that ARGUS's risk model raised soon after: the screen says so.
      const raisedAfter = alarm?.context?.links?.some((k) =>
        mon.scenarios.find((sc) => sc.scenario_key === k)?.risk?.raised?.some((r) => {
          const lag = Date.parse(r.from) - Date.parse(`${alarm.timestamp}Z`);
          return lag >= -3_600_000 && lag <= 3 * 86_400_000;
        }),
      );
      const riskShown = (await page.locator(".risk-note").count()) > 0;
      if (raisedAfter && !riskShown) note(`${label}: risk-model rise after the alarm not shown`);
      if (!raisedAfter && riskShown) note(`${label}: risk-model note shown without a rise after this alarm`);
      if (raisedAfter) await shot(page, `${lang}-phone-${mon.pilot_key}-${lv.id}-5-risk`);
      const isDefault = lv === levels[levels.length - 1];
      if (isDefault) {
        await checkPage(page, `${label} event`);
        await shot(page, `${lang}-phone-${mon.pilot_key}-5-event`);
      }
      await page.getByRole("button", { name: t["event.toReveal"] }).click();
      await page.getByRole("heading", { level: 1, name: t["reveal.heading"] }).waitFor();
      await page.getByRole("button", { name: t["reveal.continue"] }).click();
      await page.getByRole("heading", { level: 1, name: t["score.heading"] }).waitFor();
      if (isDefault) {
        await checkPage(page, `${label} score`);
        await shot(page, `${lang}-phone-${mon.pilot_key}-6-score`);
      }
      // "Play again with new dangers": once per language, on the first level with enough dangers.
      const newDangers = page.getByRole("button", { name: t["score.playNew"], exact: true });
      if (!replayChecked && (await newDangers.count())) {
        replayChecked = true;
        const before = await page.locator(".learn h3").allInnerTexts();
        await newDangers.click();
        await page.getByRole("heading", { level: 1, name: mon.display_name[lang] }).waitFor();
        await toMission(page, t);
        await page.getByRole("heading", { level: 1, name: t["mission.heading"] }).waitFor();
        const after = await page.locator(".danger-chip > span:last-child, .help-dangers strong").allTextContents();
        if (after.length !== 3) note(`${label}: new mission has ${after.length} dangers`);
        if (after.every((x) => before.includes(x))) note(`${label}: "play again with new dangers" kept the same dangers`);
        await shot(page, `${lang}-phone-${mon.pilot_key}-${lv.id}-3-new-dangers`);
      }
    }
  }
  if (!replayChecked) note(`${lang}-monuments: no level offered "play again with new dangers"`);
  if (errors.length) note(`${lang}-monuments: page errors: ${errors.join(" | ")}`);
  await context.close();
}

// Class code: a wrong code is refused, a right one is joined, the score shows the class, and the
// teacher page lists the class's game.
async function playClassAndTeacher(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const prefix = `${lang}-phone-class`;
  console.log(`\n${prefix}`);
  await page.goto(URL_BASE);
  const field = page.getByLabel(t["class.label"]);
  await field.fill("ab-10");
  await field.press("Enter"); // must join (and fail), not start the game
  if (!(await page.getByText(t["class.invalid"]).isVisible())) note(`${prefix}: wrong class code accepted`);
  await field.fill("abc 234");
  await page.getByRole("button", { name: t["class.join"] }).click();
  if (!(await page.locator("#main").getByText(fill(t["class.in"], { code: "ABC234" })).isVisible())) note(`${prefix}: class not joined`);
  await checkPage(page, `${prefix} home`);
  await shot(page, `${prefix}-1-home`);

  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t);
  await toMission(page, t);
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("button", { name: t["event.toReveal"] }).click();
  await page.getByRole("button", { name: t["reveal.continue"] }).click();
  // The class is named on the fold that holds the community results.
  if (!(await page.locator(".community summary", { hasText: fill(t["score.communityClass"], { code: "ABC234" }) }).isVisible())) {
    note(`${prefix}: score does not show the class`);
  }
  await page.getByRole("button", { name: t["score.otherLevel"] }).click();
  await page.getByRole("button", { name: t["class.teacher"] }).click();
  await page.getByRole("heading", { level: 1, name: t["teacher.title"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} teacher`);
  if (!(await page.getByText(fill(t["teacher.games"], { n: 1 })).isVisible())) note(`${prefix}: teacher page misses the game`);
  await checkPage(page, `${prefix} teacher`);
  await shot(page, `${prefix}-2-teacher`);
  await context.close();
}

// Offline after one visit: the service worker serves the game, the data and the drawn plan.
async function playOffline(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const prefix = `${lang}-phone-offline`;
  console.log(`\n${prefix}`);
  await page.goto(URL_BASE);
  await page.getByRole("heading", { level: 1, name: t["app.title"] }).waitFor();
  const ready = await page
    .evaluate(() => navigator.serviceWorker.ready.then(() => true))
    .catch(() => false);
  if (!ready) {
    note(`${prefix}: no service worker`);
    await context.close();
    return;
  }
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await context.setOffline(true);
  try {
    await page.goto(`${URL_BASE}?class=ABC234`);
    await page.getByRole("heading", { level: 1, name: t["app.title"] }).waitFor({ timeout: 15000 });
    await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
    await page.getByRole("button", { name: t["home.start"] }).click();
    await preQuiz(page, t);
    await page.getByRole("heading", { level: 1, name: ranverso.display_name[lang] }).waitFor();
    await page.waitForSelector(".bd-heritage", { timeout: 15000 }).catch(() => note(`${prefix}: drawn plan missing offline`));
    await shot(page, `${prefix}-2-story`);
  } catch (e) {
    note(`${prefix}: the game does not load offline (${String(e).split("\n")[0]})`);
  }
  await context.close();
}

// Map pictures blocked (offline, or a sandbox that only allows its own files): the game must
// switch to the drawn plan by itself, say so, and stay fully playable.
async function playWithoutMapPictures(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.route(/arcgisonline\.com|openstreetmap\.org/, (route) => route.abort());
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const prefix = `${lang}-phone-plan`;
  console.log(`
${prefix}`);
  await page.goto(URL_BASE);
  try {
    await page.locator(".map-notice", { hasText: t["map.planFallback"] }).waitFor({ timeout: 15000 });
  } catch {
    note(`${prefix}: no switch to the plan when map pictures are blocked`);
  }
  await page.waitForSelector(".bd-land", { timeout: 15000 }).catch(() => note(`${prefix}: no land drawn on the plan`));
  await checkPage(page, `${prefix} home`);
  await shot(page, `${prefix}-1-home`);
  await page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(page, t);
  await page.waitForSelector(".bd-heritage", { timeout: 15000 }).catch(() => note(`${prefix}: church outline missing`));
  await checkPage(page, `${prefix} story`);
  await shot(page, `${prefix}-2-story`);
  await toMission(page, t);
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "soil_moisture") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("button", { name: t["event.toReveal"] }).click();
  await page.getByRole("heading", { level: 1, name: t["reveal.heading"] }).waitFor();
  if ((await page.locator(".pin-argus").count()) === 0) note(`${prefix}: no ARGUS sensors on the plan`);
  await checkPage(page, `${prefix} reveal`);
  await shot(page, `${prefix}-4-reveal`);
  if (errors.length) note(`${prefix}: page errors: ${errors.join(" | ")}`);
  await context.close();
}

// Bad data must never leave an empty page. An older data pack (as an earlier version's offline
// copy served it) gets one reload, then a message with "try again". A crash on a screen (here a
// level without coins) shows the crash message with a reload button.
async function playWithBadData(browser, lang) {
  const t = dict[lang];
  const prefix = `${lang}-phone-bad-data`;
  console.log(`\n${prefix}`);
  const open = async (pack) => {
    const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
    await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
    await context.route(/data\/game_data\.json/, (route) => route.fulfill({ json: pack }));
    const page = await context.newPage();
    return { context, page };
  };

  const stale = await open({ ...data, schema_version: data.schema_version - 1 });
  let loads = 0;
  stale.page.on("load", () => loads++);
  await stale.page.goto(URL_BASE);
  try {
    await stale.page.getByRole("alert").filter({ hasText: t["app.loadError"] }).waitFor({ timeout: 15000 });
    if (!(await stale.page.getByRole("button", { name: t["app.retry"] }).isVisible())) note(`${prefix}: no "try again" after old data`);
  } catch {
    note(`${prefix}: no message after old data (root: ${(await stale.page.locator("#root").innerHTML()).length} characters)`);
  }
  if (loads !== 2) note(`${prefix}: old data should reload the page exactly once (loaded ${loads} times)`);
  await stale.context.close();

  const noCoins = structuredClone(data);
  for (const level of noCoins.monuments.find((m) => m.pilot_key === "ranverso").levels) delete level.budget;
  const broken = await open(noCoins);
  await broken.page.goto(URL_BASE);
  await broken.page.getByRole("radio", { name: new RegExp(ranverso.display_name[lang]) }).check();
  await broken.page.getByRole("button", { name: t["home.start"] }).click();
  await preQuiz(broken.page, t);
  try {
    await broken.page.getByRole("alert").filter({ hasText: t["app.crash"] }).waitFor({ timeout: 10000 });
    if (!(await broken.page.getByRole("button", { name: t["app.reload"] }).isVisible())) note(`${prefix}: no reload button after a crash`);
    await shot(broken.page, `${prefix}-crash`);
  } catch {
    note(`${prefix}: no message after a crash (root: ${(await broken.page.locator("#root").innerHTML()).length} characters)`);
  }
  await broken.context.close();
}

mkdirSync(outDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: process.env.BROWSER_CHANNEL || "msedge" }),
  headless: true,
});
try {
  const only = process.env.SCREENSHOT_ONLY; // e.g. "monuments" to run just that part
  if (!only) for (const lang of ["el", "en"]) for (const vp of Object.keys(VIEWPORTS)) await play(browser, lang, vp);
  if (!only) for (const lang of ["el", "en"]) await playLowLevel(browser, lang);
  if (!only || only === "monuments") for (const lang of ["el", "en"]) await playKeepsChosenLevel(browser, lang);
  if (!only || only === "sound") for (const lang of ["el", "en"]) await checkSound(browser, lang);
  if (!only || only === "week") for (const lang of ["el", "en"]) await checkWeekReplay(browser, lang);
  if (!only || only === "history") for (const lang of ["el", "en"]) await checkHistory(browser, lang);
  if (!only || only === "monuments") for (const lang of ["el", "en"]) await playEveryMonument(browser, lang);
  if (!only || only === "imagery") await checkImageryDepth(browser);
  if (!only || only === "class") for (const lang of ["el", "en"]) await playClassAndTeacher(browser, lang);
  if (!only || only === "offline") await playOffline(browser, "el");
  if (!only) for (const lang of ["el", "en"]) await playWithoutMapPictures(browser, lang);
  if (!only || only === "bad-data") for (const lang of ["el", "en"]) await playWithBadData(browser, lang);
} finally {
  await browser.close();
  server.kill();
}

console.log(problems.length ? `\n${problems.length} problem(s) found.` : "\nNo problems found.");
process.exit(problems.length ? 1 : 0);
