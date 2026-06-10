const STORAGE_KEY = "fiberLossSmgiWaveCalTrialRecordsV1";
const DRAFT_KEY = "fiberLossSmgiWaveCalTrialDraftV1";

const smgiMaster = {
  SM: {
    name: "SM",
    wavelengths: {
      1310: { cableLoss: 0.50, spliceLoss: 0.15, connectorLoss: 0.35 },
      1550: { cableLoss: 0.30, spliceLoss: 0.15, connectorLoss: 0.35 }
    }
  },
  GI: {
    name: "GI",
    wavelengths: {
      850: { cableLoss: 3.00, spliceLoss: 0.15, connectorLoss: 0.35 },
      1300: { cableLoss: 1.00, spliceLoss: 0.15, connectorLoss: 0.35 }
    }
  }
};

let latestCalculation = null;
let editingRecordId = null;
let waveDraft = {};
let isRestoringDraft = false;
let suppressDraftSave = false;

const $ = (id) => document.getElementById(id);

const previewLabels = {
  workNo: "工事番号",
  siteName: "現場名",
  sectionName: "区間名",
  startPanel: "始端盤名",
  endPanel: "遠端盤名",
  startLm: "始端レングスマーク",
  endLm: "遠端レングスマーク",
  cableType: "ケーブル種類",
  wavelength: "波長",
  spliceCount: "融着点数",
  connectorCount: "コネクタ数",
  memo: "区間メモ"
};

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initEvents();
  updateWavelengthOptions();
  renderWaveConfigs(true);
  renderMeasurements(true);
  renderHistory();
  $("masterPreview").textContent = JSON.stringify(smgiMaster, null, 2);
  setupInputPreviewForAllFields();
  if ($("inputPreview")) document.body.appendChild($("inputPreview"));
  bindViewportPreviewReposition();
  restoreDraftIfNeeded();
  registerServiceWorker();
});

function initNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchScreen(btn.dataset.screen));
  });
}

function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.screen === screenId));
  $(screenId).classList.add("active");
  if (screenId === "historyScreen") renderHistory();
}

function initEvents() {
  ["startPanel", "endPanel"].forEach((id) => {
    $(id).addEventListener("input", () => {
      updateAutoSectionName();
      saveDraftSoon();
    });
  });

  $("workNo").addEventListener("input", () => {
    $("workNo").value = $("workNo").value.replace(/\D/g, "").slice(0, 5);
    saveDraftSoon();
    updatePreviewForActiveElement();
  });

  $("sectionName").addEventListener("input", () => {
    $("sectionName").dataset.manual = "true";
    saveDraftSoon();
  });

  $("cableType").addEventListener("change", () => {
    collectWaveInputs();
    updateWavelengthOptions();
    clearCalculationOnly();
    renderWaveConfigs(true);
    renderMeasurements(true);
    saveDraftSoon();
  });

  $("wavelength").addEventListener("change", () => {
    collectWaveInputs();
    clearCalculationOnly();
    renderWaveConfigs(true);
    renderMeasurements(true);
    saveDraftSoon();
  });

  ["startLm", "endLm", "spliceCount", "connectorCount", "siteName", "memo"].forEach((id) => {
    $(id).addEventListener("input", () => {
      if (["startLm", "endLm", "spliceCount", "connectorCount"].includes(id)) {
        clearCalculationOnly({ rerenderMeasurementInputs: true });
      }
      saveDraftSoon();
    });
  });

  $("calculateBtn").addEventListener("click", handleCalculate);
  $("saveBtn").addEventListener("click", handleSave);
  $("cancelEditBtn").addEventListener("click", cancelEditMode);
  $("exportCsvBtn").addEventListener("click", exportAllCsv);
  $("clearAllBtn").addEventListener("click", clearAllRecords);
  $("downloadJsonBtn").addEventListener("click", downloadJsonBackup);
  $("importJsonBtn").addEventListener("click", () => $("importJsonFile").click());
  $("importJsonFile").addEventListener("change", importJsonBackup);
  $("closeReportBtn")?.addEventListener("click", closeReportModal);
  $("printReportBtn")?.addEventListener("click", () => window.print());

  $("calcForm").addEventListener("reset", () => {
    setTimeout(() => {
      localStorage.removeItem(DRAFT_KEY);
      resetStateAfterFormReset();
    }, 0);
  });
}

function updateAutoSectionName() {
  if ($("sectionName").dataset.manual === "true") return;
  const start = $("startPanel").value.trim();
  const end = $("endPanel").value.trim();
  $("sectionName").value = start && end ? `${start} ～ ${end}` : "";
}

function getAvailableWavelengths(type = $("cableType").value) {
  return type === "SM" ? [1310, 1550] : [850, 1300];
}

function updateWavelengthOptions() {
  const type = $("cableType").value;
  const select = $("wavelength");
  const current = select.value;
  const waves = getAvailableWavelengths(type);
  select.innerHTML = `
    <option value="${waves[0]}">${waves[0]}nm</option>
    <option value="${waves[1]}">${waves[1]}nm</option>
    <option value="both">${waves[0]}nm / ${waves[1]}nm 両方</option>
  `;
  select.value = [String(waves[0]), String(waves[1]), "both"].includes(current) ? current : "both";
}

function getSelectedWavelengths() {
  const value = $("wavelength").value;
  if (value !== "both") return [Number(value)];
  return getAvailableWavelengths();
}

function ensureWave(wave) {
  const key = String(wave);
  if (!waveDraft[key]) {
    waveDraft[key] = {
      startCalibration: "",
      endCalibration: "",
      startCoreCount: 4,
      endCoreCount: 4,
      startFirstLineNo: "1",
      endFirstLineNo: "1",
      startValues: [],
      endValues: []
    };
  }
  return waveDraft[key];
}

function collectWaveInputs() {
  if (isRestoringDraft) return;

  document.querySelectorAll("[data-wave-config]").forEach((section) => {
    const wave = section.dataset.waveConfig;
    const d = ensureWave(wave);
    d.startCalibration = $(`startCalibration_${wave}`)?.value ?? d.startCalibration ?? "";
    d.endCalibration = $(`endCalibration_${wave}`)?.value ?? d.endCalibration ?? "";
    d.startCoreCount = getIntegerFromInput(`startCoreCount_${wave}`, d.startCoreCount || 4);
    d.endCoreCount = getIntegerFromInput(`endCoreCount_${wave}`, d.endCoreCount || 4);
    d.startFirstLineNo = $(`startFirstLineNo_${wave}`)?.value || d.startFirstLineNo || "1";
    d.endFirstLineNo = $(`endFirstLineNo_${wave}`)?.value || d.endFirstLineNo || "1";
  });

  document.querySelectorAll(".measure-input").forEach((input) => {
    const wave = input.dataset.wave;
    const side = input.dataset.side;
    const index = Number(input.dataset.index);
    const d = ensureWave(wave);
    const listName = side === "start" ? "startValues" : "endValues";
    if (!d[listName][index]) d[listName][index] = {};
    d[listName][index].value = input.value;
    d[listName][index].lineNo = input.dataset.lineNo || d[listName][index].lineNo || "";
  });

  document.querySelectorAll(".line-memo-input").forEach((input) => {
    const wave = input.dataset.wave;
    const side = input.dataset.side;
    const index = Number(input.dataset.index);
    const d = ensureWave(wave);
    const listName = side === "start" ? "startValues" : "endValues";
    if (!d[listName][index]) d[listName][index] = {};
    d[listName][index].memo = input.value;
    d[listName][index].lineNo = input.dataset.lineNo || d[listName][index].lineNo || "";
  });
}

