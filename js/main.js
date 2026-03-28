import { loadLanguage, languages, translate, updatePageText, getLanguage } from './utils/i18n.js';
import { logMessage, logDataMessage, downloadCSV, handleVisibilityChange, flushLogBuffer, saveSession, loadSession, clearSession, showToast, filterLogLines } from './utils/helpers.js';
import * as ChartHandler from './visualization/chart-handler.js';
import * as Serial from './core/serial.js';
import { sendSerial } from './core/serial.js';
import * as BLE from './core/ble.js';
import { sendBLE } from './core/ble.js';
import { initAnalysisUI, resetCalculusButtons } from './analysis/analysis-ui.js';
import { checkAlarms, setAlarm, clearAllAlarms } from './utils/alarm.js';

// --- State ---
let isLogging = false;
let isPaused = false;
let csvData = [];
let sensorNames = [];
let animationFrameId = null;
let csvChunkIndex = 0;
let sensorAutoDetected = false;
let perfTimeOrigin = 0; // performance.now() reference for high-res timing
let sessionSaveInterval = null;

// --- Sample Rate Tracking ---
let dataPointCount = 0;
let sampleRateInterval = null;
let sampleRateLogInterval = null;
let totalDataPointsFor30s = 0;

// --- Constants ---
const MAX_CSV_ROWS = 500000;

// --- UI Elements ---
const ui = {
    connectBtn: document.getElementById('connectBtn'),
    startBtn: document.getElementById('startLogging'),
    pauseBtn: document.getElementById('pauseLogging'),
    stopBtn: document.getElementById('stopLogging'),
    sensorCountInput: document.getElementById('sensorCount'),
    sensorInputsContainer: document.getElementById('sensorInputs'),
    deviceTypeSelect: document.getElementById('deviceType'),
    serialSettingsDiv: document.getElementById('serialSettings'),
    bleSettingsDiv: document.getElementById('bleSettings'),
    bleDeviceTypeSelect: document.getElementById('bleDeviceType'),
    languageSelector: document.getElementById('languageSelector'),
    baudRateSelect: document.getElementById('baudRate'),
    delimiterSelect: document.getElementById('delimiter'),
    individualYAxisCheckbox: document.getElementById('individualYAxis'),
    yAxisMinInput: document.getElementById('yAxisMin'),
    yAxisMaxInput: document.getElementById('yAxisMax'),
    statusLed: document.getElementById('statusLed'),
    sampleRateSpan: document.getElementById('sampleRate'),
    logSearchInput: document.getElementById('logSearch')
};

document.addEventListener('DOMContentLoaded', async () => {
    ChartHandler.initializeChart('dataChart');
    initAnalysisUI();
    populateLanguageSelector();

    // Load Language
    const savedLang = localStorage.getItem('selectedLanguage');
    const langToLoad = savedLang || (languages[navigator.language.split('-')[0]] ? navigator.language.split('-')[0] : 'ko');
    await changeLanguage(langToLoad);

    setupEventListeners();
    updateSensorInputs();
    logMessage('logAppInit');

    // Check for unsaved session
    const savedSession = await loadSession();
    if (savedSession && savedSession.csvData && savedSession.csvData.length > 1) {
        const elapsed = Math.round((Date.now() - savedSession.savedAt) / 60000);
        if (confirm((translate('sessionRestorePrompt') || `Unsaved session found (${elapsed} min ago, ${savedSession.csvData.length - 1} rows). Restore?`).replace('{minutes}', elapsed).replace('{rows}', savedSession.csvData.length - 1))) {
            csvData = savedSession.csvData;
            if (savedSession.sensorNames) {
                sensorNames = savedSession.sensorNames;
                ui.sensorCountInput.value = sensorNames.length;
                updateSensorInputs();
            }
            downloadCSV(csvData, sensorNames);
            logMessage('logSessionRestored');
        }
        clearSession();
    }
});

function populateLanguageSelector() {
    for (const [code, name] of Object.entries(languages)) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        ui.languageSelector.appendChild(option);
    }
}

