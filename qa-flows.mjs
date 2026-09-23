export default async function run(page, ui) {
  const out = {};
  const log = [];
  const t0 = Date.now();
  const el = () => Date.now() - t0;

  // Register a fresh student through the real UI
  page.setDefaultTimeout(4000);
  page.setDefaultNavigationTimeout(6000);
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" }).catch(e => { out.gotoErr = String(e).slice(0, 120); });
  await page.waitForTimeout(1500);

  // Find the "Ro'yxatdan o'tish" nav button
  const nav = await ui.snapshot();
  const loginRef = nav.match(/@(e\d+) button "Kirish"/i)?.[1];
  out.navFound = { loginRef, loadMs: el() };
  if (!loginRef) return { ...out, snap: nav.slice(0, 1200) };

  if (loginRef) {
    await ui.click(loginRef);
    await page.waitForTimeout(700);
    out.clickMs = el();
    const after = await ui.snapshot();
    out.loginForm = after
      .split("\n")
      .filter((l) => /textbox|button "/.test(l))
      .slice(0, 10)
      .join(" | ");
    const inputs = after.match(/@(e\d+) textbox/g) || [];
    out.loginInputs = inputs.length;
    if (inputs.length >= 2) {
      const ids = after.match(/@(e\d+) textbox/g).map((s) => s.split(" ")[0]);
      await ui.fill(ids[0], "student@cefrmaster.uz");
      await ui.fill(ids[1], "Student@2026");
      const snap2 = await ui.snapshot();
      const sub = snap2.match(
        /@(e\d+) button "(Kirish|Yuborish|Submit|Login)[^"]*"/i,
      )?.[1];
      out.loginSubmit = sub;
      if (sub) {
        await ui.click(sub);
        out.loginMs = el();
        await page.waitForTimeout(2500);
        out.afterLogin = await page.evaluate(() => ({
          url: location.href,
          hash: location.hash,
          body: document.body.innerText.slice(0, 400),
        }));
        // Go to tests list
        await page.goto("http://localhost:3000/#tests", {
          waitUntil: "domcontentloaded",
        });
        await page.waitForTimeout(2000);
        out.catalogMs = el();
        out.testsPage = await page.evaluate(() =>
          document.body.innerText.slice(0, 300),
        );
        log.push("logged in");
      }
    }
  }

  out.log = log;
  return out;
}
