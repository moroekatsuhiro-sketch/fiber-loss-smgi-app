const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = path.join(__dirname, name === "/" ? "index.html" : name);
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.on("listening", resolve));
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.fill("#workNo", "26001");
    await page.fill("#inputDate", "2026-09-08");
    await page.fill("#siteName", "試験現場");
    await page.fill("#sectionName", "盤A ～ 盤B");
    await page.fill("#cableLengthM", "100");
    await page.fill("#startCalibration_1310", "0");
    await page.fill("#endCalibration_1310", "-1.23");
    await page.click("#calculateBtn");
    await page.locator('.measure-input[data-wave="1310"][data-side="start"]').first().fill("0.5");
    await page.click("#saveBtn");
    const original = await page.evaluate(() => loadRecords()[0]);
    assert.equal(original.inputDate, "2026-09-08");
    assert.equal(original.measurements["1310"].startCalibration, 0);
    await page.reload();
    assert.equal(await page.locator("#saveBtn").innerText(), "履歴を上書き");
    await page.click("#newDraftBtn");
    await page.fill("#inputDate", "2026-09-08");
    await page.fill("#workNo", "26001");
    assert.equal(await page.inputValue("#startCalibration_1310"), "0.00");
    assert.equal(await page.inputValue("#endCalibration_1310"), "-1.23");
    assert.equal(await page.inputValue("#startCalibration_1550"), "");
    await page.waitForTimeout(250);
    await page.reload();
    await page.fill("#inputDate", "2026-09-09");
    assert.equal(await page.inputValue("#startCalibration_1310"), "");
    await page.fill("#inputDate", "2026-09-08");
    assert.equal(await page.inputValue("#startCalibration_1310"), "0.00");
    await page.fill("#startCalibration_1310", "2.34");
    await page.fill("#workNo", "26002");
    assert.equal(await page.inputValue("#startCalibration_1310"), "2.34");
    assert.equal(await page.inputValue("#endCalibration_1310"), "");
    await page.selectOption("#cableType", "GI");
    assert.equal(await page.inputValue("#startCalibration_850"), "");
    await page.click('[data-screen="historyScreen"]');
    await page.click(".duplicate-record-btn");
    assert.equal(await page.locator("#saveBtn").innerText(), "履歴に保存");
    assert.equal(await page.inputValue("#sectionName"), "盤A ～ 盤B");
    await page.fill("#sectionName", "盤C ～ 盤D");
    await page.click("#saveBtn");
    let records = await page.evaluate(() => loadRecords());
    assert.equal(records.length, 2);
    assert.deepEqual(records.find(r => r.id === original.id), original);
    await page.click('[data-screen="historyScreen"]');
    await page.fill("#historyWorkFilter", "99999");
    assert.equal(await page.locator(".history-item").count(), 0);
    await page.fill("#historyWorkFilter", "K-26001");
    assert.equal(await page.locator(".history-item").count(), 2);
    await page.locator(".copy-record-btn").first().click();
    const copied = await page.inputValue("#historyClipboard");
    assert.equal(JSON.parse(copied).format, "fiber-loss-smgi-history");
    await page.click("#pasteHistoryBtn");
    assert.equal(await page.locator("#saveBtn").innerText(), "履歴に保存");
    await page.click("#saveBtn");
    assert.equal(await page.evaluate(() => loadRecords().length), 3);
    await page.click('[data-screen="historyScreen"]');
    await page.fill("#historyClipboard", '{"record":{}}');
    await page.click("#pasteHistoryBtn");
    assert.match(await page.locator("#historyTransferStatus").innerText(), /対応する/);
    assert.equal(await page.evaluate(() => loadRecords().length), 3);
    const checks = await page.evaluate(() => {
      const r = loadRecords()[0];
      const otherDate = { ...r, id: "other", inputDate: "2026-09-07", updatedAt: "2026-09-10T00:00:00Z" };
      const legacy = { ...r, id: "legacy", inputDate: undefined, savedAt: "2026-09-08T01:00:00Z" };
      const matches = matchingCalibrations([otherDate, legacy], "26001", "2026-09-08", "SM", 1310);
      const csv = buildCsvRows([r]);
      return { source: matches.startCalibration.record.id, csvDate: csv[1][1],
        csvAligned: csv.every(row => row.length === csv[0].length),
        invalidDate: isValidInputDate("2026-02-30"),
        noMatch: Object.keys(matchingCalibrations([r], "26099", "2026-09-08", "SM", 1310)).length };
    });
    assert.deepEqual(checks, { source: "legacy", csvDate: "2026-09-08", csvAligned: true, invalidDate: false, noMatch: 0 });
    // Panel changes must keep naming automatic after editing, copying and restoring.
    await page.locator(".edit-record-btn").first().click();
    await page.fill("#startPanel", "始端A");
    await page.fill("#endPanel", "遠端B");
    assert.equal(await page.inputValue("#sectionName"), "始端A ～ 遠端B");
    await page.fill("#sectionName", "手入力した区間");
    await page.fill("#endPanel", "遠端C");
    assert.equal(await page.inputValue("#sectionName"), "始端A ～ 遠端C");
    await page.fill("#endPanel", "");
    assert.equal(await page.inputValue("#sectionName"), "");
    await page.fill("#endPanel", "遠端D");
    await page.click("#saveBtn");
    assert.equal(await page.evaluate(() => loadRecords()[0].sectionName), "始端A ～ 遠端D");
    await page.reload();
    await page.fill("#startPanel", "始端E");
    assert.equal(await page.inputValue("#sectionName"), "始端E ～ 遠端D");
    await page.evaluate(() => {
      const draft = buildDraftData();
      draft.form.sectionManual = "true"; // Old-version drafts must not disable updates.
      restoreDraft(draft);
    });
    await page.fill("#endPanel", "遠端F");
    assert.equal(await page.inputValue("#sectionName"), "始端E ～ 遠端F");
    await page.click('[data-screen="historyScreen"]');
    await page.locator(".duplicate-record-btn").first().click();
    await page.fill("#startPanel", "複製始端");
    assert.equal(await page.inputValue("#sectionName"), "複製始端 ～ 遠端D");
    await page.click('[data-screen="historyScreen"]');
    await page.locator(".copy-record-btn").first().click();
    await page.click("#pasteHistoryBtn");
    await page.fill("#endPanel", "貼付遠端");
    assert.equal(await page.inputValue("#sectionName"), "始端A ～ 貼付遠端");
    await page.click("#newDraftBtn");
    await page.fill("#startPanel", "  新規始端  ");
    await page.fill("#endPanel", " 新規遠端 ");
    assert.equal(await page.inputValue("#sectionName"), "新規始端 ～ 新規遠端");
    await page.click('[data-screen="historyScreen"]');
    console.log("PASS: section name after new input, manual edit, history edit, duplicate, paste, reload, legacy draft, clearing and save.");
    await page.locator("#historyWorkFilter").focus();
    await page.evaluate(() => { hideInputPreview(); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(__dirname, "history-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(__dirname, "history-desktop.png") });
    assert.deepEqual(errors, []);
    console.log("PASS: date/work/type/wavelength matching, zero calibration, manual values, reload provenance, overwrite restore, duplicate, clipboard round trip, malformed paste, filtering, legacy date and CSV.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