function getIntegerFromInput(id, fallback) {
  const el = $(id);
  if (!el) return fallback;
  const v = Math.floor(Number(el.value));
  if (!Number.isFinite(v) || v < 1) return fallback;
  return Math.min(288, v);
}

function renderWaveConfigs(keepValues) {
  if (keepValues && !isRestoringDraft) collectWaveInputs();

  const waves = getSelectedWavelengths();
  $("wavelengthConfigList").innerHTML = waves.map((wave) => {
    const d = ensureWave(wave);
    return `
      <section class="wave-config-card" data-wave-config="${wave}">
        <div class="wave-title">
          <strong>${wave}nm 設定</strong>
          <span class="hint">${wave}nm用の校正値・芯線数・開始線番</span>
        </div>

        <div class="config-subtitle">校正値（記録用のみ）</div>
        <div class="grid two">
          <label>
            ${wave}nm 始点校正値 dB
            <input id="startCalibration_${wave}" class="wave-config-input calibration-input" data-wave="${wave}" data-kind="startCalibration" type="number" inputmode="decimal" step="0.01" value="${escapeHtml(d.startCalibration ?? "")}" placeholder="例：0.00">
          </label>
          <label>
            ${wave}nm 終点校正値 dB
            <input id="endCalibration_${wave}" class="wave-config-input calibration-input" data-wave="${wave}" data-kind="endCalibration" type="number" inputmode="decimal" step="0.01" value="${escapeHtml(d.endCalibration ?? "")}" placeholder="例：0.00">
          </label>
        </div>

        <div class="config-subtitle">芯線数・線番</div>
        <div class="grid two">
          <label>
            ${wave}nm 芯線数 始端
            <input id="startCoreCount_${wave}" class="wave-config-input" data-wave="${wave}" data-kind="startCoreCount" type="number" inputmode="numeric" min="1" max="288" step="1" value="${escapeHtml(String(d.startCoreCount ?? 4))}">
          </label>
          <label>
            ${wave}nm 芯線数 遠端
            <input id="endCoreCount_${wave}" class="wave-config-input" data-wave="${wave}" data-kind="endCoreCount" type="number" inputmode="numeric" min="1" max="288" step="1" value="${escapeHtml(String(d.endCoreCount ?? 4))}">
          </label>
        </div>
        <div class="grid two">
          <label>
            ${wave}nm 始端側開始線番
            <input id="startFirstLineNo_${wave}" class="wave-config-input" data-wave="${wave}" data-kind="startFirstLineNo" type="text" value="${escapeHtml(d.startFirstLineNo ?? "1")}">
          </label>
          <label>
            ${wave}nm 遠端側開始線番
            <input id="endFirstLineNo_${wave}" class="wave-config-input" data-wave="${wave}" data-kind="endFirstLineNo" type="text" value="${escapeHtml(d.endFirstLineNo ?? "1")}">
          </label>
        </div>
      </section>
    `;
  }).join("");

  document.querySelectorAll(".wave-config-input").forEach((input) => {
    input.addEventListener("focus", () => showPreviewForElement(input));
    input.addEventListener("input", () => {
      collectWaveInputs();
      if (input.dataset.kind?.includes("CoreCount") || input.dataset.kind?.includes("FirstLineNo")) {
        clearCalculationOnly();
        renderMeasurements(true);
      } else {
        renderLiveSummary();
      }
      saveDraftSoon();
      updatePreviewForActiveElement();
    });
    input.addEventListener("blur", () => {
      if (input.classList.contains("calibration-input")) formatCalibrationInput(input);
      collectWaveInputs();
      renderLiveSummary();
      saveDraftSoon();
    });
  });

  setupInputPreviewForAllFields();
}

function renderMeasurements(keepValues) {
  if (keepValues && !isRestoringDraft) collectWaveInputs();

  renderMeasurementInputs();
  renderLiveSummary();
}

function renderMeasurementInputs() {
  const target = $("measureInputArea");
  if (!target) return;

  const waves = latestCalculation?.wavelengths || getSelectedWavelengths();

  target.innerHTML = `
    <div class="input-block">
      ${waves.map((wave) => renderWaveMeasureInput(wave)).join("")}
    </div>
  `;

  target.querySelectorAll(".measure-input").forEach((input) => {
    input.addEventListener("focus", () => showPreviewForElement(input));
    input.addEventListener("input", () => {
      collectWaveInputs();
      updateJudgements();
      renderLiveSummary();
      saveDraftSoon();
      updatePreviewForActiveElement();
    });
    input.addEventListener("blur", () => {
      formatMeasuredInput(input);
      collectWaveInputs();
      updateJudgements();
      renderLiveSummary();
      saveDraftSoon();
    });
  });

  target.querySelectorAll(".line-memo-input").forEach((input) => {
    input.addEventListener("focus", () => showPreviewForElement(input));
    input.addEventListener("input", () => {
      collectWaveInputs();
      renderLiveSummary();
      saveDraftSoon();
      updatePreviewForActiveElement();
    });
  });

  setupInputPreviewForAllFields();
  updateJudgements();
}

function renderWaveMeasureInput(wave) {
  const d = ensureWave(wave);
  const standard = latestCalculation?.results?.[wave]?.displayStandardValue || "";
  return `
    <section class="wave-measure-card" data-wave-measure="${wave}">
      <div class="wave-title">
        <strong>${wave}nm 測定値入力</strong>
        <span class="hint">規格値：${standard ? standard + " dB" : "未計算"} / 始端 ${d.startCoreCount}芯 / 遠端 ${d.endCoreCount}芯</span>
      </div>
      ${renderSideInput(wave, "start", "始端側 → 遠端側", d.startCoreCount, d.startFirstLineNo, d.startCalibration, d.startValues)}
      ${renderSideInput(wave, "end", "遠端側 → 始端側", d.endCoreCount, d.endFirstLineNo, d.endCalibration, d.endValues)}
    </section>
  `;
}

