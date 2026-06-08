const STORAGE_KEY = "fiberLossRecords.v1";

const normalStandards = {
  SM: {
    name: "SM",
    formulaType: "normal",
    wavelengths: {
      1310: { cableLoss: 0.50, spliceLoss: 0.15, connectorLoss: 0.35 },
      1550: { cableLoss: 0.30, spliceLoss: 0.15, connectorLoss: 0.35 }
    }
  },
  GI: {
    name: "GI",
    formulaType: "normal",
    wavelengths: {
      850: { cableLoss: 3.00, spliceLoss: 0.15, connectorLoss: 0.35 },
      1300: { cableLoss: 1.00, spliceLoss: 0.15, connectorLoss: 0.35 }
    }
  }
};

const siStandards = {
  "S01-L2": {
    name: "S01-L2",
    wavelength: 850,
    formulaType: "af_plus_fixed",
    cableLoss: 5.5,
    fixedLoss: 2.0,
    decimalProcess: "truncate_1_decimal"
  },
  "DL-72": {
    name: "DL-72",
    wavelength: 850,
    formulaType: "af_plus_fixed",
    cableLoss: 6.0,
    fixedLoss: 2.0,
    decimalProcess: "truncate_1_decimal"
  },
  "DLC-L2": {
    name: "DLC-L2",
    wavelength: 850,
    formulaType: "af_plus_fixed",
    cableLoss: 6.0,
    fixedLoss: 2.0,
    decimalProcess: "truncate_1_decimal"
  },
  "CF系(圧着)": {
    name: "CF系(圧着)",
    wavelength: 810,
    formulaType: "cf_press_piecewise",
    fixedLoss: 1.5,
    decimalProcess: "truncate_1_decimal"
  }
};

const $ = (id) => document.getElementById(id);

let latestCalculation = null;
let editingRecordId = null;
let measurementDraftRows = [];
let ocrTargetInputId = null;

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initForm();
  initButtons();
  generateCoreInputs();
  renderHistory();
  renderStandardsPreview();
  registerServiceWorker();
});

function initNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.screen).classList.add("active");
      if (btn.dataset.screen === "historyScreen") renderHistory();
    });
  });
}

function initForm() {
  $("cableType").addEventListener("change", () => {
    updateCableMode();
    clearResultOnly();
  });

  initLineConfigControls();

  $("startPanel").addEventListener("input", updateAutoSectionName);
  $("endPanel").addEventListener("input", updateAutoSectionName);
  $("sectionName").addEventListener("input", rememberManualSectionName);

  ["startLm", "endLm", "wavelength", "spliceCount", "connectorCount"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", clearResultOnly);
    el.addEventListener("change", clearResultOnly);
  });

  $("calcForm").addEventListener("reset", () => {
    setTimeout(() => {
      updateCableMode();
      generateCoreInputs();
      clearResultOnly();
      $("connectorCount").value = 2;
      $("startCoreCount").value = 4;
      $("endCoreCount").value = 4;
      $("startFirstLineNo").value = "1";
      $("endFirstLineNo").value = "1";
      $("measurementMode").value = "both";
      $("endCoreCount").dataset.manual = "false";
      $("sectionName").dataset.lastAuto = "";
      $("sectionName").dataset.manual = "false";
      clearMeasurementDraftRows();
      cancelEditMode(false);
    }, 0);
  });

  updateCableMode();
}

function initButtons() {
  $("calculateBtn").addEventListener("click", handleCalculate);
  $("saveBtn").addEventListener("click", handleSave);
  $("cancelEditBtn").addEventListener("click", cancelEditMode);
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("clearAllBtn").addEventListener("click", clearAllRecords);
  $("downloadJsonBtn").addEventListener("click", downloadJsonBackup);
  $("importJsonBtn").addEventListener("click", () => $("importJsonFile").click());
  $("importJsonFile").addEventListener("change", importJsonBackup);

  $("ocrSiteBtn").addEventListener("click", () => openOcrPicker("siteName"));
  $("ocrStartBtn").addEventListener("click", () => openOcrPicker("startPanel"));
  $("ocrEndBtn").addEventListener("click", () => openOcrPicker("endPanel"));
}

function updateAutoSectionName() {
  const sectionInput = $("sectionName");
  const startPanel = $("startPanel").value.trim();
  const endPanel = $("endPanel").value.trim();
  const lastAutoValue = sectionInput.dataset.lastAuto || "";
  const isManual = sectionInput.dataset.manual === "true";
  const currentValue = sectionInput.value.trim();

  // 区間名が手入力で変更済みなら、自動上書きしない。
  // ただし、現在値が前回の自動生成値と同じなら自動更新を続ける。
  if (isManual && currentValue !== "" && currentValue !== lastAutoValue) {
    return;
  }

  const nextAutoValue = startPanel && endPanel ? `${startPanel} ～ ${endPanel}` : "";
  sectionInput.value = nextAutoValue;
  sectionInput.dataset.lastAuto = nextAutoValue;
  sectionInput.dataset.manual = "false";
}

function rememberManualSectionName() {
  const sectionInput = $("sectionName");
  const lastAutoValue = sectionInput.dataset.lastAuto || "";
  const currentValue = sectionInput.value.trim();

  sectionInput.dataset.manual = currentValue !== "" && currentValue !== lastAutoValue ? "true" : "false";
}


function initLineConfigControls() {
  const ids = ["measurementMode", "startCoreCount", "endCoreCount", "startFirstLineNo", "endFirstLineNo"];

  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      if (id === "startCoreCount") syncEndCoreCountIfNeeded();
      if (id === "endCoreCount") $("endCoreCount").dataset.manual = "true";
      generateCoreInputs(true);
      clearResultOnly();
    });

    el.addEventListener("change", () => {
      if (id === "startCoreCount") syncEndCoreCountIfNeeded();
      if (id === "endCoreCount") $("endCoreCount").dataset.manual = "true";
      generateCoreInputs(true);
      clearResultOnly();
    });
  });

  $("endCoreCount").dataset.manual = "false";
}

function syncEndCoreCountIfNeeded() {
  const endInput = $("endCoreCount");
  if (endInput.dataset.manual !== "true") {
    endInput.value = $("startCoreCount").value;
  }
}

function updateEntryDirectionVisibility() {
  // 旧版互換用。現在は入力結果一覧方式のため使用しない。
}

function getLineConfig() {
  const startCoreCount = Math.max(1, Math.min(288, Math.floor(Number($("startCoreCount").value || 1))));
  const endCoreCount = Math.max(1, Math.min(288, Math.floor(Number($("endCoreCount").value || startCoreCount))));
  const rowCount = Math.max(startCoreCount, endCoreCount);

  return {
    measurementMode: $("measurementMode").value,
    startCoreCount,
    endCoreCount,
    rowCount,
    startFirstLineNo: $("startFirstLineNo").value.trim() || "1",
    endFirstLineNo: $("endFirstLineNo").value.trim() || "1"
  };
}

function incrementLineLabel(baseLabel, offset) {
  const text = String(baseLabel || "").trim();
  if (text === "") return "";

  const pureNumber = Number(text);
  if (Number.isFinite(pureNumber) && /^-?\d+$/.test(text)) {
    return String(pureNumber + offset);
  }

  const match = text.match(/^(.*?)(\d+)$/);
  if (!match) {
    return offset === 0 ? text : `${text}+${offset}`;
  }

  const prefix = match[1];
  const numText = match[2];
  const nextNum = String(Number(numText) + offset).padStart(numText.length, "0");
  return `${prefix}${nextNum}`;
}


function updateCableMode() {
  const cableType = $("cableType").value;
  const wavelengthSelect = $("wavelength");
  wavelengthSelect.innerHTML = "";

  const wavelengths = Object.keys(normalStandards[cableType].wavelengths);

  wavelengthSelect.innerHTML = [
    ...wavelengths.map((w) => `<option value="${w}">${w}nm</option>`),
    `<option value="both">両波長（${wavelengths.join("nm / ")}nm）</option>`
  ].join("");
}

