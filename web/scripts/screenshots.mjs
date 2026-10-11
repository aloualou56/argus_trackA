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
}

async function expectFocusOnHeading(page, label) {
  const tag = await page.evaluate(() => document.activeElement?.tagName);
  if (tag !== "H1") note(`${label}: focus is on ${tag}, expected the H1 after a screen change`);
}

const ranverso = data.monuments.find((m) => m.pilot_key === "ranverso");

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
    await page.screenshot({ path: join(outDir, `${name}-panel.png`), fullPage: true });
  }
  await page.screenshot({ path: join(outDir, `${name}.png`) });
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
  await page.getByRole("heading", { level: 1, name: t["mission.heading"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} mission`);

  if (!(await page.locator(".crosshair-label").isVisible())) note(`${prefix}: no "sensors go here" label before the first pin`);
  await page.locator(".board-map").screenshot({ path: join(outDir, `${prefix}-3-reticle.png`) });

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
  const coinsText = fill(t["mission.coinsLeft"], { left: ranverso.budget - 2 * 1 - 2 - 2, budget: ranverso.budget });
  if (!(await page.locator("#main").getByText(coinsText).isVisible())) note(`${prefix}: expected "${coinsText}"`);

  // Overspending is blocked and announced (the camera costs more than the coins left).
  await add("camera").click({ force: true });
  const afterCamera = await page.locator("[aria-live=polite]").innerText();
  if (!afterCamera.includes(fill(t["mission.notEnough"], { name: cardName(lang, "camera") }))) {
    note(`${prefix}: overspending was not announced (${afterCamera})`);
  }
  // The human observer joins the network but gets no pin.
  await add("observer").click();
  // humidity x2, soil x1, crack x1: four pins
  await checkMap(page, `${prefix} mission`, ".pin-you", 4);
  if (!(await page.locator(".crosshair").count())) note(`${prefix}: no crosshair on the mission map`);
  await checkPage(page, `${prefix} mission`);
  await shot(page, `${prefix}-3-mission`);

  await page.getByRole("button", { name: t["mission.done"] }).click();
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
  await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
  await expectFocusOnHeading(page, `${prefix} event`);
  if (!(await page.getByText(t["event.human"]).isVisible())) note(`${prefix} event: no note on what people cannot catch`);
  await checkMap(page, `${prefix} event`, ".alarm-ring", 1);
  await checkPage(page, `${prefix} event`);
  await shot(page, `${prefix}-5-event`);

  await page.getByRole("button", { name: t["event.continue"] }).click();
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
  await page.getByRole("button", { name: t["story.continue"] }).click();
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  const stuck = ranverso.discussion_prompts.find((p) => p.en.includes("stuck"))[lang];
  if (!(await page.getByText(stuck).isVisible())) note(`${prefix}: stuck-sensor question missing from the reveal`);
  await page.getByRole("button", { name: t["reveal.continue"] }).click();
  await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
  if (await page.getByText(t["event.flatNote"]).count()) note(`${prefix}: a flat-signal alarm was replayed`);
  if (!(await page.getByText(fill(t["event.yes"], { names: cardName(lang, "rain_gauge") })).isVisible())) {
    note(`${prefix}: the rain gauge should detect the rain alarm`);
  }
  await checkPage(page, `${prefix} event`);
  await shot(page, `${prefix}-5-event`);
  await context.close();
}

// Every level of every monument: reaches the alarm and score screens without errors or axe problems.
// The default level of each monument is also saved as a picture.
async function playEveryMonument(browser, lang) {
  const t = dict[lang];
  const context = await browser.newContext({ ...VIEWPORTS.phone, reducedMotion: "reduce" });
  await context.addInitScript((l) => localStorage.setItem("guardian.lang", l), lang);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  console.log(`\n${lang}-monuments`);
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
      await page.getByRole("button", { name: t["story.continue"] }).click();
      // One card that helps with the first mission threat, when there is one.
      const first = mon.scenarios.find((s) => s.scenario_key === lv.mission[0]);
      const card = first.primary_cards[0] ?? "humidity";
      await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, card) }), exact: true }).click();
      await page.getByRole("button", { name: t["mission.done"] }).click();
      await page.getByRole("heading", { level: 1, name: t["reveal.heading"] }).waitFor();
      await page.getByRole("button", { name: t["reveal.continue"] }).click();
      await page.getByRole("heading", { level: 1, name: t["event.heading"] }).waitFor();
      const alarm = mon.alarms.find((a) => a.id === lv.featured_alarm);
      if (alarm && !(await page.locator(".result").count())) note(`${label}: alarm ${alarm.id} not replayed`);
      if (!alarm && !(await page.getByText(mon.no_alarm_note?.[lang] ?? t["event.none"]).isVisible())) {
        note(`${label}: no explanation for the missing alarm`);
      }
      const isDefault = lv === levels[levels.length - 1];
      if (isDefault) {
        await checkPage(page, `${label} event`);
        await shot(page, `${lang}-phone-${mon.pilot_key}-5-event`);
      }
      await page.getByRole("button", { name: t["event.continue"] }).click();
      await page.getByRole("heading", { level: 1, name: t["score.heading"] }).waitFor();
      if (isDefault) {
        await checkPage(page, `${label} score`);
        await shot(page, `${lang}-phone-${mon.pilot_key}-6-score`);
      }
    }
  }
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
  await page.getByRole("button", { name: t["story.continue"] }).click();
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("button", { name: t["reveal.continue"] }).click();
  await page.getByRole("button", { name: t["event.continue"] }).click();
  if (!(await page.getByRole("heading", { name: fill(t["score.communityClass"], { code: "ABC234" }) }).isVisible())) {
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
  await page.getByRole("button", { name: t["story.continue"] }).click();
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "rain_gauge") }), exact: true }).click();
  await page.getByRole("button", { name: fill(t["mission.add"], { name: cardName(lang, "soil_moisture") }), exact: true }).click();
  await page.getByRole("button", { name: t["mission.done"] }).click();
  await page.getByRole("heading", { level: 1, name: t["reveal.heading"] }).waitFor();
  if ((await page.locator(".pin-argus").count()) === 0) note(`${prefix}: no ARGUS sensors on the plan`);
  await checkPage(page, `${prefix} reveal`);
  await shot(page, `${prefix}-4-reveal`);
  if (errors.length) note(`${prefix}: page errors: ${errors.join(" | ")}`);
  await context.close();
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
  if (!only || only === "monuments") for (const lang of ["el", "en"]) await playEveryMonument(browser, lang);
  if (!only || only === "class") for (const lang of ["el", "en"]) await playClassAndTeacher(browser, lang);
  if (!only || only === "offline") await playOffline(browser, "el");
  if (!only) for (const lang of ["el", "en"]) await playWithoutMapPictures(browser, lang);
} finally {
  await browser.close();
  server.kill();
}

console.log(problems.length ? `\n${problems.length} problem(s) found.` : "\nNo problems found.");
process.exit(problems.length ? 1 : 0);