function renderSideInput(wave, side, title, count, firstLineNo, calibration, values) {
  const calibrationLabel = side === "start" ? "始点校正値" : "終点校正値";
  const rows = [];
  for (let i = 0; i < Number(count || 0); i++) {
    const row = values?.[i] || {};
    const lineNo = row.lineNo || incrementLineLabel(firstLineNo || "1", i);
    rows.push(`
      <div class="list-row">
        <div class="line-no">${escapeHtml(lineNo)}</div>
        <div>
          <input class="measure-input" data-wave="${wave}" data-side="${side}" data-index="${i}" data-line-no="${escapeHtml(lineNo)}" type="number" inputmode="decimal" step="0.01" min="0" value="${escapeHtml(row.value ?? "")}" placeholder="測定値 dB">
        </div>
        <div><span class="badge pending" data-result="${wave}-${side}-${i}">未判定</span></div>
        <div class="memo-cell">
          <input class="line-memo-input" data-wave="${wave}" data-side="${side}" data-index="${i}" data-line-no="${escapeHtml(lineNo)}" type="text" value="${escapeHtml(row.memo ?? "")}" placeholder="メモ">
        </div>
      </div>
    `);
  }

  return `
    <section class="side-list">
      <div class="side-list-head">
        <span>${escapeHtml(title)}</span>
        <span>${calibrationLabel}：${formatCalibrationDisplay(calibration)} dB</span>
      </div>
      ${rows.join("")}
    </section>
  `;
}

function renderLiveSummary() {
  const target = $("liveSummaryList");
  if (!target) return;

  if (!isRestoringDraft) collectWaveInputs();
  const waves = latestCalculation?.wavelengths || getSelectedWavelengths();

  target.innerHTML = waves.map((wave) => renderWaveLiveSummary(wave)).join("");
}

function renderWaveLiveSummary(wave) {
  const d = ensureWave(wave);
  const standard = latestCalculation?.results?.[wave]?.displayStandardValue || "";
  return `
    <section class="wave-measure-card">
      <div class="wave-title">
        <strong>${wave}nm 入力結果一覧</strong>
        <span class="hint">規格値：${standard ? standard + " dB" : "未計算"}</span>
      </div>
      ${renderSideSummary(wave, "start", "始端側 → 遠端側", d.startCoreCount, d.startFirstLineNo, d.startCalibration, d.startValues)}
      ${renderSideSummary(wave, "end", "遠端側 → 始端側", d.endCoreCount, d.endFirstLineNo, d.endCalibration, d.endValues)}
    </section>
  `;
}

function renderSideSummary(wave, side, title, count, firstLineNo, calibration, values) {
  const calibrationLabel = side === "start" ? "始点校正値" : "終点校正値";
  const standard = latestCalculation?.results?.[wave]?.standardValue;
  const standardDisplay = latestCalculation?.results?.[wave]?.displayStandardValue || "";
  const rows = [];

  for (let i = 0; i < Number(count || 0); i++) {
    const row = values?.[i] || {};
    const lineNo = row.lineNo || incrementLineLabel(firstLineNo || "1", i);
    const result = getResultForValue(row.value, standard);
    rows.push(`
      <div class="list-row">
        <div class="line-no">${escapeHtml(lineNo)}</div>
        <div>${formatMeasuredValue(row.value)} dB</div>
        <div class="standard-cell">${standardDisplay ? standardDisplay + " dB" : ""}</div>
        <div><span class="badge ${resultClass(result)}">${escapeHtml(result)}</span></div>
        <div class="cal-cell">${calibrationLabel}：${formatCalibrationDisplay(calibration)} dB</div>
        <div class="memo-cell">${escapeHtml(row.memo || "")}</div>
      </div>
    `);
  }

  return `
    <section class="side-list summary-list">
      <div class="side-list-head">
        <span>${escapeHtml(title)}</span>
        <span>${calibrationLabel}：${formatCalibrationDisplay(calibration)} dB</span>
      </div>
      ${rows.join("") || '<div class="list-row">未入力</div>'}
    </section>
  `;
}

function handleCalculate() {
  try {
    collectWaveInputs();
    formatAllCalibrationInputs();
    latestCalculation = calculateSmgi(getBaseInput());
    renderMeasurements(true);
    renderCalculation(latestCalculation);
    updateJudgements();
    renderLiveSummary();
    saveDraftSoon();
  } catch (error) {
    latestCalculation = null;
    renderError(error.message);
  }
}

function getBaseInput() {
  const workNo = validateWorkNo();
  const startLm = getNumber("startLm", "始端レングスマーク");
  const endLm = getNumber("endLm", "遠端レングスマーク");
  const lengthM = Math.abs(endLm - startLm);
  if (lengthM <= 0) throw new Error("始端と遠端のレングスマークに差がありません。");

  return {
    workNo,
    workNoDisplay: formatWorkNo(workNo),
    siteName: $("siteName").value.trim(),
    sectionName: $("sectionName").value.trim(),
    startPanel: $("startPanel").value.trim(),
    endPanel: $("endPanel").value.trim(),
    startLm,
    endLm,
    lengthM,
    lengthKm: lengthM / 1000,
    cableType: $("cableType").value,
    wavelengths: getSelectedWavelengths(),
    spliceCount: Math.floor(getNumber("spliceCount", "融着点数", 0)),
    connectorCount: Math.floor(getNumber("connectorCount", "コネクタ数", 0)),
    memo: $("memo").value.trim(),
    waveSettings: getWaveSettings()
  };
}

function getWaveSettings() {
  collectWaveInputs();
  const settings = {};
  getSelectedWavelengths().forEach((wave) => {
    const d = ensureWave(wave);
    settings[String(wave)] = {
      startCalibration: toNullableNumber(d.startCalibration),
      endCalibration: toNullableNumber(d.endCalibration),
      startCoreCount: Number(d.startCoreCount || 0),
      endCoreCount: Number(d.endCoreCount || 0),
      startFirstLineNo: d.startFirstLineNo || "1",
      endFirstLineNo: d.endFirstLineNo || "1"
    };
  });
  return settings;
}

function calculateSmgi(input) {
  const results = {};
  input.wavelengths.forEach((wave) => {
    const master = smgiMaster[input.cableType].wavelengths[wave];
    const cableLossValue = input.lengthKm * master.cableLoss;
    const spliceLossValue = input.spliceCount * master.spliceLoss;
    const connectorLossValue = input.connectorCount * master.connectorLoss;
    const rawStandardValue = cableLossValue + spliceLossValue + connectorLossValue;
    const standardValue = truncateNumber(rawStandardValue, 2);
    results[String(wave)] = {
      wavelength: wave,
      cableLoss: master.cableLoss,
      spliceLoss: master.spliceLoss,
      connectorLoss: master.connectorLoss,
      cableLossValue,
      spliceLossValue,
      connectorLossValue,
      rawStandardValue,
      standardValue,
      displayStandardValue: formatFixedTruncated(standardValue, 2)
    };
  });
  return { ...input, results };
}

