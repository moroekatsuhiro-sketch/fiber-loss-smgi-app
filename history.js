// History helpers are shared by the input form, exports and regression tests.
function localInputDate(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function isValidInputDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return localInputDate(new Date(value + "T12:00:00")) === value;
}

function recordInputDate(record) {
  return isValidInputDate(record.inputDate) ? record.inputDate : localInputDate(record.savedAt);
}

function recordTime(record) {
  return Date.parse(record.updatedAt || record.savedAt) || 0;
}

function matchingCalibrations(records, workNo, inputDate, cableType, wave, excludeId) {
  if (!/^\d{5}$/.test(workNo) || !isValidInputDate(inputDate)) return {};
  const matches = records.filter(record =>
    record.id !== excludeId && String(record.workNo) === workNo &&
    recordInputDate(record) === inputDate && record.cableType === cableType &&
    (record.wavelengths || []).map(String).includes(String(wave))
  ).sort((a, b) => recordTime(b) - recordTime(a));
  const found = {};
  for (const kind of ["startCalibration", "endCalibration"]) {
    for (const record of matches) {
      const raw = record.measurements?.[wave]?.[kind] ?? record.waveSettings?.[wave]?.[kind];
      if (raw === null || raw === undefined || String(raw).trim() === "" || !Number.isFinite(Number(raw))) continue;
      found[kind] = { value: formatCalibrationInputValue(raw), record };
      break;
    }
  }
  return found;
}

function applyMatchingCalibration() {
  const workNo = $("workNo").value;
  const inputDate = $("inputDate").value;
  const cableType = $("cableType").value;
  const context = [workNo, inputDate, cableType].join("|");
  const records = loadRecords();
  const notices = [];
  // Remove only unchanged automatically quoted values when their context changes.
  for (const data of Object.values(waveDraft)) {
    for (const [kind, source] of Object.entries(data.autoCalibration || {})) {
      if (source.context !== context) {
        if (data[kind] === source.value) data[kind] = "";
        delete data.autoCalibration[kind];
      }
    }
  }
  for (const wave of getSelectedWavelengths()) {
    const data = ensureWave(wave);
    const matches = matchingCalibrations(records, workNo, inputDate, cableType, wave, editingRecordId);
    for (const kind of ["startCalibration", "endCalibration"]) {
      const match = matches[kind];
      if (String(data[kind] ?? "").trim() === "" && match) {
        data[kind] = match.value;
        data.autoCalibration ||= {};
        data.autoCalibration[kind] = { context, value: match.value, section: match.record.sectionName || "区間名なし" };
      }
      const source = data.autoCalibration?.[kind];
      if (source) notices.push(wave + "nm " + (kind === "startCalibration" ? "始点" : "終点") + "：" + source.value + " dB（" + source.section + "）");
    }
  }
  const notice = $("calibrationAutoNotice");
  notice.textContent = notices.length
    ? "工事番号 K-" + workNo + "・入力日 " + inputDate + " の履歴から引用：" + notices.join("、")
    : "同じ工事番号・入力日・ケーブル種類・波長の履歴から、空欄の校正値を引用します。入力済みの値は保持します。";
  notice.classList.remove("hidden");
}

function refreshCalibrationFromHistory() {
  if (isRestoringDraft || isHardClearingInputs) return;
  collectWaveInputs();
  applyMatchingCalibration();
  renderWaveConfigs(false);
  renderMeasurementInputs();
  renderLiveSummary();
  saveDraftSoon();
}

function historyClipboardText(record) {
  return JSON.stringify({ format: "fiber-loss-smgi-history", version: 1, record }, null, 2);
}

function validateHistoryClipboard(text) {
  if (text.length > 2000000) throw new Error("貼り付けデータが大きすぎます。");
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("「履歴をコピー」でコピーした内容を貼り付けてください。"); }
  const r = payload?.record;
  if (payload?.format !== "fiber-loss-smgi-history" || payload.version !== 1 || !r ||
      !/^\d{5}$/.test(r.workNo) || !["SM", "GI"].includes(r.cableType) ||
      !Array.isArray(r.wavelengths) || !r.wavelengths.length || r.wavelengths.length > 2 ||
      new Set(r.wavelengths.map(String)).size !== r.wavelengths.length ||
      !r.wavelengths.every(w => (r.cableType === "SM" ? [1310,1550] : [850,1300]).includes(Number(w))) ||
      !Number.isFinite(Number(r.lengthM)) || Number(r.lengthM) <= 0 ||
      !recordInputDate(r)) throw new Error("対応する測定履歴データではありません。");
  for (const key of ["spliceCount", "connectorCount"]) {
    if (!Number.isInteger(r[key]) || r[key] < 0) throw new Error("接続数が不正です。");
  }
  for (const key of ["workNo", "siteName", "sectionName", "startPanel", "endPanel", "memo"]) {
    if (r[key] != null && typeof r[key] !== "string") throw new Error("基本情報の形式が不正です。");
  }
  for (const wave of r.wavelengths) {
    const data = r.measurements?.[wave];
    if (!data) throw new Error("波長別の測定データがありません。");
    for (const side of ["start", "end"]) {
      const count = data[side + "CoreCount"];
      const rows = data[side + "Values"];
      if (!Number.isInteger(count) || count < 1 || count > 288 || !Array.isArray(rows) || rows.length > 288 ||
          rows.some(row => !row || typeof row !== "object" ||
            (row.value != null && row.value !== "" && !Number.isFinite(Number(row.value))) ||
            (row.lineNo != null && typeof row.lineNo !== "string") ||
            (row.memo != null && typeof row.memo !== "string"))) throw new Error("芯線・測定値の形式が不正です。");
      const cal = data[side + "Calibration"];
      if (cal != null && cal !== "" && !Number.isFinite(Number(cal))) throw new Error("校正値の形式が不正です。");
    }
  }
  // Recalculate derived results; clipboard results are never trusted.
  return calculateSmgi({ ...r, lengthKm: Number(r.lengthM) / 1000 });
}

async function copyHistory(record) {
  document.querySelector(".history-transfer").open = true;
  const area = $("historyClipboard");
  area.value = historyClipboardText(record);
  try {
    await navigator.clipboard.writeText(area.value);
    $("historyTransferStatus").textContent = "履歴をコピーしました。別の測定データの貼り付け欄で使用できます。";
  } catch {
    area.focus();
    area.select();
    $("historyTransferStatus").textContent = "下の欄を選択しました。コピー操作（Ctrl+C／長押し）でコピーしてください。";
  }
}

function useHistoryAsNew(record) {
  if (hasAnyWorkingInput() && !confirm("現在の入力を退避して、この履歴を新規測定として読み込みますか？")) return;
  if (!saveDraftNow() || !saveBackupSnapshot("before-history-copy", { force: true })) return;
  loadRecordIntoForm(structuredCloneSafe(record));
  $("calibrationAutoNotice").textContent = "履歴を新規測定として複製しました。工事番号・入力日・盤名・測定値を確認して保存してください。元の履歴は残ります。";
  $("calibrationAutoNotice").classList.remove("hidden");
}

function pasteHistory() {
  try {
    const record = validateHistoryClipboard($("historyClipboard").value);
    useHistoryAsNew(record);
  } catch (error) {
    $("historyTransferStatus").textContent = error.message;
  }
}
