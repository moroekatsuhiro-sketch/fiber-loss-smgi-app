(() => {
  const devices = {
    AQ4280A: { label: 'LD光源 ・ AQ4280A', cableType: 'SM', wavelengths: [1310, 1550] },
    MiNi368: { label: 'LD光源 ・ MiNi368', cableType: 'GI', wavelengths: [850, 1310] },
    KI2800: { label: 'LED光源 ・ KI2800', cableType: 'GI', wavelengths: [850, 1300] }
  };
  const DEVICE_KEY = 'fiberLossSmgiMeasurementDeviceV1';

  function deviceSelect() {
    return document.getElementById('measurementDevice');
  }

  function currentDevice() {
    return devices[deviceSelect()?.value] || null;
  }

  function inferDevice(record) {
    if (record?.measurementDevice && devices[record.measurementDevice]) return record.measurementDevice;
    const waves = (record?.wavelengths || []).map(Number);
    if (record?.cableType === 'SM') return 'AQ4280A';
    if (waves.includes(1310)) return 'MiNi368';
    return 'KI2800';
  }

  function installMeasurementDeviceField() {
    if (deviceSelect()) return;
    const cableType = document.getElementById('cableType');
    if (!cableType) return;
    const grid = cableType.closest('.grid.two');
    if (!grid) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'grid two';
    wrapper.innerHTML = `
      <label>
        測定器
        <select id="measurementDevice">
          ${Object.entries(devices).map(([value, d]) => `<option value="${value}">${d.label}</option>`).join('')}
        </select>
        <span class="hint">測定器に合わせてケーブル種類と測定波長を自動で組み合わせます。</span>
      </label>
      <div></div>
    `;
    grid.parentNode.insertBefore(wrapper, grid);

    const saved = localStorage.getItem(DEVICE_KEY);
    deviceSelect().value = devices[saved] ? saved : 'AQ4280A';
  }

  installMeasurementDeviceField();

  const originalGetAvailableWavelengths = getAvailableWavelengths;
  getAvailableWavelengths = function(type = document.getElementById('cableType')?.value) {
    const device = currentDevice();
    if (device) return [...device.wavelengths];
    return originalGetAvailableWavelengths(type);
  };

  const originalGetBaseInput = getBaseInput;
  getBaseInput = function() {
    const input = originalGetBaseInput();
    const key = deviceSelect()?.value || '';
    const device = devices[key];
    if (!device) throw new Error('測定器を選択してください。');
    if (input.cableType !== device.cableType) {
      throw new Error(`測定器 ${device.label} は ${device.cableType} 用です。ケーブル種類を確認してください。`);
    }
    const selected = input.wavelengths.map(Number);
    if (selected.some((wave) => !device.wavelengths.includes(wave))) {
      throw new Error(`測定器 ${device.label} で使用できる波長は ${device.wavelengths.join(' / ')}nm です。`);
    }
    return { ...input, measurementDevice: key, measurementDeviceLabel: device.label };
  };

  const originalStartEditRecord = startEditRecord;
  startEditRecord = function(id) {
    const record = loadRecords().find((item) => item.id === id);
    const selected = inferDevice(record);
    if (deviceSelect()) deviceSelect().value = selected;
    localStorage.setItem(DEVICE_KEY, selected);
    return originalStartEditRecord(id);
  };

  const originalBuildCsvRows = buildCsvRows;
  buildCsvRows = function(records) {
    let out = null;
    records.forEach((record) => {
      const part = originalBuildCsvRows([record]);
      const key = inferDevice(record);
      const label = devices[key]?.label || record.measurementDeviceLabel || '';
      if (!out) {
        const header = [...part[0]];
        header.splice(14, 0, '測定器');
        out = [header];
      }
      part.slice(1).forEach((row) => {
        const next = [...row];
        next.splice(14, 0, label);
        out.push(next);
      });
    });
    if (out) return out;
    const empty = originalBuildCsvRows([]);
    const header = [...empty[0]];
    header.splice(14, 0, '測定器');
    return [header];
  };

  const originalRenderCalculation = renderCalculation;
  renderCalculation = function(calc) {
    originalRenderCalculation(calc);
    const device = devices[calc.measurementDevice];
    const breakdown = document.getElementById('detailBreakdown');
    if (!breakdown || !device) return;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `<strong>測定器</strong><span>${escapeHtml(device.label)}</span>`;
    breakdown.insertBefore(row, breakdown.firstChild);
  };

  const originalRenderReportSheet = renderReportSheet;
  renderReportSheet = function(record) {
    let html = originalRenderReportSheet(record);
    const key = inferDevice(record);
    const label = devices[key]?.label || record.measurementDeviceLabel || '';
    if (!label) return html;
    const marker = '<div class="report-info-item"><strong>ケーブル種類</strong>';
    const item = `<div class="report-info-item"><strong>測定器</strong><span>${escapeHtml(label)}</span></div>`;
    return html.includes(marker) ? html.replace(marker, item + marker) : html;
  };

  function applyDeviceSelection({ preserveWavelength = false } = {}) {
    const device = currentDevice();
    if (!device) return;
    localStorage.setItem(DEVICE_KEY, deviceSelect().value);
    const cableType = document.getElementById('cableType');
    const wavelength = document.getElementById('wavelength');
    const previous = wavelength?.value;
    if (cableType) cableType.value = device.cableType;
    if (typeof collectWaveInputs === 'function') collectWaveInputs();
    if (typeof updateWavelengthOptions === 'function') updateWavelengthOptions();
    if (preserveWavelength && wavelength && [String(device.wavelengths[0]), String(device.wavelengths[1]), 'both'].includes(previous)) {
      wavelength.value = previous;
    }
    if (typeof clearCalculationOnly === 'function') clearCalculationOnly();
    if (typeof renderWaveConfigs === 'function') renderWaveConfigs(true);
    if (typeof renderMeasurements === 'function') renderMeasurements(true);
    if (typeof saveDraftSoon === 'function') saveDraftSoon();
  }

  deviceSelect()?.addEventListener('change', () => applyDeviceSelection());

  document.addEventListener('DOMContentLoaded', () => {
    const device = currentDevice();
    if (device) {
      const cableType = document.getElementById('cableType');
      if (cableType) cableType.value = device.cableType;
      updateWavelengthOptions();
    }

    if (typeof previewLabels === 'object') previewLabels.measurementDevice = '測定器';
    if (typeof setupInputPreviewForAllFields === 'function') setupInputPreviewForAllFields();
  });
})();