async function changeLanguage(langCode) {
    const translations = await loadLanguage(langCode);
    if (translations) {
        updatePageText(translations);
        ChartHandler.updateChartDatasets(sensorNames); // Refresh legend if needed? No, just names.
        ChartHandler.updateChartTranslations(translations, langCode);
        ui.languageSelector.value = langCode;
        updateConnectionUI();
        updateSensorInputs(); // Re-render inputs to update labels
    }
}

function setupEventListeners() {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    ui.languageSelector.addEventListener('change', (e) => changeLanguage(e.target.value));
    ui.connectBtn.addEventListener('click', toggleConnection);
    ui.deviceTypeSelect.addEventListener('change', updateConnectionUI);
    ui.sensorCountInput.addEventListener('input', updateSensorInputs);
    ui.startBtn.addEventListener('click', startLogging);
    ui.pauseBtn.addEventListener('click', togglePause);
    ui.stopBtn.addEventListener('click', stopLogging);

    // Chart Export
    const btnExportChart = document.getElementById('btnExportChart');
    if (btnExportChart) {
        btnExportChart.addEventListener('click', () => ChartHandler.exportChartImage());
    }

    // CSV Import
    const csvFileInput = document.getElementById('csvFileInput');
    const btnImportCSV = document.getElementById('btnImportCSV');
    if (btnImportCSV && csvFileInput) {
        btnImportCSV.addEventListener('click', () => csvFileInput.click());
        csvFileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                importCSV(e.target.files[0]);
                e.target.value = ''; // Reset for re-import
            }
        });
    }

    // CSV Export
    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', () => {
            if (csvData.length > 1) {
                downloadCSV(csvData, sensorNames);
            } else {
                showToast(translate('noDataToExport') || '저장할 데이터가 없습니다.', 'warn');
            }
        });
    }

    // Zoom Buttons
    document.querySelectorAll('.chart-controls button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const zoom = e.target.getAttribute('data-zoom');
            ChartHandler.setZoomLevel(zoom);

            // Update active state
            document.querySelectorAll('.chart-controls button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

    // 4-3: Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if user is typing in an input/textarea/select
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        // Space: toggle pause (only when logging)
        if (e.code === 'Space' && isLogging) {
            e.preventDefault();
            togglePause();
        }
        // Ctrl+S: start logging
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            startLogging();
        }
        // Ctrl+Q: stop logging
        if (e.ctrlKey && e.key === 'q') {
            e.preventDefault();
            stopLogging();
        }
        // Ctrl+E: export CSV
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            if (csvData.length > 1) downloadCSV(csvData, sensorNames);
        }
    });

    // 4-4: Individual Y-Axis checkbox
    if (ui.individualYAxisCheckbox) {
        ui.individualYAxisCheckbox.addEventListener('change', (e) => {
            ChartHandler.setIndividualYAxis(e.target.checked);
        });
    }

    // 4-5: Y-Axis Range inputs
    const handleYAxisRange = () => {
        const minVal = ui.yAxisMinInput.value;
        const maxVal = ui.yAxisMaxInput.value;
        ChartHandler.setYAxisRange(minVal, maxVal);
    };
    if (ui.yAxisMinInput) ui.yAxisMinInput.addEventListener('change', handleYAxisRange);
    if (ui.yAxisMaxInput) ui.yAxisMaxInput.addEventListener('change', handleYAxisRange);

    // 4-8: Data Log Search
    if (ui.logSearchInput) {
        ui.logSearchInput.addEventListener('input', (e) => {
            filterLogLines(e.target.value.trim());
        });
    }

    // 5-1: Send Command Button
    const btnSendCommand = document.getElementById('btnSendCommand');
    const sendCommandInput = document.getElementById('sendCommandInput');
    if (btnSendCommand && sendCommandInput) {
        btnSendCommand.addEventListener('click', async () => {
            const cmd = sendCommandInput.value;
            if (!cmd) return;
            if (Serial.isSerialConnected()) {
                await sendSerial(cmd);
            } else if (BLE.isBleConnected()) {
                await sendBLE(cmd);
            }
            logMessage('logSentCommand', { command: cmd });
            sendCommandInput.value = '';
        });
    }
}

