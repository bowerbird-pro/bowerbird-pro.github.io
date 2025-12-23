import { getLanguage, translate } from './i18n.js';

let wakeLockSentinel = null;

export const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
        try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            wakeLockSentinel.addEventListener('release', () => logMessage('logWakeLockReleased'));
            logMessage('logWakeLockAcquired');
        } catch (err) {
            logMessage('logWakeLockFailed', { name: err.name, message: err.message });
        }
    } else {
        logMessage('alertNoWakeLock');
    }
};

export const handleVisibilityChange = async () => {
    if (wakeLockSentinel !== null && document.visibilityState === 'visible') {
        logMessage('logWakeLockReacquired');
        await requestWakeLock();
    }
};

export function downloadCSV(csvData, sensorNames) {
    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const filename = `Bowerbird_PRO_datalog_${dateStr}_${timeStr}.csv`;
    link.download = filename;
    link.click();
    logMessage('logCsvDownloaded', { filename });
}

export function logMessage(key, params = {}) {
    const log = document.getElementById('consoleLog');
    if (!log) return;

    // We import translate but it depends on currentTranslations being set in i18n
    const messageTemplate = translate(key);
    let message = messageTemplate;

    for (const [param, value] of Object.entries(params)) {
        message = message.replace(`{${param}}`, value);
    }

    const timestamp = new Date().toLocaleTimeString(getLanguage(), { hour12: false });

    log.textContent += `[${timestamp}] ${message}\n`;
    log.scrollTop = log.scrollHeight;
    if (log.textContent.split('\n').length > 300) log.textContent = log.textContent.split('\n').slice(-200).join('\n');
}

// Buffered Logging for Performance
let logBuffer = [];
let lastLogUpdate = 0;
const LOG_UPDATE_INTERVAL = 100; // Update DOM every 100ms max

export function logDataMessage(message) {
    logBuffer.push(message);

    const now = Date.now();
    if (now - lastLogUpdate > LOG_UPDATE_INTERVAL) {
        flushLogBuffer();
        lastLogUpdate = now;
    }
}

export function flushLogBuffer() {
    const log = document.getElementById('dataLog');
    if (!log || logBuffer.length === 0) return;

    // Append all buffered messages at once
    log.textContent += logBuffer.join('\n') + '\n';
    logBuffer = []; // Clear buffer

    // Trim log if too long (expensive operation, do sparingly)
    if (log.textContent.length > 50000) { // Check length chars instead of split lines
        const lines = log.textContent.split('\n');
        if (lines.length > 500) {
            log.textContent = lines.slice(-400).join('\n');
        }
    }
    log.scrollTop = log.scrollHeight;
}

export function releaseWakeLock() {
    if (wakeLockSentinel) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
    }
}