function getNumber(id, label, { required = true, min = null } = {}) {
  const raw = $(id).value;
  if (raw === "" || raw === null) {
    if (required) throw new Error(`${label}を入力してください。`);
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}は数値で入力してください。`);
  if (min !== null && value < min) throw new Error(`${label}は${min}以上で入力してください。`);
  return value;
}

function getBaseInput() {
  const startLm = getNumber("startLm", "始端LM", { min: 0 });
  const endLm = getNumber("endLm", "遠端LM", { min: 0 });
  const spliceCount = getNumber("spliceCount", "融着点数", { min: 0 });
  const connectorCount = getNumber("connectorCount", "コネクタ数", { min: 0 });
  const startCoreCount = getNumber("startCoreCount", "始端側芯数", { min: 1 });
  const endCoreCount = getNumber("endCoreCount", "遠端側芯数", { min: 1 });
  const rowCount = Math.max(Math.floor(startCoreCount), Math.floor(endCoreCount));

  return {
    siteName: $("siteName").value.trim(),
    sectionName: $("sectionName").value.trim(),
    startPanel: $("startPanel").value.trim(),
    endPanel: $("endPanel").value.trim(),
    startLm,
    endLm,
    lengthM: Math.abs(endLm - startLm),
    lengthKm: Math.abs(endLm - startLm) / 1000,
    cableType: $("cableType").value,
    spliceCount,
    connectorCount,
    startCoreCount: Math.floor(startCoreCount),
    endCoreCount: Math.floor(endCoreCount),
    rowCount,
    measurementMode: $("measurementMode").value,
    startFirstLineNo: $("startFirstLineNo").value.trim() || "1",
    endFirstLineNo: $("endFirstLineNo").value.trim() || "1",
    memo: $("memo").value.trim()
  };
}

function handleCalculate() {
  try {
    const input = getBaseInput();
    const calculation = calculateNormal(input);

    latestCalculation = {
      ...input,
      ...calculation
    };

    generateCoreInputs(true);
    renderCalculation(latestCalculation);
    updateCoreJudgements();
  } catch (error) {
    latestCalculation = null;
    renderError(error.message);
  }
}

function calculateNormal(input) {
  const selectedWavelengths = getActiveWavelengths(input.cableType);
  const standardValues = {};
  const displayStandardValues = {};
  const coefficientsByWavelength = {};
  const componentsByWavelength = {};

  selectedWavelengths.forEach((wavelength) => {
    const standard = normalStandards[input.cableType].wavelengths[wavelength];

    const cableLossValue = input.lengthKm * standard.cableLoss;
    const spliceLossValue = input.spliceCount * standard.spliceLoss;
    const connectorLossValue = input.connectorCount * standard.connectorLoss;
    const rawStandardValue = cableLossValue + spliceLossValue + connectorLossValue;
    const standardValue = Number(rawStandardValue.toFixed(2));

    standardValues[wavelength] = standardValue;
    displayStandardValues[wavelength] = standardValue.toFixed(2);
    coefficientsByWavelength[wavelength] = { ...standard };
    componentsByWavelength[wavelength] = {
      cableLossValue,
      spliceLossValue,
      connectorLossValue,
      rawStandardValue
    };
  });

  const primaryWavelength = selectedWavelengths[0];
  const isDualWavelength = selectedWavelengths.length > 1;

  return {
    formulaType: "normal",
    wavelength: isDualWavelength ? "both" : primaryWavelength,
    wavelengths: selectedWavelengths,
    wavelengthLabel: formatWavelengthLabel(selectedWavelengths),
    standardName: "",
    standardValue: standardValues[primaryWavelength],
    standardValues,
    displayStandardValue: isDualWavelength
      ? selectedWavelengths.map((w) => `${w}nm ${displayStandardValues[w]}dB`).join(" / ")
      : displayStandardValues[primaryWavelength],
    displayStandardValues,
    unitDisplayDecimals: 2,
    coefficients: coefficientsByWavelength[primaryWavelength],
    coefficientsByWavelength,
    components: componentsByWavelength[primaryWavelength],
    componentsByWavelength,
    warning: ""
  };
}

function calculateSi(input) {
  const standardName = $("siStandard").value;
  const standard = siStandards[standardName];

  let af;
  let rawStandardValue;

  if (standard.formulaType === "af_plus_fixed") {
    af = input.lengthKm * standard.cableLoss;
    rawStandardValue = af + standard.fixedLoss;
  } else if (standard.formulaType === "cf_press_piecewise") {
    if (input.lengthKm > 1) {
      throw new Error("CF系(圧着)は1kmを超えるため計算範囲外です");
    }

    if (input.lengthKm <= 0.1) {
      af = 1.1;
    } else {
      af = (7 - 4 * Math.log10(input.lengthKm)) * input.lengthKm;
    }
    rawStandardValue = af + standard.fixedLoss;
  } else {
    throw new Error("未対応のSI計算方式です。");
  }

  const standardValue = truncateTo1Decimal(rawStandardValue);

  return {
    formulaType: standard.formulaType,
    wavelength: standard.wavelength,
    standardName,
    standardValue,
    rawStandardValue,
    displayStandardValue: standardValue.toFixed(1),
    unitDisplayDecimals: 1,
    coefficients: { ...standard },
    components: {
      af,
      fixedLoss: standard.fixedLoss,
      cableLoss: standard.cableLoss ?? null
    },
    warning: ""
  };
}

function truncateTo1Decimal(value) {
  return Math.floor(value * 10) / 10;
}

function renderCalculation(calc) {
  $("resultCard").classList.remove("hidden");
  $("coresCard").classList.remove("hidden");
  $("errorBox").classList.add("hidden");
  $("errorBox").textContent = "";

  const standardValueHtml = (calc.wavelengths || [calc.wavelength]).map((wavelength) => {
    const displayValue = calc.displayStandardValues?.[wavelength] || calc.displayStandardValue;
    return `<div class="standard-line"><strong>${wavelength}nm</strong><span>${displayValue} dB</span></div>`;
  }).join("");

  $("resultSummary").innerHTML = `
    <div class="result-main">
      <div>
        <div class="result-label">規格値</div>
        <div class="small">${escapeHtml(calc.cableType)} / ${escapeHtml(calc.wavelengthLabel || String(calc.wavelength) + "nm")}</div>
      </div>
      <div class="result-value multi-standard">${standardValueHtml}</div>
    </div>
  `;

  const rows = [
    ["ケーブル長", `${formatNumber(calc.lengthM, 3)} m / ${formatNumber(calc.lengthKm, 6)} km`],
    ["計算方式", "通常計算"]
  ];

  (calc.wavelengths || [calc.wavelength]).forEach((wavelength) => {
    const components = calc.componentsByWavelength?.[wavelength] || calc.components;
    rows.push([`${wavelength}nm ケーブル損失`, `${formatNumber(components.cableLossValue, 6)} dB`]);
    rows.push([`${wavelength}nm 融着損失`, `${formatNumber(components.spliceLossValue, 6)} dB`]);
    rows.push([`${wavelength}nm コネクタ損失`, `${formatNumber(components.connectorLossValue, 6)} dB`]);
  });

  $("detailBreakdown").innerHTML = rows
    .map(([label, value]) => `
      <div class="breakdown-row">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `)
    .join("");

  updateCoreJudgements();
}

function renderError(message) {
  $("resultCard").classList.remove("hidden");
  $("coresCard").classList.add("hidden");
  $("errorBox").classList.remove("hidden");
  $("errorBox").textContent = message;
  $("resultSummary").innerHTML = "";
  $("detailBreakdown").innerHTML = "";
}

function clearResultOnly() {
  latestCalculation = null;
  $("resultCard").classList.add("hidden");

  // 測定値入力欄は消さない。
  // 条件変更後は規格値が未計算になるため、判定表示だけ未判定に戻す。
  document.querySelectorAll(".badge[data-result]").forEach((badge) => {
    badge.className = "badge pending";
    badge.textContent = "未判定";
  });
}


function mergeCoreRows(baseRows = [], updateRows = []) {
  const map = new Map();

  baseRows.forEach((row) => {
    if (!row || !row.coreNo) return;
    map.set(Number(row.coreNo), { ...row });
  });

  updateRows.forEach((row) => {
    if (!row || !row.coreNo) return;
    const coreNo = Number(row.coreNo);
    const existing = map.get(coreNo) || {};
    map.set(coreNo, { ...existing, ...row });
  });

  return Array.from(map.values()).sort((a, b) => Number(a.coreNo) - Number(b.coreNo));
}

function rememberCurrentCoreRows() {
  const currentRows = collectCoreFormRows();
  measurementDraftRows = mergeCoreRows(measurementDraftRows, currentRows);
}

function clearMeasurementDraftRows() {
  measurementDraftRows = [];
}

function getDraftRow(coreNo, fallbackRows = []) {
  const draft = measurementDraftRows.find((row) => Number(row.coreNo) === Number(coreNo));
  if (draft) return draft;

  return fallbackRows.find((row) => Number(row.coreNo) === Number(coreNo)) || {};
}


function getActiveWavelengths(cableType = $("cableType").value) {
  const selected = $("wavelength").value;
  const wavelengths = Object.keys(normalStandards[cableType].wavelengths).map(Number);

  if (selected === "both") {
    return wavelengths;
  }

  const single = Number(selected || wavelengths[0]);
  return [single];
}

function formatWavelengthLabel(wavelengths) {
  return (wavelengths || []).map((w) => `${w}nm`).join(" / ");
}

function normalizeRecordWavelengths(recordOrCalc) {
  if (Array.isArray(recordOrCalc?.wavelengths) && recordOrCalc.wavelengths.length > 0) {
    return recordOrCalc.wavelengths.map(Number);
  }

  if (recordOrCalc?.wavelength === "both" && recordOrCalc?.cableType && normalStandards[recordOrCalc.cableType]) {
    return Object.keys(normalStandards[recordOrCalc.cableType].wavelengths).map(Number);
  }

  if (recordOrCalc?.wavelength !== undefined && recordOrCalc?.wavelength !== null && recordOrCalc.wavelength !== "") {
    return [Number(recordOrCalc.wavelength)];
  }

  return getActiveWavelengths();
}

function getStandardValueForWavelength(wavelength) {
  const key = String(wavelength);

  if (latestCalculation?.standardValues && latestCalculation.standardValues[key] !== undefined) {
    return latestCalculation.standardValues[key];
  }

  return latestCalculation?.standardValue;
}

function getDraftMeasurements(row, direction) {
  const objectKey = direction === "forward" ? "forwardMeasurements" : "reverseMeasurements";
  const legacyKey = direction === "forward" ? "forwardMeasuredValue" : "reverseMeasuredValue";

  if (row?.[objectKey] && typeof row[objectKey] === "object") {
    return { ...row[objectKey] };
  }

  if (row?.[legacyKey] !== undefined && row[legacyKey] !== "") {
    const firstWavelength = getActiveWavelengths()[0];
    return { [firstWavelength]: row[legacyKey] };
  }

  return {};
}

function getCoreMeasurementObject(core, direction, wavelength) {
  const objectKey = direction === "forward" ? "forwardMeasurements" : "reverseMeasurements";
  const legacyValueKey = direction === "forward" ? "forwardMeasuredValue" : "reverseMeasuredValue";
  const legacyResultKey = direction === "forward" ? "forwardResult" : "reverseResult";

  if (core?.[objectKey] && core[objectKey][wavelength]) {
    return core[objectKey][wavelength];
  }

  if (core?.[objectKey] && core[objectKey][String(wavelength)]) {
    return core[objectKey][String(wavelength)];
  }

  if (core?.[legacyValueKey] !== undefined) {
    return {
      value: core[legacyValueKey],
      result: core[legacyResultKey] || ""
    };
  }

  return {
    value: null,
    result: ""
  };
}

function renderWaveSideRow(row, side, wavelength) {
  const isStart = side === "start";
  const hasSide = isStart ? row.hasStartSide : row.hasEndSide;
  const direction = isStart ? "forward" : "reverse";
  const lineInputClass = isStart ? "line-start-input" : "line-end-input";
  const lineLabel = isStart ? "始端側線番" : "遠端側線番";
  const valueLabel = isStart ? "始端側測定値 dB" : "遠端側測定値 dB";
  const lineValue = isStart ? row.startLineNo : row.endLineNo;
  const measurements = isStart ? row.forwardMeasurements : row.reverseMeasurements;
  const measurementValue = measurements?.[wavelength] ?? measurements?.[String(wavelength)] ?? "";

  if (!hasSide) {
    return `
      <div class="wave-side-row disabled-side-row" data-core="${row.coreNo}" data-side="${side}" data-wavelength="${wavelength}">
        <div class="side-row-no">${row.coreNo}</div>
        <div class="disabled-text">対象外</div>
        <div class="disabled-text">対象外</div>
        <div class="badge pending">未判定</div>
      </div>
    `;
  }

  return `
    <div class="wave-side-row" data-core="${row.coreNo}" data-side="${side}" data-wavelength="${wavelength}">
      <div class="side-row-no">${row.coreNo}</div>
      <input class="${lineInputClass}" type="text" inputmode="text" placeholder="${lineLabel}" data-core="${row.coreNo}" value="${escapeHtml(lineValue)}">
      <input class="measured-input" type="number" inputmode="decimal" step="0.001" min="0" placeholder="${valueLabel}" data-core="${row.coreNo}" data-direction="${direction}" data-wavelength="${wavelength}" value="${escapeHtml(measurementValue)}">
      <span class="badge pending" data-result="${row.coreNo}-${direction}-${wavelength}">未判定</span>
    </div>
  `;
}

function renderWavelengthGroup(wavelength, rows, showStartSide, showEndSide) {
  const startSection = showStartSide ? `
    <div class="wave-side-block">
      <h4>始端側測定入力</h4>
      <div class="wave-side-header">
        <div>行</div>
        <div>始端側線番</div>
        <div>始端側測定値</div>
        <div>判定</div>
      </div>
      ${rows.map((row) => renderWaveSideRow(row, "start", wavelength)).join("")}
    </div>
  ` : "";

  const endSection = showEndSide ? `
    <div class="wave-side-block">
      <h4>遠端側測定入力</h4>
      <div class="wave-side-header">
        <div>行</div>
        <div>遠端側線番</div>
        <div>遠端側測定値</div>
        <div>判定</div>
      </div>
      ${rows.map((row) => renderWaveSideRow(row, "end", wavelength)).join("")}
    </div>
  ` : "";

  return `
    <section class="wavelength-group-card">
      <h3>${wavelength}nm 測定入力</h3>
      ${startSection}
      ${endSection}
    </section>
  `;
}

function renderSummaryRow(i, lineMemo, wavelengths) {
  const forwardCells = wavelengths.map((w) => `
    <div class="summary-cell multi" data-summary="${i}-forwardValue-${w}"></div>
    <div class="summary-cell multi" data-summary="${i}-forwardResult-${w}"></div>
  `).join("");

  const reverseCells = wavelengths.map((w) => `
    <div class="summary-cell multi" data-summary="${i}-reverseValue-${w}"></div>
    <div class="summary-cell multi" data-summary="${i}-reverseResult-${w}"></div>
  `).join("");

  return `
    <div class="measurement-summary-row" data-summary-core="${i}" style="--wave-count:${wavelengths.length}">
      <div class="summary-no">${i}</div>
      <div class="summary-cell" data-summary="${i}-startLine"></div>
      ${forwardCells}
      <div class="summary-cell" data-summary="${i}-endLine"></div>
      ${reverseCells}
      <input class="line-memo-input" type="text" placeholder="メモ" data-core="${i}" value="${escapeHtml(lineMemo)}">
    </div>
  `;
}

function generateCoreInputs(keepValues = false) {
  const container = $("coreInputs");

  if (keepValues) {
    rememberCurrentCoreRows();
  } else {
    clearMeasurementDraftRows();
  }

  const oldRows = keepValues ? measurementDraftRows : [];
  const config = getLineConfig();
  const wavelengths = getActiveWavelengths();

  const showStartSide = config.measurementMode === "both" || config.measurementMode === "forward";
  const showEndSide = config.measurementMode === "both" || config.measurementMode === "reverse";

  const rows = [];

  for (let i = 1; i <= config.rowCount; i++) {
    const old = getDraftRow(i, oldRows);
    rows.push({
      coreNo: i,
      hasStartSide: i <= config.startCoreCount,
      hasEndSide: i <= config.endCoreCount,
      startLineNo: old.startLineNo ?? (i <= config.startCoreCount ? incrementLineLabel(config.startFirstLineNo, i - 1) : ""),
      endLineNo: old.endLineNo ?? (i <= config.endCoreCount ? incrementLineLabel(config.endFirstLineNo, i - 1) : ""),
      forwardMeasurements: getDraftMeasurements(old, "forward"),
      reverseMeasurements: getDraftMeasurements(old, "reverse"),
      lineMemo: old.lineMemo ?? ""
    });
  }

  const wavelengthGroups = wavelengths
    .map((wavelength) => renderWavelengthGroup(wavelength, rows, showStartSide, showEndSide))
    .join("");

  const forwardHeader = wavelengths.map((w) => `
    <div>始端 ${w}nm</div>
    <div>判定</div>
  `).join("");

  const reverseHeader = wavelengths.map((w) => `
    <div>遠端 ${w}nm</div>
    <div>判定</div>
  `).join("");

  const summarySection = `
    <section class="measurement-summary-card">
      <h3>入力結果一覧</h3>
      <div class="measurement-summary-header" style="--wave-count:${wavelengths.length}">
        <div>行</div>
        <div>始端側線番</div>
        ${forwardHeader}
        <div>遠端側線番</div>
        ${reverseHeader}
        <div>線番メモ</div>
      </div>
      ${rows.map((row) => renderSummaryRow(row.coreNo, row.lineMemo, wavelengths)).join("")}
    </section>
  `;

  container.innerHTML = `
    <div class="measurement-entry-layout">
      ${wavelengthGroups}
      ${summarySection}
    </div>
  `;

  container.querySelectorAll(".measured-input").forEach((input) => {
    input.addEventListener("input", updateCoreJudgements);
    input.addEventListener("blur", () => {
      formatMeasuredInput(input);
      updateCoreJudgements();
    });
  });

  container.querySelectorAll(".line-start-input, .line-end-input, .line-memo-input").forEach((input) => {
    input.addEventListener("input", updateMeasurementSummary);
  });

  updateCoreJudgements();
  updateMeasurementSummary();
}

function collectCoreFormRows() {
  const summaryRows = Array.from(document.querySelectorAll(".measurement-summary-row"));

  return summaryRows.map((row) => {
    const coreNo = Number(row.dataset.summaryCore);
    const forwardMeasurements = {};
    const reverseMeasurements = {};

    document.querySelectorAll(`.measured-input[data-core="${coreNo}"][data-direction="forward"]`).forEach((input) => {
      forwardMeasurements[input.dataset.wavelength] = input.value ?? "";
    });

    document.querySelectorAll(`.measured-input[data-core="${coreNo}"][data-direction="reverse"]`).forEach((input) => {
      reverseMeasurements[input.dataset.wavelength] = input.value ?? "";
    });

    return {
      coreNo,
      startLineNo: document.querySelector(`.line-start-input[data-core="${coreNo}"]`)?.value ?? "",
      endLineNo: document.querySelector(`.line-end-input[data-core="${coreNo}"]`)?.value ?? "",
      forwardMeasurements,
      reverseMeasurements,
      lineMemo: row.querySelector(".line-memo-input")?.value ?? ""
    };
  });
}

function updateCoreJudgements() {
  if (!latestCalculation) {
    updateMeasurementSummary();
    return;
  }

  document.querySelectorAll(".measured-input").forEach((input) => {
    const core = input.dataset.core;
    const direction = input.dataset.direction;
    const wavelength = input.dataset.wavelength;
    const resultEl = document.querySelector(`[data-result="${core}-${direction}-${wavelength}"]`);
    const raw = input.value;

    if (!resultEl) return;

    resultEl.className = "badge pending";
    resultEl.textContent = "未判定";

    if (raw === "") {
      updateMeasurementSummary();
      return;
    }

    const measured = Number(raw);
    if (!Number.isFinite(measured)) {
      updateMeasurementSummary();
      return;
    }

    const standardValue = getStandardValueForWavelength(wavelength);

    if (measured <= standardValue) {
      resultEl.className = "badge ok";
      resultEl.textContent = "OK";
    } else {
      resultEl.className = "badge ng";
      resultEl.textContent = "NG";
    }
  });

  updateMeasurementSummary();
}

function resultBadgeHtml(result) {
  if (!result) return "";
  const className = getResultBadgeClass(result);
  return `<span class="badge ${className}">${escapeHtml(result)}</span>`;
}

function updateMeasurementSummary() {
  const wavelengths = latestCalculation?.wavelengths || getActiveWavelengths();

  document.querySelectorAll(".measurement-summary-row").forEach((row) => {
    const coreNo = row.dataset.summaryCore;

    const startLine = document.querySelector(`.line-start-input[data-core="${coreNo}"]`)?.value || "";
    const endLine = document.querySelector(`.line-end-input[data-core="${coreNo}"]`)?.value || "";

    const setText = (key, value) => {
      const el = document.querySelector(`[data-summary="${coreNo}-${key}"]`);
      if (el) {
        el.textContent = value;
        el.classList.remove("summary-result-ok", "summary-result-ng", "summary-result-pending");
      }
    };

    const setResult = (key, result, hasValue) => {
      const el = document.querySelector(`[data-summary="${coreNo}-${key}"]`);
      if (!el) return;

      el.classList.remove("summary-result-ok", "summary-result-ng", "summary-result-pending");
      el.innerHTML = "";

      if (!hasValue) return;

      el.innerHTML = resultBadgeHtml(result);
      if (result === "OK") el.classList.add("summary-result-ok");
      if (result === "NG") el.classList.add("summary-result-ng");
      if (result === "未判定") el.classList.add("summary-result-pending");
    };

    setText("startLine", startLine);
    setText("endLine", endLine);

    wavelengths.forEach((wavelength) => {
      const forwardInput = document.querySelector(`.measured-input[data-core="${coreNo}"][data-direction="forward"][data-wavelength="${wavelength}"]`);
      const reverseInput = document.querySelector(`.measured-input[data-core="${coreNo}"][data-direction="reverse"][data-wavelength="${wavelength}"]`);
      const forwardResult = document.querySelector(`[data-result="${coreNo}-forward-${wavelength}"]`)?.textContent || "";
      const reverseResult = document.querySelector(`[data-result="${coreNo}-reverse-${wavelength}"]`)?.textContent || "";

      const forwardValue = forwardInput ? formatMeasuredInputValue(forwardInput.value) : "";
      const reverseValue = reverseInput ? formatMeasuredInputValue(reverseInput.value) : "";

      setText(`forwardValue-${wavelength}`, forwardValue);
      setResult(`forwardResult-${wavelength}`, forwardResult, Boolean(forwardValue));
      setText(`reverseValue-${wavelength}`, reverseValue);
      setResult(`reverseResult-${wavelength}`, reverseResult, Boolean(reverseValue));
    });
  });
}

function judgeMeasuredValue(value, wavelength) {
  if (!latestCalculation) return "未判定";
  if (value === null || !Number.isFinite(value)) return "未判定";
  return value <= getStandardValueForWavelength(wavelength) ? "OK" : "NG";
}

function toNullableNumber(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function collectCoreResults() {
  if (!latestCalculation) return [];

  const mode = latestCalculation.measurementMode || $("measurementMode").value;
  const wavelengths = latestCalculation.wavelengths || getActiveWavelengths();

  return Array.from(document.querySelectorAll(".measurement-summary-row")).map((row) => {
    const coreNo = Number(row.dataset.summaryCore);
    const forwardMeasurements = {};
    const reverseMeasurements = {};

    wavelengths.forEach((wavelength) => {
      const forwardValue = mode === "both" || mode === "forward"
        ? toNullableNumber(document.querySelector(`.measured-input[data-core="${coreNo}"][data-direction="forward"][data-wavelength="${wavelength}"]`)?.value)
        : null;
      const reverseValue = mode === "both" || mode === "reverse"
        ? toNullableNumber(document.querySelector(`.measured-input[data-core="${coreNo}"][data-direction="reverse"][data-wavelength="${wavelength}"]`)?.value)
        : null;

      forwardMeasurements[wavelength] = {
        value: forwardValue,
        result: mode === "both" || mode === "forward" ? judgeMeasuredValue(forwardValue, wavelength) : ""
      };

      reverseMeasurements[wavelength] = {
        value: reverseValue,
        result: mode === "both" || mode === "reverse" ? judgeMeasuredValue(reverseValue, wavelength) : ""
      };
    });

    const firstWavelength = wavelengths[0];

    return {
      coreNo,
      startLineNo: document.querySelector(`.line-start-input[data-core="${coreNo}"]`)?.value.trim() || "",
      endLineNo: document.querySelector(`.line-end-input[data-core="${coreNo}"]`)?.value.trim() || "",
      measurementMode: mode,
      forwardMeasurements,
      reverseMeasurements,
      forwardMeasuredValue: forwardMeasurements[firstWavelength]?.value ?? null,
      forwardResult: forwardMeasurements[firstWavelength]?.result ?? "",
      reverseMeasuredValue: reverseMeasurements[firstWavelength]?.value ?? null,
      reverseResult: reverseMeasurements[firstWavelength]?.result ?? "",
      lineMemo: row.querySelector(".line-memo-input")?.value.trim() || ""
    };
  });
}

function handleSave() {
  if (!latestCalculation) {
    alert("先に規格値を計算してください。");
    return;
  }

  // 保存前に測定値表示を小数第2位へ整える
  document.querySelectorAll(".measured-input").forEach(formatMeasuredInput);
  rememberCurrentCoreRows();
  updateCoreJudgements();

  const records = loadRecords();
  const now = new Date();

  const existing = editingRecordId
    ? records.find((record) => record.id === editingRecordId)
    : null;

  const record = {
    id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    savedAt: existing?.savedAt || now.toISOString(),
    updatedAt: editingRecordId ? now.toISOString() : "",
    siteName: latestCalculation.siteName,
    sectionName: latestCalculation.sectionName,
    startPanel: latestCalculation.startPanel,
    endPanel: latestCalculation.endPanel,
    startLm: latestCalculation.startLm,
    endLm: latestCalculation.endLm,
    lengthM: latestCalculation.lengthM,
    lengthKm: latestCalculation.lengthKm,
    cableType: latestCalculation.cableType,
    wavelength: latestCalculation.wavelength,
    wavelengths: latestCalculation.wavelengths,
    wavelengthLabel: latestCalculation.wavelengthLabel,
    standardValues: latestCalculation.standardValues,
    displayStandardValues: latestCalculation.displayStandardValues,
    siStandardName: latestCalculation.standardName,
    spliceCount: latestCalculation.spliceCount,
    connectorCount: latestCalculation.connectorCount,
    startCoreCount: latestCalculation.startCoreCount,
    endCoreCount: latestCalculation.endCoreCount,
    rowCount: latestCalculation.rowCount,
    measurementMode: latestCalculation.measurementMode,
    startFirstLineNo: latestCalculation.startFirstLineNo,
    endFirstLineNo: latestCalculation.endFirstLineNo,
    formulaType: latestCalculation.formulaType,
    standardValue: latestCalculation.standardValue,
    rawStandardValue: latestCalculation.rawStandardValue,
    displayStandardValue: latestCalculation.displayStandardValue,
    coefficients: latestCalculation.coefficients,
    components: latestCalculation.components,
    cores: collectCoreResults(),
    memo: latestCalculation.memo
  };

  if (editingRecordId) {
    const index = records.findIndex((item) => item.id === editingRecordId);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.unshift(record);
    }
    saveRecords(records);
    cancelEditMode(false);
    renderHistory();
    alert("履歴を更新しました。");
    return;
  }

  records.unshift(record);
  saveRecords(records);
  renderHistory();
  alert("履歴に保存しました。");
}


function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function renderHistory() {
  const list = $("historyList");
  const records = loadRecords();

  if (records.length === 0) {
    list.innerHTML = `<p class="small">保存履歴はまだありません。</p>`;
    return;
  }

  list.innerHTML = "";

  records.forEach((record) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const title = [
      record.siteName || "現場名未入力",
      record.sectionName || `${record.startPanel || "始端"} → ${record.endPanel || "遠端"}`
    ].join(" / ");

    const resultList = flattenCoreResults(record.cores);
    const okCount = resultList.filter((result) => result === "OK").length;
    const ngCount = resultList.filter((result) => result === "NG").length;
    const pendingCount = resultList.filter((result) => result === "未判定").length;

    item.innerHTML = `
      <button class="history-toggle" type="button">
        <div class="history-title">
          <strong>${escapeHtml(title)}</strong>
          <span class="history-meta">
            ${formatDateTime(record.savedAt)} / ${escapeHtml(record.cableType)} ${escapeHtml(record.wavelengthLabel || (record.wavelengths ? formatWavelengthLabel(record.wavelengths) : String(record.wavelength) + "nm"))} /
            規格値 ${escapeHtml(record.displayStandardValue)}dB /
            OK ${okCount}・NG ${ngCount}・未判定 ${pendingCount}
          </span>
        </div>
      </button>
      <div class="history-detail">
        ${renderHistoryDetail(record)}
      </div>
    `;

    item.querySelector(".history-toggle").addEventListener("click", () => {
      item.classList.toggle("open");
    });

    item.querySelector(".delete-record-btn").addEventListener("click", () => {
      deleteRecord(record.id);
    });

    item.querySelector(".edit-record-btn").addEventListener("click", () => {
      startEditRecord(record.id);
    });

    item.querySelector(".export-record-csv-btn").addEventListener("click", () => {
      exportRecordCsv(record.id);
    });

    list.appendChild(item);
  });
}

function getCoreDisplayValue(core, key, fallback = "") {
  return core[key] === undefined || core[key] === null ? fallback : core[key];
}

function getResultBadgeClass(result) {
  return result === "OK" ? "ok" : result === "NG" ? "ng" : "pending";
}

function flattenCoreResults(cores = []) {
  return cores.flatMap((core) => {
    // 旧データ互換
    if (core.forwardResult === undefined && core.reverseResult === undefined && core.result !== undefined) {
      return [core.result];
    }
    const results = [];
    if (core.forwardResult) results.push(core.forwardResult);
    if (core.reverseResult) results.push(core.reverseResult);
    return results.length ? results : ["未判定"];
  });
}

function renderHistoryDetail(record) {
  const wavelengths = normalizeRecordWavelengths(record);

  const coreRows = record.cores.map((core) => {
    const startLineNo = getCoreDisplayValue(core, "startLineNo", String(core.coreNo));
    const endLineNo = getCoreDisplayValue(core, "endLineNo", String(core.coreNo));
    const lineMemo = core.lineMemo || core.forwardMemo || core.reverseMemo || "";

    const forwardCells = wavelengths.map((wavelength) => {
      const measured = getCoreMeasurementObject(core, "forward", wavelength);
      const result = measured.result || "";
      const resultHtml = result
        ? `<span class="badge ${getResultBadgeClass(result)}">${escapeHtml(result)}</span>`
        : "";
      return `
        <td>${formatMeasuredDisplay(measured.value)}</td>
        <td>${resultHtml}</td>
      `;
    }).join("");

    const reverseCells = wavelengths.map((wavelength) => {
      const measured = getCoreMeasurementObject(core, "reverse", wavelength);
      const result = measured.result || "";
      const resultHtml = result
        ? `<span class="badge ${getResultBadgeClass(result)}">${escapeHtml(result)}</span>`
        : "";
      return `
        <td>${formatMeasuredDisplay(measured.value)}</td>
        <td>${resultHtml}</td>
      `;
    }).join("");

    return `
      <tr>
        <td>${escapeHtml(startLineNo)}</td>
        ${forwardCells}
        <td>${escapeHtml(endLineNo)}</td>
        ${reverseCells}
        <td>${escapeHtml(lineMemo)}</td>
      </tr>
    `;
  }).join("");

  const forwardHeaders = wavelengths.map((w) => `
    <th>始端側 ${w}nm</th>
    <th>判定</th>
  `).join("");

  const reverseHeaders = wavelengths.map((w) => `
    <th>遠端側 ${w}nm</th>
    <th>判定</th>
  `).join("");

  return `
    <div class="detail-grid">
      <div><strong>始端盤名</strong><span>${escapeHtml(record.startPanel || "")}</span></div>
      <div><strong>遠端盤名</strong><span>${escapeHtml(record.endPanel || "")}</span></div>
      <div><strong>始端LM</strong><span>${escapeHtml(String(record.startLm))} m</span></div>
      <div><strong>遠端LM</strong><span>${escapeHtml(String(record.endLm))} m</span></div>
      <div><strong>ケーブル長</strong><span>${formatNumber(record.lengthM, 3)} m / ${formatNumber(record.lengthKm, 6)} km</span></div>
      <div><strong>波長</strong><span>${escapeHtml(record.wavelengthLabel || formatWavelengthLabel(wavelengths))}</span></div>
      <div><strong>規格値</strong><span>${escapeHtml(record.displayStandardValue || "")} dB</span></div>
      <div><strong>測定方向</strong><span>${escapeHtml(record.measurementMode || "both")}</span></div>
      <div><strong>始端/遠端芯数</strong><span>${escapeHtml(String(record.startCoreCount || ""))} / ${escapeHtml(String(record.endCoreCount || ""))}</span></div>
      <div><strong>融着点数</strong><span>${escapeHtml(String(record.spliceCount))}</span></div>
      <div><strong>コネクタ数</strong><span>${escapeHtml(String(record.connectorCount))}</span></div>
      <div><strong>メモ</strong><span>${escapeHtml(record.memo || "")}</span></div>
    </div>
    <div class="table-scroll">
      <table class="core-table wide">
        <thead>
          <tr>
            <th>始端側線番</th>
            ${forwardHeaders}
            <th>遠端側線番</th>
            ${reverseHeaders}
            <th>線番メモ</th>
          </tr>
        </thead>
        <tbody>${coreRows}</tbody>
      </table>
    </div>
    <div class="actions">
      <button type="button" class="secondary export-record-csv-btn">この履歴をCSV出力</button>
      <button type="button" class="primary edit-record-btn">この履歴を編集</button>
      <button type="button" class="danger delete-record-btn">この履歴を削除</button>
    </div>
  `;
}

function startEditRecord(id) {
  const records = loadRecords();
  const record = records.find((item) => item.id === id);

  if (!record) {
    alert("編集対象の履歴が見つかりません。");
    return;
  }

  editingRecordId = id;
  fillFormFromRecord(record);

  switchScreen("calcScreen");

  $("saveBtn").textContent = "履歴を更新";
  $("cancelEditBtn").classList.remove("hidden");
  $("coresCard").classList.remove("hidden");

  alert("履歴を編集モードで開きました。修正後に「履歴を更新」を押してください。");
}

function fillFormFromRecord(record) {
  $("siteName").value = record.siteName || "";
  $("sectionName").value = record.sectionName || "";
  $("startPanel").value = record.startPanel || "";
  $("endPanel").value = record.endPanel || "";
  $("startLm").value = record.startLm ?? "";
  $("endLm").value = record.endLm ?? "";
  $("cableType").value = record.cableType || "SM";
  updateCableMode();
  $("wavelength").value = Array.isArray(record.wavelengths) && record.wavelengths.length > 1
    ? "both"
    : String(record.wavelength || Object.keys(normalStandards[$("cableType").value].wavelengths)[0]);
  $("spliceCount").value = record.spliceCount ?? 0;
  $("connectorCount").value = record.connectorCount ?? 2;
  $("measurementMode").value = record.measurementMode || "both";
  $("startCoreCount").value = record.startCoreCount || record.rowCount || record.cores?.length || 1;
  $("endCoreCount").value = record.endCoreCount || record.startCoreCount || record.rowCount || record.cores?.length || 1;
  $("startFirstLineNo").value = record.startFirstLineNo || record.cores?.[0]?.startLineNo || "1";
  $("endFirstLineNo").value = record.endFirstLineNo || record.cores?.[0]?.endLineNo || "1";
  $("memo").value = record.memo || "";
  $("endCoreCount").dataset.manual = "true";
  $("sectionName").dataset.lastAuto = record.sectionName || "";
  $("sectionName").dataset.manual = "true";

  clearMeasurementDraftRows();
  measurementDraftRows = (record.cores || []).map((core, index) => {
    const coreNo = Number(core.coreNo || index + 1);
    const wavelengths = normalizeRecordWavelengths(record);
    const forwardMeasurements = {};
    const reverseMeasurements = {};

    wavelengths.forEach((wavelength) => {
      const forward = getCoreMeasurementObject(core, "forward", wavelength);
      const reverse = getCoreMeasurementObject(core, "reverse", wavelength);
      forwardMeasurements[wavelength] = formatMeasuredInputValue(forward.value);
      reverseMeasurements[wavelength] = formatMeasuredInputValue(reverse.value);
    });

    return {
      coreNo,
      startLineNo: core.startLineNo ?? String(coreNo),
      endLineNo: core.endLineNo ?? String(coreNo),
      forwardMeasurements,
      reverseMeasurements,
      lineMemo: core.lineMemo || core.forwardMemo || core.reverseMemo || ""
    };
  });

  generateCoreInputs(true);
  handleCalculate();
  applyRecordCores(record);
  updateCoreJudgements();
}

function applyRecordCores(record) {
  if (!record.cores) return;

  const wavelengths = normalizeRecordWavelengths(record);

  record.cores.forEach((core, index) => {
    const rowNumber = core.coreNo || index + 1;

    const startInput = document.querySelector(`.line-start-input[data-core="${rowNumber}"]`);
    const endInput = document.querySelector(`.line-end-input[data-core="${rowNumber}"]`);
    const memoInput = document.querySelector(`.line-memo-input[data-core="${rowNumber}"]`);

    if (startInput) startInput.value = core.startLineNo ?? String(rowNumber);
    if (endInput) endInput.value = core.endLineNo ?? String(rowNumber);
    if (memoInput) memoInput.value = core.lineMemo || core.forwardMemo || core.reverseMemo || "";

    wavelengths.forEach((wavelength) => {
      const forwardInput = document.querySelector(`.measured-input[data-core="${rowNumber}"][data-direction="forward"][data-wavelength="${wavelength}"]`);
      const reverseInput = document.querySelector(`.measured-input[data-core="${rowNumber}"][data-direction="reverse"][data-wavelength="${wavelength}"]`);
      const forward = getCoreMeasurementObject(core, "forward", wavelength);
      const reverse = getCoreMeasurementObject(core, "reverse", wavelength);

      if (forwardInput) forwardInput.value = formatMeasuredInputValue(forward.value);
      if (reverseInput) reverseInput.value = formatMeasuredInputValue(reverse.value);
    });
  });

  rememberCurrentCoreRows();
}

function cancelEditMode(clearMessage = true) {
  editingRecordId = null;
  $("saveBtn").textContent = "履歴に保存";
  $("cancelEditBtn").classList.add("hidden");

  if (clearMessage) {
    alert("編集をキャンセルしました。");
  }
}

function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === screenId);
  });
  $(screenId).classList.add("active");
}


function deleteRecord(id) {
  if (!confirm("この履歴を削除しますか？")) return;
  const records = loadRecords().filter((record) => record.id !== id);
  saveRecords(records);
  renderHistory();
}

function clearAllRecords() {
  if (!confirm("すべての履歴を削除します。よろしいですか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
}

function buildCsvRowsForRecords(records) {
  const headers = [
    "保存日時",
    "現場名",
    "区間名",
    "始端盤名",
    "遠端盤名",
    "始端LM",
    "遠端LM",
    "ケーブル長m",
    "ケーブル長km",
    "ケーブル種類",
    "波長",
    "融着点数",
    "コネクタ数",
    "測定方向",
    "始端側芯数",
    "遠端側芯数",
    "規格値",
    "始端側線番",
    "始端側測定値",
    "始端側判定",
    "遠端側線番",
    "遠端側測定値",
    "遠端側判定",
    "線番メモ",
    "区間メモ"
  ];

  const rows = [headers];

  records.forEach((record) => {
    const wavelengths = normalizeRecordWavelengths(record);

    // CSVも画面入力と同じく「波長ごと」に出力する。
    // 例：1310nm 全芯線 → 1550nm 全芯線
    wavelengths.forEach((wavelength) => {
      record.cores.forEach((core) => {
        const startLineNo = core.startLineNo ?? String(core.coreNo);
        const endLineNo = core.endLineNo ?? String(core.coreNo);
        const lineMemo = core.lineMemo || core.forwardMemo || core.reverseMemo || "";
        const forward = getCoreMeasurementObject(core, "forward", wavelength);
        const reverse = getCoreMeasurementObject(core, "reverse", wavelength);
        const standardValue = record.displayStandardValues?.[wavelength] || record.standardValues?.[wavelength] || record.displayStandardValue;

        rows.push([
          formatDateTime(record.savedAt),
          record.siteName,
          record.sectionName,
          record.startPanel,
          record.endPanel,
          record.startLm,
          record.endLm,
          formatNumber(record.lengthM, 3),
          formatNumber(record.lengthKm, 6),
          record.cableType,
          wavelength,
          record.spliceCount,
          record.connectorCount,
          record.measurementMode || core.measurementMode || "both",
          record.startCoreCount || "",
          record.endCoreCount || "",
          standardValue,
          startLineNo,
          formatMeasuredCsv(forward.value),
          forward.result || "",
          endLineNo,
          formatMeasuredCsv(reverse.value),
          reverse.result || "",
          lineMemo,
          record.memo
        ]);
      });
    });
  });

  return rows;
}

function exportCsv() {
  const records = loadRecords();

  if (records.length === 0) {
    alert("出力する履歴がありません。");
    return;
  }

  const csv = buildCsvRowsForRecords(records).map((row) => row.map(csvEscape).join(",")).join("\r\n");
  downloadTextFile("\uFEFF" + csv, `fiber-loss-history-all-${dateStamp()}.csv`, "text/csv;charset=utf-8;");
}

function exportRecordCsv(id) {
  const records = loadRecords();
  const record = records.find((item) => item.id === id);

  if (!record) {
    alert("CSV出力する履歴が見つかりません。");
    return;
  }

  const csv = buildCsvRowsForRecords([record]).map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const namePart = [
    record.siteName || "site",
    record.sectionName || "section",
    record.cableType || "cable"
  ].join("-").replace(/[\\/:*?"<>|]/g, "_");

  downloadTextFile("\uFEFF" + csv, `fiber-loss-${namePart}-${dateStamp()}.csv`, "text/csv;charset=utf-8;");
}

function downloadJsonBackup() {
  const records = loadRecords();
  const payload = {
    app: "fiber-loss-pwa",
    version: 1,
    exportedAt: new Date().toISOString(),
    records
  };

  downloadTextFile(JSON.stringify(payload, null, 2), `fiber-loss-backup-${dateStamp()}.json`, "application/json");
}

function importJsonBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!Array.isArray(payload.records)) throw new Error("records配列がありません。");

      if (!confirm("現在の履歴にJSONの履歴を追加します。よろしいですか？")) return;

      const current = loadRecords();
      const merged = [...payload.records, ...current];
      saveRecords(merged);
      renderHistory();
      alert("JSONを読み込みました。");
    } catch (error) {
      alert(`JSON読込に失敗しました：${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function renderStandardsPreview() {
  $("standardsPreview").textContent = JSON.stringify({
    normalStandards
  }, null, 2);
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


function formatMeasuredInput(input) {
  if (!input || input.value === "") return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  input.value = value.toFixed(2);
}

function formatMeasuredInputValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : "";
}

function formatMeasuredDisplay(value) {
  return escapeHtml(formatMeasuredInputValue(value));
}

function formatMeasuredCsv(value) {
  return formatMeasuredInputValue(value);
}


function formatNumber(value, digits) {
  if (!Number.isFinite(Number(value))) return "";
  return Number(value).toFixed(digits).replace(/\.?0+$/, (match) => match.startsWith(".") ? "" : "");
}

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function dateStamp() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function ensureOcrLibrary() {
  if (window.Tesseract) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-ocr-library="tesseract"]');
    if (existingScript) {
      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", () => reject(new Error("ローカルOCRライブラリを読み込めませんでした。vendor/tesseract/ 内のファイル配置を確認してください。")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "./vendor/tesseract/tesseract.min.js";
    script.async = true;
    script.dataset.ocrLibrary = "tesseract";
    script.onload = resolve;
    script.onerror = () => reject(new Error("ローカルOCRライブラリが見つかりません。vendor/tesseract/tesseract.min.js を配置してください。"));
    document.head.appendChild(script);
  });
}