function updateConnectionUI() {
    const deviceType = ui.deviceTypeSelect.value;

    // Show settings for the selected device type
    if (deviceType === 'serial') {
        ui.serialSettingsDiv.style.display = 'block';
        ui.bleSettingsDiv.style.display = 'none';
    } else {
        ui.serialSettingsDiv.style.display = 'none';
        ui.bleSettingsDiv.style.display = 'block';
    }

    // Update button based on selected type's connection status
    const selectedConnected = (deviceType === 'serial') ? Serial.isSerialConnected() : BLE.isBleConnected();
    if (selectedConnected) {
        ui.connectBtn.textContent = translate('disconnect') || 'Disconnect';
        ui.connectBtn.className = 'btn btn-disconnect';
    } else {
        const key = deviceType === 'serial' ? 'connectSerial' : 'connectBLE';
        ui.connectBtn.setAttribute('data-translate', key);
        ui.connectBtn.textContent = translate(key);
        ui.connectBtn.className = 'btn btn-connect';
    }
}

// --- Connection Handlers ---
function updateStatusLed(state) {
    if (!ui.statusLed) return;
    ui.statusLed.className = 'status-led ' + state;
}

function startSampleRateTracking() {
    dataPointCount = 0;
    totalDataPointsFor30s = 0;
    if (sampleRateInterval) clearInterval(sampleRateInterval);
    sampleRateInterval = setInterval(() => {
        if (ui.sampleRateSpan) {
            ui.sampleRateSpan.textContent = dataPointCount > 0 ? `${dataPointCount} pts/s` : '';
        }
        totalDataPointsFor30s += dataPointCount;
        dataPointCount = 0;
    }, 1000);

    // Log average sample rate every 30 seconds
    if (sampleRateLogInterval) clearInterval(sampleRateLogInterval);
    sampleRateLogInterval = setInterval(() => {
        const avgRate = (totalDataPointsFor30s / 30).toFixed(1);
        logMessage('logSampleRate30s', { rate: avgRate });
        totalDataPointsFor30s = 0;
    }, 30000);
}

function stopSampleRateTracking() {
    if (sampleRateInterval) { clearInterval(sampleRateInterval); sampleRateInterval = null; }
    if (sampleRateLogInterval) { clearInterval(sampleRateLogInterval); sampleRateLogInterval = null; }
    if (ui.sampleRateSpan) ui.sampleRateSpan.textContent = '';
    dataPointCount = 0;
    totalDataPointsFor30s = 0;
}

async function toggleConnection() {
    const type = ui.deviceTypeSelect.value;

    if (type === 'serial') {
        // Toggle only serial connection
        if (Serial.isSerialConnected()) {
            await Serial.disconnectSerial();
            if (!BLE.isBleConnected()) {
                ui.connectBtn.className = 'btn btn-connect';
                updateStatusLed('disconnected');
                stopSampleRateTracking();
            }
            updateConnectionUI();
        } else {
            updateStatusLed('connecting');
            try {
                await Serial.connectSerial(ui.baudRateSelect.value, processDataLine, onDisconnected);
                ui.connectBtn.textContent = translate('disconnect') || 'Disconnect';
                ui.connectBtn.className = 'btn btn-disconnect';
                updateStatusLed('connected');
                if (!sampleRateInterval) startSampleRateTracking();
            } catch (e) {
                if (!BLE.isBleConnected()) updateStatusLed('disconnected');
            }
        }
    } else {
        // Toggle only BLE connection
        if (BLE.isBleConnected()) {
            await BLE.disconnectBLE();
            if (!Serial.isSerialConnected()) {
                ui.connectBtn.className = 'btn btn-connect';
                updateStatusLed('disconnected');
                stopSampleRateTracking();
            }
            updateConnectionUI();
        } else {
            updateStatusLed('connecting');
            try {
                const bleCustomService = document.getElementById('bleCustomService');
                const bleCustomRx = document.getElementById('bleCustomRx');
                const customUUIDs = {};
                if (bleCustomService && bleCustomService.value.trim()) customUUIDs.service = bleCustomService.value.trim();
                if (bleCustomRx && bleCustomRx.value.trim()) customUUIDs.rx = bleCustomRx.value.trim();
                const hasCustom = Object.keys(customUUIDs).length > 0 ? customUUIDs : undefined;
                await BLE.connectBLE(ui.bleDeviceTypeSelect.value, processDataLine, onDisconnected, hasCustom);
                ui.connectBtn.textContent = translate('disconnect') || 'Disconnect';
                ui.connectBtn.className = 'btn btn-disconnect';
                updateStatusLed('connected');
                if (!sampleRateInterval) startSampleRateTracking();
            } catch (e) {
                if (!Serial.isSerialConnected()) updateStatusLed('disconnected');
            }
        }
    }
}