function renderCalculation(calc) {
  $("errorBox").classList.add("hidden");
  $("errorBox").textContent = "";
  $("resultCard").classList.remove("hidden");

  $("resultSummary").innerHTML = `
    <div class="result-main">
      ${calc.wavelengths.map((wave) => `
        <div class="result-box">
          <div class="result-label">${escapeHtml(calc.cableType)} ${wave}nm 規格値</div>
          <div class="result-value">${escapeHtml(calc.results[String(wave)].displayStandardValue)} dB</div>
        </div>
      `).join("")}
    </div>
  `;

  const rows = [
    ["工事番号", calc.workNoDisplay],
    ["ケーブル長", `${formatNumber(calc.lengthM, 3)} m / ${formatNumber(calc.lengthKm, 6)} km`],
    ["ケーブル種類", calc.cableType],
    ["波長", calc.wavelengths.map((w) => `${w}nm`).join(" / ")],
    ["融着点数", `${calc.spliceCount}点`],
    ["コネクタ数", `${calc.connectorCount}個`],
    ["計算式", "ケーブル長(km)×ケーブル損失 + 融着点数×0.15 + コネクタ数×0.35"],
    ["小数処理", "規格値・測定値・校正値は小数第3位以下を切り捨て、小数第2位表示"]
  ];

  calc.wavelengths.forEach((wave) => {
    const r = calc.results[String(wave)];
    const s = calc.waveSettings[String(wave)];
    rows.push([`${wave}nm 校正値`, `始点 ${formatCalibrationDisplay(s.startCalibration)} dB / 終点 ${formatCalibrationDisplay(s.endCalibration)} dB（記録用のみ）`]);
    rows.push([`${wave}nm 芯線数`, `始端 ${s.startCoreCount}芯 / 遠端 ${s.endCoreCount}芯`]);
    rows.push([`${wave}nm 内訳`, `ケーブル ${formatNumber(r.cableLossValue, 6)} + 融着 ${formatNumber(r.spliceLossValue, 6)} + コネクタ ${formatNumber(r.connectorLossValue, 6)} = ${r.displayStandardValue} dB`]);
  });

  $("detailBreakdown").innerHTML = rows.map(([label, value]) => `
    <div class="breakdown-row">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(String(value))}</span>
    </div>
  `).join("");
}

function renderError(message) {
  $("errorBox").classList.remove("hidden");
  $("errorBox").textContent = message;
  $("resultCard").classList.add("hidden");
}

function clearCalculationOnly(options = {}) {
  latestCalculation = null;
  $("resultCard").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("errorBox").textContent = "";

  if (options.rerenderMeasurementInputs) {
    renderMeasurementInputs();
  } else {
    document.querySelectorAll("[data-result]").forEach((badge) => {
      badge.className = "badge pending";
      badge.textContent = "未判定";
    });
    renderLiveSummary();
  }
}

function updateJudgements() {
  const scope = $("measureInputArea") || document;
  scope.querySelectorAll("[data-result]").forEach((badge) => {
    const [wave, side, index] = badge.dataset.result.split("-");
    const standard = latestCalculation?.results?.[wave]?.standardValue;
    const input = scope.querySelector(`.measure-input[data-wave="${wave}"][data-side="${side}"][data-index="${index}"]`);
    const result = getResultForValue(input?.value, standard);
    badge.className = `badge ${resultClass(result)}`;
    badge.textContent = result;
  });
}

function collectMeasuredData() {
  collectWaveInputs();
  const out = {};
  const waves = latestCalculation?.wavelengths || getSelectedWavelengths();

  waves.forEach((wave) => {
    const key = String(wave);
    const d = ensureWave(key);
    const standard = latestCalculation?.results?.[key]?.standardValue;

    out[key] = {
      startCalibration: toNullableNumber(d.startCalibration),
      endCalibration: toNullableNumber(d.endCalibration),
      startCoreCount: Number(d.startCoreCount || 0),
      endCoreCount: Number(d.endCoreCount || 0),
      startFirstLineNo: d.startFirstLineNo || "1",
      endFirstLineNo: d.endFirstLineNo || "1",
      startValues: normalizeSideValues(d.startValues, d.startCoreCount, d.startFirstLineNo, standard),
      endValues: normalizeSideValues(d.endValues, d.endCoreCount, d.endFirstLineNo, standard)
    };
  });

  return out;
}

function normalizeSideValues(values, count, firstLineNo, standard) {
  const rows = [];
  for (let i = 0; i < Number(count || 0); i++) {
    const row = values?.[i] || {};
    const value = toNullableNumber(row.value);
    rows.push({
      lineNo: row.lineNo || incrementLineLabel(firstLineNo || "1", i),
      value,
      result: getResultForValue(value, standard),
      memo: row.memo || ""
    });
  }
  return rows;
}