function openOcrPicker(targetInputId) {
  ocrTargetInputId = targetInputId;

  const titleMap = {
    siteName: "現場名OCR確認",
    startPanel: "始端盤名OCR確認",
    endPanel: "遠端盤名OCR確認"
  };

  $("ocrModalTitle").textContent = titleMap[targetInputId] || "OCR確認";

  const fileInput = $("ocrFileInput");
  fileInput.value = "";
  fileInput.click();
}

async function handleOcrFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !ocrTargetInputId) return;

  const previewUrl = URL.createObjectURL(file);
  $("ocrPreview").src = previewUrl;
  $("ocrPreview").classList.remove("hidden");
  $("ocrModal").classList.remove("hidden");
  $("ocrStatus").className = "info-box";
  $("ocrStatus").textContent = "OCRエンジンを読み込んでいます。初回は少し時間がかかります。";
  $("ocrCandidates").innerHTML = "";
  $("ocrRawText").value = "";

  try {
    await ensureOcrLibrary();

    const result = await Tesseract.recognize(file, "jpn+eng", {
      workerPath: "./vendor/tesseract/worker.min.js",
      corePath: "./vendor/tesseract/tesseract-core.wasm.js",
      langPath: "./vendor/tesseract/",
      gzip: true,
      logger: (m) => {
        if (m.status && typeof m.progress === "number") {
          const percent = Math.round(m.progress * 100);
          $("ocrStatus").textContent = `${m.status} ${percent}%`;
        } else if (m.status) {
          $("ocrStatus").textContent = m.status;
        }
      }
    });

    const rawText = result?.data?.text || "";
    $("ocrRawText").value = rawText;

    const candidates = ocrTargetInputId === "siteName"
      ? extractGeneralNameCandidates(rawText)
      : extractPanelNameCandidates(rawText);

    if (candidates.length === 0) {
      $("ocrStatus").className = "error-box";
      $("ocrStatus").textContent = "候補を抽出できませんでした。OCR全文を確認して、手入力してください。";
      renderOcrManualInput("");
      return;
    }

    $("ocrStatus").className = "info-box";
    $("ocrStatus").textContent = "候補を選択してください。選択後、盤名欄へ反映します。";
    renderOcrCandidates(candidates);
  } catch (error) {
    $("ocrStatus").className = "error-box";
    $("ocrStatus").textContent = `OCRに失敗しました：${error.message}`;
    renderOcrManualInput("");
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}