function onDisconnected() {
    // Only fully disconnect UI if no other connection remains
    if (!Serial.isSerialConnected() && !BLE.isBleConnected()) {
        if (isLogging) stopLogging();
        ui.connectBtn.className = 'btn btn-connect';
        updateStatusLed('disconnected');
        stopSampleRateTracking();
    }
    updateConnectionUI();
}

// --- Data Processing ---
function processDataLine(line) {
    const currentTime = new Date();
    const highResTime = performance.now();
    // Locale-aware time for log display
    const logTime = currentTime.toLocaleTimeString(getLanguage(), { hour12: false }) + '.' + currentTime.getMilliseconds().toString().padStart(3, '0');
    logDataMessage(`[${logTime}] ${line}`);

    // Fixed format time for CSV (always HH:MM:SS.mmm, no locale text)
    const hh = String(currentTime.getHours()).padStart(2, '0');
    const mm = String(currentTime.getMinutes()).padStart(2, '0');
    const ss = String(currentTime.getSeconds()).padStart(2, '0');
    const ms = String(currentTime.getMilliseconds()).padStart(3, '0');
    const timeWithMs = `${hh}:${mm}:${ss}.${ms}`;

    if (!isLogging || isPaused) return;

    let dataPart = line.trim();
    const upperLine = dataPart.toUpperCase();

    // Get selected delimiter
    const delimiterRaw = ui.delimiterSelect ? ui.delimiterSelect.value : ',';
    const delimiter = delimiterRaw === '\\t' ? '\t' : delimiterRaw;

    // Support MCU timestamp prefix: TIMESTAMP,millis,value1,value2,...
    let mcuTimestamp = null;
    if (upperLine.startsWith('TIMESTAMP,') || upperLine.startsWith('TIMESTAMP' + delimiter)) {
        const parts = dataPart.substring(10).split(delimiter);
        mcuTimestamp = parseFloat(parts[0]);
        dataPart = parts.slice(1).join(delimiter);
    } else if (upperLine.startsWith('DATA,') || upperLine.startsWith('DATA' + delimiter)) {
        dataPart = dataPart.substring(5);
    }

    try {
        const values = dataPart.split(delimiter).map(v => parseFloat(v.trim()));

        // Data validation: reject NaN, Infinity, -Infinity
        if (values.some(v => isNaN(v) || !isFinite(v))) {
            return logMessage('logDataWarning', { line });
        }

        // Track sample rate and update LED
        dataPointCount++;
        updateStatusLed('receiving');

        // Auto-detect sensor count from first valid data line
        if (!sensorAutoDetected && values.length > 0) {
            const currentCount = parseInt(ui.sensorCountInput.value, 10) || 0;
            if (values.length !== currentCount) {
                ui.sensorCountInput.value = values.length;
                updateSensorInputs(true); // Force update even during logging
                logMessage('logSensorAutoDetected', { count: values.length });
            }
            sensorAutoDetected = true;
        }

        // Warn if value count doesn't match expected sensor count
        const expectedCount = sensorNames.length;
        if (values.length !== expectedCount) {
            logMessage('logSensorCountMismatch', { expected: expectedCount, received: values.length });
        }

        // Use MCU timestamp if available, otherwise high-res browser time
        const timeForChart = mcuTimestamp !== null ? { mcuMs: mcuTimestamp } : currentTime;
        ChartHandler.addDataPoint(values, timeForChart);

        // Check alarms
        checkAlarms(values, sensorNames);

        // CSV includes both elapsed seconds and absolute time
        const elapsedSec = mcuTimestamp !== null
            ? (mcuTimestamp / 1000).toFixed(3)
            : ((highResTime - perfTimeOrigin) / 1000).toFixed(3);
        // Fixed date format for CSV: YYYY-MM-DD
        const csvDate = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')}`;
        csvData.push([csvDate, timeWithMs, elapsedSec, ...values]);

        // Auto chunk export when CSV data exceeds limit
        if (csvData.length >= MAX_CSV_ROWS) {
            csvChunkIndex++;
            downloadCSV(csvData, sensorNames, csvChunkIndex);
            logMessage('logCsvChunkSaved', { chunk: csvChunkIndex });
            csvData = [[translate('csvDate') || 'Date', translate('csvTime') || 'Time', translate('csvElapsed') || 'Elapsed(s)', ...sensorNames]];
        }
    } catch (error) {
        logMessage('logDataError', { line, error: error.message });
    }
}