function handleSave() {
  if (!latestCalculation) {
    alert("先に規格値を計算してください。");
    return;
  }

  document.querySelectorAll(".measure-input").forEach(formatMeasuredInput);
  formatAllCalibrationInputs();
  collectWaveInputs();

  try {
    latestCalculation = calculateSmgi(getBaseInput());
  } catch (error) {
    alert(error.message);
    return;
  }

  const records = loadRecords();
  const now = new Date();
  const oldRecord = editingRecordId ? records.find((record) => record.id === editingRecordId) : null;

  const record = {
    id: oldRecord?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    savedAt: oldRecord?.savedAt || now.toISOString(),
    updatedAt: editingRecordId ? now.toISOString() : "",
    ...latestCalculation,
    measurements: collectMeasuredData()
  };

  if (editingRecordId) {
    const index = records.findIndex((item) => item.id === editingRecordId);
    if (index >= 0) records[index] = record;
    else records.unshift(record);
    saveRecords(records);
    cancelEditMode(false);
    localStorage.removeItem(DRAFT_KEY);
    renderHistory();
    alert("履歴を更新しました。");
    return;
  }

  records.unshift(record);
  saveRecords(records);
  localStorage.removeItem(DRAFT_KEY);
  renderHistory();
  alert("履歴に保存しました。");
}

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function renderHistory() {
  const records = loadRecords();
  const list = $("historyList");

  if (records.length === 0) {
    list.innerHTML = `<p class="hint">履歴はまだありません。</p>`;
    return;
  }

  const groups = new Map();
  records.forEach((record) => {
    const key = record.workNoDisplay || formatWorkNo(record.workNo) || "工事番号未設定";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  list.innerHTML = "";
  groups.forEach((items, groupName) => {
    const group = document.createElement("section");
    group.className = "history-group";
    group.innerHTML = `<div class="history-group-title">工事番号：${escapeHtml(groupName)}（${items.length}件）</div>`;
    items.forEach((record) => {
      const counts = countRecordJudgements(record);
      const item = document.createElement("article");
      item.className = "history-item";
      item.innerHTML = `
        <div class="history-title">${escapeHtml(record.sectionName || "区間名なし")}</div>
        <div class="history-meta">
          ${formatDateTime(record.savedAt)} / ${escapeHtml(record.cableType)} ${record.wavelengths.map((w) => `${w}nm`).join(" / ")} /
          規格値 ${record.wavelengths.map((w) => `${w}nm:${record.results[String(w)].displayStandardValue}dB`).join("、")} /
          OK ${counts.OK} / NG ${counts.NG} / 未判定 ${counts.pending}
        </div>
        <div class="history-detail">${renderRecordDetail(record)}</div>
      `;
      item.querySelector(".show-report-btn").addEventListener("click", () => showRecordReport(record.id));
      item.querySelector(".export-record-csv-btn").addEventListener("click", () => exportRecordCsv(record.id));
      item.querySelector(".edit-record-btn").addEventListener("click", () => startEditRecord(record.id));
      item.querySelector(".delete-record-btn").addEventListener("click", () => deleteRecord(record.id));
      group.appendChild(item);
    });
    list.appendChild(group);
  });
}

function countRecordJudgements(record) {
  const counts = { OK: 0, NG: 0, pending: 0 };
  Object.values(record.measurements || {}).forEach((waveData) => {
    [...(waveData.startValues || []), ...(waveData.endValues || [])].forEach((row) => {
      if (row.result === "OK") counts.OK++;
      else if (row.result === "NG") counts.NG++;
      else counts.pending++;
    });
  });
  return counts;
}

function renderRecordDetail(record) {
  return `
    <div class="detail-grid">
      <div><strong>工事番号</strong><span>${escapeHtml(record.workNoDisplay || formatWorkNo(record.workNo) || "")}</span></div>
      <div><strong>現場名</strong><span>${escapeHtml(record.siteName || "")}</span></div>
      <div><strong>始端盤名</strong><span>${escapeHtml(record.startPanel || "")}</span></div>
      <div><strong>遠端盤名</strong><span>${escapeHtml(record.endPanel || "")}</span></div>
      <div><strong>ケーブル長</strong><span>${formatNumber(record.lengthM, 3)}m / ${formatNumber(record.lengthKm, 6)}km</span></div>
      <div><strong>融着 / コネクタ</strong><span>${record.spliceCount}点 / ${record.connectorCount}個</span></div>
    </div>
    ${record.wavelengths.map((wave) => renderSavedWave(record, String(wave))).join("")}
    <div class="actions">
      <button type="button" class="secondary show-report-btn">控え表示</button>
      <button type="button" class="secondary export-record-csv-btn">この履歴をCSV出力</button>
      <button type="button" class="primary edit-record-btn">この履歴を編集</button>
      <button type="button" class="danger delete-record-btn">この履歴を削除</button>
    </div>
  `;
}

function renderSavedWave(record, wave) {
  const data = record.measurements?.[wave] || {};
  const standardDisplay = record.results?.[wave]?.displayStandardValue || "";

  return `
    <section class="wave-measure-card">
      <div class="wave-title">
        <strong>${wave}nm</strong>
        <span class="hint">規格値：${standardDisplay} dB</span>
      </div>
      ${renderSavedSide("始端側 → 遠端側", "始点校正値", data.startCalibration, standardDisplay, data.startValues || [])}
      ${renderSavedSide("遠端側 → 始端側", "終点校正値", data.endCalibration, standardDisplay, data.endValues || [])}
    </section>
  `;
}

function renderSavedSide(title, calLabel, calValue, standardDisplay, rows) {
  return `
    <section class="side-list summary-list">
      <div class="side-list-head">
        <span>${escapeHtml(title)}</span>
        <span>${escapeHtml(calLabel)}：${formatCalibrationDisplay(calValue)} dB</span>
      </div>
      ${(rows || []).map((row) => `
        <div class="list-row">
          <div class="line-no">${escapeHtml(row.lineNo || "")}</div>
          <div>${formatMeasuredValue(row.value)} dB</div>
          <div class="standard-cell">${standardDisplay ? standardDisplay + " dB" : ""}</div>
          <div><span class="badge ${resultClass(row.result)}">${escapeHtml(row.result || "未判定")}</span></div>
          <div class="cal-cell">${escapeHtml(calLabel)}：${formatCalibrationDisplay(calValue)} dB</div>
          <div class="memo-cell">${escapeHtml(row.memo || "")}</div>
        </div>
      `).join("") || '<div class="list-row">未入力</div>'}
    </section>
  `;
}

function startEditRecord(id) {
  const record = loadRecords().find((item) => item.id === id);
  if (!record) return;

  editingRecordId = id;
  suppressDraftSave = true;
  isRestoringDraft = true;

  $("workNo").value = record.workNo || "";
  $("siteName").value = record.siteName || "";
  $("sectionName").value = record.sectionName || "";
  $("sectionName").dataset.manual = "true";
  $("startPanel").value = record.startPanel || "";
  $("endPanel").value = record.endPanel || "";
  $("startLm").value = record.startLm ?? "";
  $("endLm").value = record.endLm ?? "";
  $("cableType").value = record.cableType || "SM";
  updateWavelengthOptions();
  $("wavelength").value = record.wavelengths?.length > 1 ? "both" : String(record.wavelengths?.[0] || $("wavelength").value);
  $("spliceCount").value = record.spliceCount ?? 2;
  $("connectorCount").value = record.connectorCount ?? 2;
  $("memo").value = record.memo || "";

  waveDraft = normalizeRecordToWaveDraft(record);
  latestCalculation = record;

  renderWaveConfigs(false);
  renderMeasurementInputs();

  isRestoringDraft = false;

  renderCalculation(latestCalculation);
  updateJudgements();
  renderLiveSummary();

  $("saveBtn").textContent = "履歴を更新";
  $("cancelEditBtn").classList.remove("hidden");
  switchScreen("calcScreen");

  suppressDraftSave = false;
}

function normalizeRecordToWaveDraft(record) {
  const out = {};
  const waves = (record.wavelengths || []).map(String);

  waves.forEach((wave) => {
    const data = record.measurements?.[wave] || {};
    const settings = record.waveSettings?.[wave] || {};

    const startCoreCount = Number(data.startCoreCount ?? settings.startCoreCount ?? 4);
    const endCoreCount = Number(data.endCoreCount ?? settings.endCoreCount ?? 4);
    const startFirstLineNo = data.startFirstLineNo ?? settings.startFirstLineNo ?? "1";
    const endFirstLineNo = data.endFirstLineNo ?? settings.endFirstLineNo ?? "1";

    out[wave] = {
      startCalibration: formatCalibrationInputValue(data.startCalibration ?? settings.startCalibration),
      endCalibration: formatCalibrationInputValue(data.endCalibration ?? settings.endCalibration),
      startCoreCount,
      endCoreCount,
      startFirstLineNo,
      endFirstLineNo,
      startValues: normalizeRecordSideValues(data.startValues || [], startCoreCount, startFirstLineNo),
      endValues: normalizeRecordSideValues(data.endValues || [], endCoreCount, endFirstLineNo)
    };
  });

  return out;
}

function normalizeRecordSideValues(values, count, firstLineNo) {
  const rows = [];

  for (let i = 0; i < Number(count || 0); i++) {
    const row = values[i] || {};
    rows.push({
      lineNo: row.lineNo || incrementLineLabel(firstLineNo || "1", i),
      value: row.value === null || row.value === undefined ? "" : formatMeasuredValue(row.value),
      memo: row.memo || ""
    });
  }

  return rows;
}


function cancelEditMode(showMessage = true) {
  editingRecordId = null;
  $("saveBtn").textContent = "履歴に保存";
  $("cancelEditBtn").classList.add("hidden");
  if (showMessage) alert("編集をキャンセルしました。");
}

function deleteRecord(id) {
  if (!confirm("この履歴を削除しますか？")) return;
  saveRecords(loadRecords().filter((record) => record.id !== id));
  renderHistory();
}

function clearAllRecords() {
  if (!confirm("全履歴を削除しますか？この操作は戻せません。")) return;
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
}

function buildCsvRows(records) {
  const headers = [
    "保存日時","工事番号","現場名","区間名","始端盤名","遠端盤名","始端LM","遠端LM","ケーブル長m","ケーブル長km",
    "ケーブル種類","波長","融着点数","コネクタ数","規格値","測定方向","芯線数","線番","測定値","判定",
    "始点校正値","終点校正値","使用校正値種別","使用校正値","メモ","区間メモ"
  ];
  const rows = [headers];

  records.forEach((record) => {
    record.wavelengths.forEach((waveNum) => {
      const wave = String(waveNum);
      const data = record.measurements?.[wave] || {};
      const startCal = formatCalibrationDisplay(data.startCalibration);
      const endCal = formatCalibrationDisplay(data.endCalibration);

      [
        ["始端側→遠端側", data.startCoreCount, "始点校正値", data.startCalibration, data.startValues || []],
        ["遠端側→始端側", data.endCoreCount, "終点校正値", data.endCalibration, data.endValues || []]
      ].forEach(([sideLabel, coreCount, calLabel, calValue, list]) => {
        list.forEach((row) => {
          rows.push([
            formatDateTime(record.savedAt),
            record.workNoDisplay || formatWorkNo(record.workNo),
            record.siteName,
            record.sectionName,
            record.startPanel,
            record.endPanel,
            record.startLm,
            record.endLm,
            formatNumber(record.lengthM, 3),
            formatNumber(record.lengthKm, 6),
            record.cableType,
            `${wave}nm`,
            record.spliceCount,
            record.connectorCount,
            record.results?.[wave]?.displayStandardValue,
            sideLabel,
            coreCount,
            row.lineNo,
            formatMeasuredValue(row.value),
            row.result,
            startCal,
            endCal,
            calLabel,
            formatCalibrationDisplay(calValue),
            row.memo,
            record.memo
          ]);
        });
      });
    });
  });
  return rows;
}

function exportAllCsv() {
  const records = loadRecords();
  if (records.length === 0) {
    alert("出力する履歴がありません。");
    return;
  }
  downloadCsv(buildCsvRows(records), `fiber-loss-smgi-all-${dateStamp()}.csv`);
}

function exportRecordCsv(id) {
  const record = loadRecords().find((item) => item.id === id);
  if (!record) return;
  const name = `${record.workNoDisplay || formatWorkNo(record.workNo)}-${record.sectionName || record.cableType}`;
  downloadCsv(buildCsvRows([record]), `fiber-loss-smgi-${safeFileName(name)}-${dateStamp()}.csv`);
}

function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadJsonBackup() {
  const data = { app: "fiber-loss-smgi-wavecal-trial", exportedAt: new Date().toISOString(), records: loadRecords() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fiber-loss-smgi-backup-${dateStamp()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJsonBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const records = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(records)) throw new Error("履歴データがありません。");
      if (confirm("現在の履歴にJSONの履歴を追加しますか？")) {
        saveRecords([...records, ...loadRecords()]);
        renderHistory();
        alert("JSON履歴を読み込みました。");
      }
    } catch (error) {
      alert(`JSON読込に失敗しました：${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function showRecordReport(id) {
  const record = loadRecords().find((item) => item.id === id);
  if (!record) return;
  $("reportContent").innerHTML = renderReportSheet(record);
  $("reportModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeReportModal() {
  $("reportModal").classList.add("hidden");
  $("reportContent").innerHTML = "";
  document.body.style.overflow = "";
}

function renderReportSheet(record) {
  const workNo = record.workNoDisplay || formatWorkNo(record.workNo) || "";
  const standards = record.wavelengths.map((w) => `${w}nm:${record.results[String(w)].displayStandardValue}dB`).join(" / ");
  return `
    <article class="report-sheet">
      <div class="report-title">
        <div>
          <h2>SM/GI 光ケーブル測定控え</h2>
          <p class="hint">保存時点の入力結果・規格値・測定値・判定を表示しています。</p>
        </div>
        <div class="report-standard">
          <div>${escapeHtml(workNo)}</div>
          <div>規格値 ${escapeHtml(standards)}</div>
        </div>
      </div>

      <div class="report-info-grid">
        <div class="report-info-item"><strong>保存日時</strong><span>${escapeHtml(formatDateTime(record.savedAt))}</span></div>
        <div class="report-info-item"><strong>更新日時</strong><span>${escapeHtml(record.updatedAt ? formatDateTime(record.updatedAt) : "-")}</span></div>
        <div class="report-info-item"><strong>工事番号</strong><span>${escapeHtml(workNo)}</span></div>
        <div class="report-info-item"><strong>現場名</strong><span>${escapeHtml(record.siteName || "")}</span></div>
        <div class="report-info-item"><strong>区間名</strong><span>${escapeHtml(record.sectionName || "")}</span></div>
        <div class="report-info-item"><strong>始端盤名</strong><span>${escapeHtml(record.startPanel || "")}</span></div>
        <div class="report-info-item"><strong>遠端盤名</strong><span>${escapeHtml(record.endPanel || "")}</span></div>
        <div class="report-info-item"><strong>ケーブル長</strong><span>${formatNumber(record.lengthM, 3)} m / ${formatNumber(record.lengthKm, 6)} km</span></div>
        <div class="report-info-item"><strong>ケーブル種類</strong><span>${escapeHtml(record.cableType || "")}</span></div>
        <div class="report-info-item"><strong>波長</strong><span>${record.wavelengths.map((w) => `${w}nm`).join(" / ")}</span></div>
        <div class="report-info-item"><strong>融着 / コネクタ</strong><span>${record.spliceCount}点 / ${record.connectorCount}個</span></div>
        <div class="report-info-item"><strong>区間メモ</strong><span>${escapeHtml(record.memo || "")}</span></div>
      </div>

      <h3>測定結果</h3>
      ${record.wavelengths.map((wave) => renderSavedWave(record, String(wave))).join("")}
    </article>
  `;
}

function resetStateAfterFormReset() {
  latestCalculation = null;
  editingRecordId = null;
  waveDraft = {};
  $("resultCard").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("sectionName").dataset.manual = "false";
  $("saveBtn").textContent = "履歴に保存";
  $("cancelEditBtn").classList.add("hidden");
  $("spliceCount").value = 2;
  $("connectorCount").value = 2;
  updateWavelengthOptions();
  renderWaveConfigs(false);
  renderMeasurements(false);
}

function saveDraftSoon() {
  if (suppressDraftSave || isRestoringDraft) return;
  clearTimeout(saveDraftSoon.timer);
  saveDraftSoon.timer = setTimeout(saveDraft, 180);
}

function saveDraft() {
  if (suppressDraftSave || isRestoringDraft) return;
  collectWaveInputs();
  const data = {
    savedAt: new Date().toISOString(),
    form: {
      workNo: $("workNo").value,
      siteName: $("siteName").value,
      sectionName: $("sectionName").value,
      sectionManual: $("sectionName").dataset.manual || "false",
      startPanel: $("startPanel").value,
      endPanel: $("endPanel").value,
      startLm: $("startLm").value,
      endLm: $("endLm").value,
      cableType: $("cableType").value,
      wavelength: $("wavelength").value,
      spliceCount: $("spliceCount").value,
      connectorCount: $("connectorCount").value,
      memo: $("memo").value
    },
    waveDraft,
    latestCalculation
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
}

function restoreDraftIfNeeded() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;

  let draftData;
  try { draftData = JSON.parse(raw); }
  catch {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }

  const savedAt = draftData.savedAt ? formatDateTime(draftData.savedAt) : "";
  const firstMessage = savedAt
    ? `途中保存された入力があります。\n保存日時：${savedAt}\n\n測定値・波長別校正値も復元できます。\n復元しますか？`
    : "途中保存された入力があります。\n\n測定値・波長別校正値も復元できます。\n復元しますか？";

  if (confirm(firstMessage)) {
    restoreDraft(draftData);
    return;
  }

  const warningMessage =
    "警告：途中入力を破棄しようとしています。\n\n" +
    "復元しない場合、途中保存されている測定値・波長別校正値・工事番号・入力中の内容は削除されます。\n\n" +
    "本当に破棄しますか？";

  if (confirm(warningMessage)) {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }

  restoreDraft(draftData);
}

function restoreDraft(draftData) {
  isRestoringDraft = true;

  const form = draftData.form || {};

  $("workNo").value = form.workNo || "";
  $("siteName").value = form.siteName || "";
  $("sectionName").value = form.sectionName || "";
  $("sectionName").dataset.manual = form.sectionManual || "false";
  $("startPanel").value = form.startPanel || "";
  $("endPanel").value = form.endPanel || "";
  $("startLm").value = form.startLm || "";
  $("endLm").value = form.endLm || "";
  $("cableType").value = form.cableType || "SM";
  updateWavelengthOptions();
  $("wavelength").value = form.wavelength || "both";
  $("spliceCount").value = form.spliceCount || "2";
  $("connectorCount").value = form.connectorCount || "2";
  $("memo").value = form.memo || "";

  waveDraft = normalizeRestoredWaveDraft(draftData.waveDraft || {}, draftData.latestCalculation || null);
  latestCalculation = draftData.latestCalculation || null;

  renderWaveConfigs(false);
  renderMeasurementInputs();

  isRestoringDraft = false;

  if (latestCalculation?.results) {
    renderCalculation(latestCalculation);
  } else {
    $("resultCard").classList.add("hidden");
  }

  updateJudgements();
  renderLiveSummary();
  saveDraftSoon();
}

function normalizeRestoredWaveDraft(restored, restoredCalculation) {
  const out = {};
  const selected = getSelectedWavelengths().map(String);

  selected.forEach((wave) => {
    const src = restored[String(wave)] || {};
    const calcSettings = restoredCalculation?.waveSettings?.[String(wave)] || {};
    const calcMeasurements = restoredCalculation?.measurements?.[String(wave)] || {};

    const startCoreCount = Number(src.startCoreCount ?? calcSettings.startCoreCount ?? calcMeasurements.startCoreCount ?? 4);
    const endCoreCount = Number(src.endCoreCount ?? calcSettings.endCoreCount ?? calcMeasurements.endCoreCount ?? 4);
    const startFirstLineNo = src.startFirstLineNo ?? calcSettings.startFirstLineNo ?? calcMeasurements.startFirstLineNo ?? "1";
    const endFirstLineNo = src.endFirstLineNo ?? calcSettings.endFirstLineNo ?? calcMeasurements.endFirstLineNo ?? "1";

    out[String(wave)] = {
      startCalibration: src.startCalibration ?? formatCalibrationInputValue(calcSettings.startCalibration ?? calcMeasurements.startCalibration),
      endCalibration: src.endCalibration ?? formatCalibrationInputValue(calcSettings.endCalibration ?? calcMeasurements.endCalibration),
      startCoreCount,
      endCoreCount,
      startFirstLineNo,
      endFirstLineNo,
      startValues: normalizeRestoredSideValues(src.startValues || calcMeasurements.startValues || [], startCoreCount, startFirstLineNo),
      endValues: normalizeRestoredSideValues(src.endValues || calcMeasurements.endValues || [], endCoreCount, endFirstLineNo)
    };
  });

  return out;
}

function normalizeRestoredSideValues(values, count, firstLineNo) {
  const rows = [];
  for (let i = 0; i < Number(count || 0); i++) {
    const row = values[i] || {};
    rows.push({
      lineNo: row.lineNo || incrementLineLabel(firstLineNo || "1", i),
      value: row.value === null || row.value === undefined ? "" : String(row.value),
      memo: row.memo || ""
    });
  }
  return rows;
}


function setupInputPreviewForAllFields() {
  document.querySelectorAll("input, select, textarea").forEach((el) => {
    if (el.dataset.previewReady === "true") return;
    if (el.type === "file") return;
    el.dataset.previewReady = "true";
    el.addEventListener("focus", () => showPreviewForElement(el));
    el.addEventListener("input", () => updatePreviewForActiveElement());
    el.addEventListener("change", () => updatePreviewForActiveElement());
    el.addEventListener("blur", () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || !["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) hideInputPreview();
      }, 130);
    });
  });
}

function positionInputPreview() {
  const panel = $("inputPreview");
  if (!panel || panel.classList.contains("hidden")) return;
  const viewport = window.visualViewport;
  const viewportTop = viewport ? viewport.offsetTop : 0;
  const top = Math.max(8, Math.round(viewportTop + 8));
  panel.style.setProperty("position", "fixed", "important");
  panel.style.setProperty("top", `${top}px`, "important");
  panel.style.setProperty("left", "10px", "important");
  panel.style.setProperty("right", "10px", "important");
  panel.style.setProperty("transform", "none", "important");
  panel.style.setProperty("z-index", "2147483647", "important");
  panel.style.setProperty("display", "block", "important");
}

function bindViewportPreviewReposition() {
  const reposition = () => {
    const panel = $("inputPreview");
    if (!panel || panel.classList.contains("hidden")) return;
    positionInputPreview();
  };
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("scroll", reposition, { passive: true });
    window.visualViewport.addEventListener("resize", reposition);
  }
}

function showPreviewForElement(el) {
  updateInputPreview(el);
  $("inputPreview").classList.remove("hidden");
  positionInputPreview();
}

function updatePreviewForActiveElement() {
  const el = document.activeElement;
  if (!el || !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
  updateInputPreview(el);
}

function hideInputPreview() {
  $("inputPreview").classList.add("hidden");
}

function updateInputPreview(el) {
  if (!el) return;
  const context = getPreviewContext(el);
  $("previewLabel").textContent = context.label;
  $("previewValue").textContent = context.value || "未入力";

  const meta = $("previewMeta");
  meta.innerHTML = "";
  if (context.meta && context.meta.length) {
    context.meta.forEach((item) => {
      const span = document.createElement("span");
      span.textContent = item.text;
      if (item.className) span.classList.add(item.className);
      meta.appendChild(span);
    });
    meta.classList.remove("hidden");
  } else {
    meta.classList.add("hidden");
  }

  $("inputPreview").classList.remove("hidden");
  positionInputPreview();
}

function getPreviewContext(el) {
  if (el.classList.contains("measure-input")) {
    const wave = el.dataset.wave;
    const side = el.dataset.side;
    const sideLabel = side === "start" ? "始端側→遠端側" : "遠端側→始端側";
    const line = el.dataset.lineNo || "";
    const raw = el.value;
    const value = raw !== "" && Number.isFinite(Number(raw)) ? `${formatFixedTruncated(raw, 2)} dB` : "未入力";
    const d = ensureWave(wave);
    const calibration = side === "start" ? d.startCalibration : d.endCalibration;
    const calLabel = side === "start" ? "始点校正値" : "終点校正値";
    const judge = getResultForValue(raw, latestCalculation?.results?.[wave]?.standardValue);

    return {
      label: `${wave}nm　${sideLabel}　線番${line}`,
      value,
      meta: [
        { text: latestCalculation?.results?.[wave] ? `規格値：${latestCalculation.results[wave].displayStandardValue} dB` : "規格値：未計算" },
        { text: `${calLabel}：${formatCalibrationDisplay(calibration)} dB` },
        { text: `判定：${judge}`, className: judge === "OK" ? "preview-ok" : judge === "NG" ? "preview-ng" : "preview-pending" }
      ]
    };
  }

  if (el.classList.contains("line-memo-input")) {
    const wave = el.dataset.wave;
    const side = el.dataset.side === "start" ? "始端側→遠端側" : "遠端側→始端側";
    return { label: `${wave}nm　${side}メモ　線番${el.dataset.lineNo || ""}`, value: el.value || "未入力", meta: [] };
  }

  if (el.classList.contains("wave-config-input")) {
    const wave = el.dataset.wave;
    const kind = el.dataset.kind;
    const map = {
      startCalibration: "始点校正値",
      endCalibration: "終点校正値",
      startCoreCount: "芯線数 始端",
      endCoreCount: "芯線数 遠端",
      startFirstLineNo: "始端側開始線番",
      endFirstLineNo: "遠端側開始線番"
    };
    let value = el.value || "";
    if (kind === "startCalibration" || kind === "endCalibration") {
      value = value !== "" && Number.isFinite(Number(value)) ? `${formatFixedTruncated(value, 2)} dB` : "";
    } else if (kind === "startCoreCount" || kind === "endCoreCount") {
      value = value ? `${value} 芯` : "";
    }
    return { label: `${wave}nm ${map[kind] || "設定"}`, value: value || "未入力", meta: [] };
  }

  const id = el.id;
  let label = previewLabels[id] || "入力値";
  let value = el.value || "";

  if (id === "workNo") value = value ? formatWorkNo(value) || value : "";
  else if (id === "startLm" || id === "endLm") value = value ? `${value} m` : "";
  else if (id === "spliceCount") value = value ? `${value} 点` : "";
  else if (id === "connectorCount") value = value ? `${value} 個` : "";
  else if (id === "wavelength") value = getSelectedWavelengths().map((w) => `${w}nm`).join(" / ");

  const meta = [];
  if (latestCalculation) {
    meta.push({ text: `規格値：${latestCalculation.wavelengths.map((w) => `${w}nm ${latestCalculation.results[String(w)].displayStandardValue}dB`).join(" / ")}` });
  }

  return { label, value: value || "未入力", meta };
}

function validateWorkNo() {
  const value = $("workNo").value.trim();
  if (!/^\d{5}$/.test(value)) throw new Error("工事番号はK-を除いた数字5桁で入力してください。例：26001");
  return value;
}

function formatWorkNo(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? `K-${digits}` : "";
}

function getNumber(id, label, min = null) {
  const raw = $(id).value;
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value)) throw new Error(`${label}を入力してください。`);
  if (min !== null && value < min) throw new Error(`${label}は${min}以上で入力してください。`);
  return value;
}

function incrementLineLabel(baseLabel, offset) {
  const text = String(baseLabel || "").trim();
  if (text === "") return "";
  if (/^-?\d+$/.test(text)) return String(Number(text) + offset);
  const match = text.match(/^(.*?)(\d+)$/);
  if (!match) return offset === 0 ? text : `${text}+${offset}`;
  const prefix = match[1];
  const numText = match[2];
  return `${prefix}${String(Number(numText) + offset).padStart(numText.length, "0")}`;
}

function getResultForValue(raw, standard) {
  const value = toNullableNumber(raw);
  if (value === null || standard === undefined) return "未判定";
  return value <= standard ? "OK" : "NG";
}

function formatAllCalibrationInputs() {
  document.querySelectorAll(".calibration-input").forEach(formatCalibrationInput);
  collectWaveInputs();
}

function formatCalibrationInput(input) {
  if (!input || input.value === "") return;
  const value = Number(input.value);
  if (Number.isFinite(value)) input.value = formatFixedTruncated(value, 2);
}

function formatCalibrationInputValue(value) {
  if (value === "" || value === null || value === undefined) return "";
  return formatFixedTruncated(value, 2);
}

function formatCalibrationDisplay(value) {
  if (value === "" || value === null || value === undefined) return "";
  return formatFixedTruncated(value, 2);
}

function formatMeasuredInput(input) {
  if (!input || input.value === "") return;
  const value = Number(input.value);
  if (Number.isFinite(value)) input.value = formatFixedTruncated(value, 2);
}

function formatMeasuredValue(value) {
  if (value === "" || value === null || value === undefined) return "";
  return formatFixedTruncated(value, 2);
}

function toNullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function truncateNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return number < 0 ? Math.ceil(number * factor) / factor : Math.floor(number * factor) / factor;
}

function formatFixedTruncated(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return truncateNumber(number, digits).toFixed(digits);
}

function formatNumber(value, digits) {
  return formatFixedTruncated(value, digits).replace(/\.?0+$/, "");
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${h}:${min}`;
}

function dateStamp() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}-${h}${min}`;
}

function safeFileName(value) {
  return String(value || "smgi").replace(/[\\/:*?"<>|]/g, "_");
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultClass(result) {
  return result === "OK" ? "ok" : result === "NG" ? "ng" : "pending";
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}