function extractGeneralNameCandidates(rawText) {
  const lines = String(rawText || "")
    .replace(/[　]/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeOcrLine(line))
    .map((line) => cleanGeneralCandidate(line))
    .filter((line) => line.length >= 2 && line.length <= 40)
    .filter((line) => !/^(TEL|FAX|電話|住所|〒|URL|MAIL|E-mail)$/i.test(line))
    .filter((line) => !/^\d+(\.\d+)?$/.test(line));

  const scored = lines.map((line, index) => {
    let score = 0;
    if (/(ビル|工場|施設|現場|センター|棟|号館|株式会社|有限会社|病院|学校|支店|営業所)/.test(line)) score += 20;
    if (/(MDF|IDF|EPS|盤|成端|端子|光)/i.test(line)) score -= 5;
    if (line.length >= 4) score += 5;
    return { line, score, index };
  });

  const seen = new Set();
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.line)
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .slice(0, 8);
}

function cleanGeneralCandidate(text) {
  return String(text || "")
    .trim()
    .replace(/^[^\w一-龥ぁ-んァ-ン]+/, "")
    .replace(/[^\w一-龥ぁ-んァ-ン\-_\s（）()号棟館社場所店]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 40);
}


function extractPanelNameCandidates(rawText) {
  const normalized = rawText
    .replace(/[|｜]/g, "I")
    .replace(/[＿]/g, "_")
    .replace(/[－ー―]/g, "-")
    .replace(/[　]/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeOcrLine(line))
    .filter(Boolean);

  const candidates = [];
  const seen = new Set();

  const priorityPatterns = [
    /\b\d+\s*F\s*(MDF|IDF|EPS|HUB|SW|ONU|PD|盤|光|成端|BOX|BD)\b/i,
    /\b[A-Z]\s*棟\s*(EPS|MDF|IDF|盤|光|成端|BOX)?\s*[-_]?\s*\d*/i,
    /\b(MDF|IDF|EPS|光成端箱|成端箱|端子盤|弱電盤|HUB盤|ONU|PD)\s*[-_]?\s*[A-Z0-9]*\b/i,
    /\b[A-Z0-9]{1,6}\s*[-_]\s*[A-Z0-9]{1,8}\b/i
  ];

  for (const line of normalized) {
    const cleaned = cleanPanelCandidate(line);
    if (isLikelyPanelName(cleaned) && !seen.has(cleaned)) {
      candidates.push(cleaned);
      seen.add(cleaned);
    }

    for (const pattern of priorityPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        const value = cleanPanelCandidate(match[0]);
        if (value && !seen.has(value)) {
          candidates.unshift(value);
          seen.add(value);
        }
      }
    }
  }

  // 複数行がうまく抽出できない場合に備え、全文から短い候補も作る
  if (candidates.length === 0) {
    const words = rawText
      .replace(/\s+/g, " ")
      .split(/[、,。\/\\]/)
      .map((text) => cleanPanelCandidate(normalizeOcrLine(text)))
      .filter((text) => isLikelyPanelName(text));

    for (const word of words) {
      if (!seen.has(word)) {
        candidates.push(word);
        seen.add(word);
      }
    }
  }

  return candidates.slice(0, 8);
}