// --- Logging Control ---
function startLogging() {
    if (!Serial.isSerialConnected() && !BLE.isBleConnected()) return showToast(translate('alertConnectFirst') || 'Please connect to a device first.', 'warn');

    isLogging = true;
    isPaused = false;

    csvData = [[translate('csvDate') || 'Date', translate('csvTime') || 'Time', translate('csvElapsed') || 'Elapsed(s)', ...sensorNames]];
    csvChunkIndex = 0;
    sensorAutoDetected = false;
    perfTimeOrigin = performance.now();
    ChartHandler.resetChart();
    resetCalculusButtons();

    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    function animate() {
        ChartHandler.renderLoop();
        if (isLogging) animationFrameId = requestAnimationFrame(animate);
    }
    animate();

    ui.startBtn.disabled = true;
    ui.pauseBtn.disabled = false;
    ui.pauseBtn.textContent = translate('pause') || 'Pause';
    ui.stopBtn.disabled = false;
    ui.sensorCountInput.disabled = true;
    logMessage('logStart');

    // Auto-save session every 5 seconds
    if (sessionSaveInterval) clearInterval(sessionSaveInterval);
    sessionSaveInterval = setInterval(() => {
        if (isLogging && csvData.length > 1) {
            saveSession({ csvData, sensorNames, startedAt: Date.now() });
        }
    }, 5000);
}

function togglePause() {
    isPaused = !isPaused;
    ui.pauseBtn.textContent = isPaused ? (translate('resume') || 'Resume') : (translate('pause') || 'Pause');
    logMessage(isPaused ? 'logPause' : 'logResume');
}

function stopLogging() {
    isLogging = false;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;

    // Flush all pending buffers before stopping
    ChartHandler.forceFlushData();
    flushLogBuffer();

    ui.startBtn.disabled = false;
    ui.pauseBtn.disabled = true;
    ui.pauseBtn.textContent = translate('pause') || 'Pause';
    ui.stopBtn.disabled = true;
    ui.sensorCountInput.disabled = false;
    logMessage('logStop');

    if (sessionSaveInterval) { clearInterval(sessionSaveInterval); sessionSaveInterval = null; }
    clearSession();

    if (csvData.length > 1) downloadCSV(csvData, sensorNames);
}

