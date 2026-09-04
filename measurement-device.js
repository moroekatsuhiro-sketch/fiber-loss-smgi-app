(() => {
  const POWER_METER = "パワーメータ ・ AQ2170";
  const DEVICE_RULES = {
    AQ4280A: { model: "AQ4280A", label: "LD光源 ・ AQ4280A", cableType: "SM", waves: [1310, 1550] },
    MiNi368: { model: "MiNi368", label: "LD光源 ・ MiNi368", cableType: "GI", waves: [850, 1310], calculationWaveMap: { 1310: 1300 } },
    KI2800: { model: "KI2800", label: "LED光源 ・ KI2800", cableType: "GI", waves: [850, 1300] }
  };

  const byId = (id) => document.getElementById(id);
  const originalGetAvailableWavelengths = window.getAvailableWavelengths;
  const originalGetBaseInput = window.getBaseInput;
  const originalBuildDraftData = window.buildDraftData;
  const originalRestoreDraft = window.restoreDraft;
  const originalStartEditRecord = window.startEditRecord;
  const originalBuildCsvRows = window.buildCsvRows;
  const originalRenderCalculation = window.renderCalculation;
  const originalRenderReportSheet = window.renderReportSheet;

  function ruleFromValue(value) {
    if (!value) return null;
    if (DEVICE_RULES[value]) return DEVICE_RULES[value];
    return Object.values(DEVICE_RULES).find((rule) => rule.label === value) || null;
  }

  function defaultDeviceForType(type) {
    return type === "SM" ? "AQ4280A" : "MiNi368";
  }

  function allowedDevicesForType(type) {
    return Object.values(DEVICE_RULES).filter((rule) => rule.cableType === type);
  }

  function inferLegacyDevice(type, preferred, wavelengths, wavelengthSelection) {
    const preferredRule = ruleFromValue(preferred);
    if (preferredRule?.cableType === type) return preferredRule.model;
    if (type === "SM") return "AQ4280A";
    const waves = (wavelengths || []).map(Number);
    if (waves.includes(1300)) return "KI2800";
    if (waves.includes(1310)) return "MiNi368";
    if (wavelengthSelection === "both" || String(wavelengthSelection) === "1300") return "KI2800";
    return defaultDeviceForType(type);
  }

  function installDeviceFields() {
    if (byId("sourceDevice")) return;
    const cableType = byId("cableType");
    const wavelength = byId("wavelength");
    if (!cableType || !wavelength) return;
    const anchorGrid = cableType.closest(".grid.two");
    if (!anchorGrid) return;

    const grid = document.createElement("div");
    grid.className = "grid two";
    grid.innerHTML = `
      <label>
        光源
        <select id="sourceDevice"></select>
        <span class="hint">光源に応じて使用可能な測定波長を自動で切り替えます。</span>
      </label>
      <label>
        パワーメータ
        <input id="powerMeter" type="text" value="${POWER_METER}" readonly>
        <span class="hint">固定：AQ2170</span>
      </label>
    `;
    anchorGrid.insertAdjacentElement("afterend", grid);
  }

  function syncDeviceOptions(type, preferred = "") {
    installDeviceFields();
    const select = byId("sourceDevice");
    if (!select) return;
    const rules = allowedDevicesForType(type);
    const preferredRule = ruleFromValue(preferred);
    const currentRule = ruleFromValue(select.value);
    const chosen = preferredRule?.cableType === type
      ? preferredRule.model
      : currentRule?.cableType === type
        ? currentRule.model
        : defaultDeviceForType(type);

    select.innerHTML = rules.map((rule) => `<option value="${rule.model}">${rule.label}</option>`).join("");
    select.value = rules.some((rule) => rule.model === chosen) ? chosen : rules[0]?.model || "";
    const meter = byId("powerMeter");
    if (meter) meter.value = POWER_METER;
  }

  function selectedDeviceRule(type = byId("cableType")?.value) {
    const selected = ruleFromValue(byId("sourceDevice")?.value);
    if (selected && selected.cableType === type) return selected;
    return ruleFromValue(defaultDeviceForType(type));
  }

  window.getAvailableWavelengths = function getAvailableWavelengthsByDevice(type = byId("cableType")?.value) {
    const rule = selectedDeviceRule(type);
    return rule ? [...rule.waves] : originalGetAvailableWavelengths(type);
  };

  window.getBaseInput = function getBaseInputWithDevice() {
    const input = originalGetBaseInput();
    const rule = selectedDeviceRule(input.cableType);
    if (!rule) throw new Error("光源を選択してください。");
    if (rule.cableType !== input.cableType) throw new Error("ケーブル種類と光源の組み合わせを確認してください。");
    const allowed = new Set(rule.waves);
    if (input.wavelengths.some((wave) => !allowed.has(wave))) {
      throw new Error(`${rule.label}で使用できない測定波長が選択されています。`);
    }
    input.sourceDeviceModel = rule.model;
    input.sourceDevice = rule.label;
    input.powerMeter = POWER_METER;
    return input;
  };

  window.calculateSmgi = function calculateSmgiWithDevice(input) {
    const results = {};
    const rule = ruleFromValue(input.sourceDeviceModel) || selectedDeviceRule(input.cableType);
    input.wavelengths.forEach((wave) => {
      const calculationWave = rule?.calculationWaveMap?.[wave] ?? wave;
      const master = smgiMaster[input.cableType]?.wavelengths?.[calculationWave];
      if (!master) throw new Error(`${input.cableType} ${wave}nm の規格値計算条件がありません。`);
      const cableLossValue = input.lengthKm * master.cableLoss;
      const spliceLossValue = input.spliceCount * master.spliceLoss;
      const connectorLossValue = input.connectorCount * master.connectorLoss;
      const rawStandardValue = cableLossValue + spliceLossValue + connectorLossValue;
      const standardValue = truncateNumber(rawStandardValue, 2);
      results[String(wave)] = {
        wavelength: wave,
        calculationWavelength: calculationWave,
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
  };

  window.buildDraftData = function buildDraftDataWithDevice() {
    const data = originalBuildDraftData();
    const rule = selectedDeviceRule(data.form?.cableType || byId("cableType")?.value);
    data.form = data.form || {};
    data.form.sourceDevice = rule?.model || "";
    data.form.powerMeter = POWER_METER;
    return data;
  };

  window.restoreDraft = function restoreDraftWithDevice(draftData) {
    const form = draftData?.form || {};
    const type = form.cableType || "SM";
    const preferred = inferLegacyDevice(type, form.sourceDevice || "", draftData?.latestCalculation?.wavelengths, form.wavelength);
    syncDeviceOptions(type, preferred);
    originalRestoreDraft(draftData);
  };

  window.startEditRecord = function startEditRecordWithDevice(id) {
    const record = typeof loadRecords === "function" ? loadRecords().find((item) => item.id === id) : null;
    if (record) {
      const preferred = inferLegacyDevice(record.cableType || "SM", record.sourceDeviceModel || record.sourceDevice || "", record.wavelengths, record.wavelengths?.length > 1 ? "both" : record.wavelengths?.[0]);
      syncDeviceOptions(record.cableType || "SM", preferred);
    }
    originalStartEditRecord(id);
  };

  window.buildCsvRows = function buildCsvRowsWithDevice(records) {
    const baseHeaders = originalBuildCsvRows([])[0];
    const insertAt = baseHeaders.indexOf("ケーブル種類") + 1;
    const headers = [...baseHeaders];
    headers.splice(insertAt, 0, "光源", "パワーメータ");
    const out = [headers];

    records.forEach((record) => {
      const rows = originalBuildCsvRows([record]).slice(1);
      rows.forEach((row) => {
        const next = [...row];
        next.splice(insertAt, 0, record.sourceDevice || "", record.powerMeter || POWER_METER);
        out.push(next);
      });
    });
    return out;
  };

  window.renderCalculation = function renderCalculationWithDevice(calc) {
    originalRenderCalculation(calc);
    const target = byId("detailBreakdown");
    if (!target) return;
    const device = calc.sourceDevice || selectedDeviceRule(calc.cableType)?.label || "";
    target.insertAdjacentHTML("afterbegin", `
      <div class="breakdown-row"><strong>光源</strong><span>${escapeHtml(device)}</span></div>
      <div class="breakdown-row"><strong>パワーメータ</strong><span>${escapeHtml(calc.powerMeter || POWER_METER)}</span></div>
    `);
  };

  window.renderReportSheet = function renderReportSheetWithDevice(record) {
    let html = originalRenderReportSheet(record);
    const marker = '<div class="report-info-item"><strong>波長</strong>';
    const extra = `<div class="report-info-item"><strong>光源</strong><span>${escapeHtml(record.sourceDevice || "")}</span></div>` +
      `<div class="report-info-item"><strong>パワーメータ</strong><span>${escapeHtml(record.powerMeter || POWER_METER)}</span></div>`;
    if (html.includes(marker)) html = html.replace(marker, extra + marker);
    return html;
  };

  installDeviceFields();
  syncDeviceOptions(byId("cableType")?.value || "SM");
  if (typeof previewLabels === "object") previewLabels.sourceDevice = "光源";

  document.addEventListener("DOMContentLoaded", () => {
    const sourceDevice = byId("sourceDevice");
    const cableType = byId("cableType");

    sourceDevice?.addEventListener("change", () => {
      if (typeof collectWaveInputs === "function") collectWaveInputs();
      if (typeof updateWavelengthOptions === "function") updateWavelengthOptions();
      if (typeof clearCalculationOnly === "function") clearCalculationOnly();
      if (typeof renderWaveConfigs === "function") renderWaveConfigs(true);
      if (typeof renderMeasurements === "function") renderMeasurements(true);
      if (typeof saveDraftSoon === "function") saveDraftSoon();
      if (typeof updatePreviewForActiveElement === "function") updatePreviewForActiveElement();
    });

    cableType?.addEventListener("change", () => {
      syncDeviceOptions(cableType.value);
      if (typeof updateWavelengthOptions === "function") updateWavelengthOptions();
      if (typeof clearCalculationOnly === "function") clearCalculationOnly();
      if (typeof renderWaveConfigs === "function") renderWaveConfigs(true);
      if (typeof renderMeasurements === "function") renderMeasurements(true);
      if (typeof saveDraftSoon === "function") saveDraftSoon();
    });

    ["newDraftBtn", "resetInputBtn"].forEach((id) => {
      byId(id)?.addEventListener("click", () => setTimeout(() => {
        syncDeviceOptions(byId("cableType")?.value || "SM");
        if (typeof updateWavelengthOptions === "function") updateWavelengthOptions();
      }, 0));
    });

    if (typeof setupInputPreviewForAllFields === "function") setupInputPreviewForAllFields();
  });
})();