function normalizeOcrLine(line) {
  return String(line || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/１/g, "1")
    .replace(/２/g, "2")
    .replace(/３/g, "3")
    .replace(/４/g, "4")
    .replace(/５/g, "5")
    .replace(/６/g, "6")
    .replace(/７/g, "7")
    .replace(/８/g, "8")
    .replace(/９/g, "9")
    .replace(/０/g, "0")
    .replace(/Ｍ/g, "M")
    .replace(/Ｄ/g, "D")
    .replace(/Ｆ/g, "F")
    .replace(/Ｉ/g, "I")
    .replace(/Ｅ/g, "E")
    .replace(/Ｐ/g, "P")
    .replace(/Ｓ/g, "S")
    .replace(/Ｏ/g, "O");
}

function cleanPanelCandidate(text) {
  return String(text || "")
    .trim()
    .replace(/^[^\w一-龥ぁ-んァ-ン]+/, "")
    .replace(/[^\w一-龥ぁ-んァ-ン\-_\s（）()号棟盤箱]+$/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function isLikelyPanelName(text) {
  if (!text || text.length < 2) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  if (/^(TEL|FAX|電話|住所|株式会社|有限会社)$/i.test(text)) return false;

  return /(MDF|IDF|EPS|HUB|SW|ONU|PD|光|成端|端子|弱電|盤|箱|棟|\d+\s*F|BOX)/i.test(text);
}

function renderOcrCandidates(candidates) {
  const container = $("ocrCandidates");

  container.innerHTML = candidates.map((candidate) => `
    <button type="button" class="ocr-candidate-btn" data-candidate="${escapeHtml(candidate)}">
      ${escapeHtml(candidate)}
    </button>
  `).join("");

  container.querySelectorAll(".ocr-candidate-btn").forEach((button) => {
    button.addEventListener("click", () => applyOcrCandidate(button.dataset.candidate));
  });

  renderOcrManualInput(candidates[0] || "");
}

function renderOcrManualInput(initialValue) {
  const container = $("ocrCandidates");
  const manual = document.createElement("div");
  manual.className = "ocr-manual-row";
  manual.innerHTML = `
    <label>
      手入力で修正
      <input id="ocrManualInput" type="text" value="${escapeHtml(initialValue)}" placeholder="盤名を入力">
    </label>
    <button id="ocrManualApplyBtn" type="button" class="primary">反映</button>
  `;
  container.appendChild(manual);

  $("ocrManualApplyBtn").addEventListener("click", () => {
    applyOcrCandidate($("ocrManualInput").value.trim());
  });
}

function applyOcrCandidate(value) {
  if (!value || !ocrTargetInputId) return;

  $(ocrTargetInputId).value = value;
  updateAutoSectionName();
  closeOcrModal();
}

function closeOcrModal() {
  $("ocrModal").classList.add("hidden");
  $("ocrCandidates").innerHTML = "";
  $("ocrRawText").value = "";
  $("ocrPreview").src = "";
  $("ocrPreview").classList.add("hidden");
  $("ocrStatus").className = "info-box";
  $("ocrStatus").textContent = "";
}



function showOfflineOcrNotice() {
  alert("このオフライン安定版ではOCRは未搭載です。盤名は手入力してください。");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // ローカルHTTPや一部ブラウザでは失敗する場合があります。計算機能には影響しません。
    });
  }
}