// --- CSV Import ---
function importCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return logMessage('logImportEmpty');

        // Parse header
        const header = lines[0].split(',').map(h => h.trim());
        // Detect sensor columns: skip Date, Time, Elapsed(s) if present
        let dataStartCol = 0;
        const importedNames = [];
        for (let i = 0; i < header.length; i++) {
            const h = header[i].toLowerCase();
            if (h === 'date' || h === 'time' || h.startsWith('elapsed')) {
                dataStartCol = i + 1;
            } else {
                importedNames.push(header[i]);
            }
        }

        if (importedNames.length === 0) {
            // No header detected — treat all columns as data
            dataStartCol = 0;
            const firstRow = lines[1].split(',');
            for (let i = 0; i < firstRow.length; i++) {
                importedNames.push(`Sensor ${i + 1}`);
            }
        }

        // Update sensor settings
        ui.sensorCountInput.value = importedNames.length;
        sensorNames = importedNames;
        updateSensorInputs();

        // Reset chart and load data
        ChartHandler.resetChart();
        resetCalculusButtons();

        let pointCount = 0;
        for (let row = 1; row < lines.length; row++) {
            const cols = lines[row].split(',').map(c => c.trim());
            const values = cols.slice(dataStartCol).map(v => parseFloat(v));
            if (values.some(v => isNaN(v) || !isFinite(v))) continue;

            // Use row index as elapsed time if no elapsed column
            const elapsed = dataStartCol >= 3 ? parseFloat(cols[2]) : (row - 1) * 0.1;
            const fakeTime = new Date(Date.now() + elapsed * 1000);
            ChartHandler.addDataPoint(values, fakeTime);
            pointCount++;
        }

        ChartHandler.forceFlushData();
        logMessage('logImportSuccess', { count: pointCount, sensors: importedNames.length });
    };
    reader.readAsText(file);
}

// --- Sensor Settings ---
function updateSensorInputs(forceUpdate = false) {
    // Prevent manual sensor count changes during logging (but allow auto-detect)
    if (isLogging && !forceUpdate) {
        showToast(translate('alertCannotChangeSensorCount') || 'Cannot change sensor count during logging.', 'warn');
        ui.sensorCountInput.value = sensorNames.length;
        return;
    }

    const count = parseInt(ui.sensorCountInput.value, 10) || 0;
    ui.sensorInputsContainer.innerHTML = '';

    const newSensorNames = [];
    const sensorLabel = translate('sensorDefaultName') || 'Sensor';
    const alarmMinLabel = translate('alarmMin') || 'Min';
    const alarmMaxLabel = translate('alarmMax') || 'Max';

    // Alarm inputs container
    const alarmInputsContainer = document.getElementById('alarmInputs');
    if (alarmInputsContainer) alarmInputsContainer.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const defaultName = sensorNames[i] || `${sensorLabel} ${i + 1}`;
        newSensorNames.push(defaultName);

        const inputGroup = document.createElement('div');
        inputGroup.className = 'sensor-input-group';
        inputGroup.innerHTML = `<label>${sensorLabel} ${i + 1}:</label><input type="text" value="${defaultName}">`;

        inputGroup.querySelector('input').addEventListener('input', (e) => {
            sensorNames[i] = e.target.value.trim() || `${sensorLabel} ${i + 1}`;
            ChartHandler.updateChartDatasets(sensorNames);
        });
        ui.sensorInputsContainer.appendChild(inputGroup);

        // Create alarm min/max inputs
        if (alarmInputsContainer) {
            const alarmGroup = document.createElement('div');
            alarmGroup.className = 'sensor-input-group';
            alarmGroup.style.display = 'flex';
            alarmGroup.style.gap = '4px';
            alarmGroup.style.alignItems = 'center';
            alarmGroup.style.marginBottom = '4px';
            alarmGroup.innerHTML = `
                <label style="min-width: 60px; font-size: 0.8rem;">${sensorLabel} ${i + 1}:</label>
                <input type="number" placeholder="${alarmMinLabel}" style="width: 60px; font-size: 0.8rem;" data-alarm-min="${i}">
                <input type="number" placeholder="${alarmMaxLabel}" style="width: 60px; font-size: 0.8rem;" data-alarm-max="${i}">
            `;

            const minInput = alarmGroup.querySelector(`[data-alarm-min="${i}"]`);
            const maxInput = alarmGroup.querySelector(`[data-alarm-max="${i}"]`);

            const updateAlarm = () => {
                setAlarm(i, minInput.value, maxInput.value);
            };
            minInput.addEventListener('change', updateAlarm);
            maxInput.addEventListener('change', updateAlarm);

            alarmInputsContainer.appendChild(alarmGroup);
        }
    }
    sensorNames = newSensorNames;
    ChartHandler.updateChartDatasets(sensorNames);
}
