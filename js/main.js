import { loadLanguage, languages, translate, updatePageText, getLanguage } from './utils/i18n.js';
import { logMessage, logDataMessage, downloadCSV, handleVisibilityChange, flushLogBuffer } from './utils/helpers.js';
import * as ChartHandler from './visualization/chart-handler.js';
import * as Serial from './core/serial.js';
import * as BLE from './core/ble.js';
import { initAnalysisUI, resetCalculusButtons } from './analysis/analysis-ui.js';

// --- State ---
let isLogging = false;
let isPaused = false;
let csvData = [];
let sensorNames = [];
let animationFrameId = null;

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
    baudRateSelect: document.getElementById('baudRate')
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
}

function updateConnectionUI() {
    const deviceType = ui.deviceTypeSelect.value;
    const isConnected = Serial.isSerialConnected() || BLE.isBleConnected();

    if (isConnected) return;

    if (deviceType === 'serial') {
        ui.serialSettingsDiv.style.display = 'block';
        ui.bleSettingsDiv.style.display = 'none';
        ui.connectBtn.setAttribute('data-translate', 'connectSerial');
    } else {
        ui.serialSettingsDiv.style.display = 'none';
        ui.bleSettingsDiv.style.display = 'block';
        ui.connectBtn.setAttribute('data-translate', 'connectBLE');
    }
    const key = ui.connectBtn.getAttribute('data-translate');
    ui.connectBtn.textContent = translate(key);
}

// --- Connection Handlers ---
async function toggleConnection() {
    const isConnected = Serial.isSerialConnected() || BLE.isBleConnected();
    if (isConnected) {
        if (Serial.isSerialConnected()) await Serial.disconnectSerial();
        if (BLE.isBleConnected()) await BLE.disconnectBLE();

        ui.connectBtn.className = 'btn btn-connect';
        updateConnectionUI();
    } else {
        const type = ui.deviceTypeSelect.value;
        try {
            if (type === 'serial') {
                await Serial.connectSerial(ui.baudRateSelect.value, processDataLine, onDisconnected);
            } else {
                await BLE.connectBLE(ui.bleDeviceTypeSelect.value, processDataLine, onDisconnected);
            }
            ui.connectBtn.textContent = translate('disconnect') || 'Disconnect';
            ui.connectBtn.className = 'btn btn-disconnect';
        } catch (e) {
            // Error handled in modules
        }
    }
}

function onDisconnected() {
    if (isLogging) stopLogging();
    ui.connectBtn.className = 'btn btn-connect';
    updateConnectionUI();
}

// --- Data Processing ---
function processDataLine(line) {
    const currentTime = new Date();
    const timeWithMs = currentTime.toLocaleTimeString(getLanguage(), { hour12: false }) + '.' + currentTime.getMilliseconds().toString().padStart(3, '0');
    logDataMessage(`[${timeWithMs}] ${line}`);

    if (!isLogging || isPaused) return;

    let dataPart = line.trim().toUpperCase().startsWith('DATA,') ? line.trim().substring(5) : line.trim();

    try {
        const values = dataPart.split(',').map(v => parseFloat(v.trim()));
        if (values.some(isNaN)) return logMessage('logDataWarning', { line });

        ChartHandler.addDataPoint(values, currentTime);
        csvData.push([currentTime.toLocaleDateString(getLanguage()), timeWithMs, ...values]);
    } catch (error) {
        logMessage('logDataError', { line, error: error.message });
    }
}

// --- Logging Control ---
function startLogging() {
    if (!Serial.isSerialConnected() && !BLE.isBleConnected()) return alert(translate('alertConnectFirst') || 'Please connect to a device first.');

    isLogging = true;
    isPaused = false;

    csvData = [[translate('csvDate') || 'Date', translate('csvTime') || 'Time', ...sensorNames]];
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
    logMessage('logStart');
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
    logMessage('logStop');

    if (csvData.length > 1) downloadCSV(csvData, sensorNames);
}

// --- Sensor Settings ---
function updateSensorInputs() {
    const count = parseInt(ui.sensorCountInput.value, 10) || 0;
    ui.sensorInputsContainer.innerHTML = '';

    const newSensorNames = [];
    const sensorLabel = translate('sensorDefaultName') || 'Sensor';

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
    }
    sensorNames = newSensorNames;
    ChartHandler.updateChartDatasets(sensorNames);
}
