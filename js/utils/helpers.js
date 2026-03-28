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

export function downloadCSV(csvData, sensorNames, chunkIndex = 0) {
    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const chunkSuffix = chunkIndex > 0 ? `_part${chunkIndex}` : '';
    const filename = `Bowerbird_PRO_datalog_${dateStr}_${timeStr}${chunkSuffix}.csv`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
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

    // Append buffered messages as individual divs for search filtering
    const fragment = document.createDocumentFragment();
    logBuffer.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.textContent = msg;
        fragment.appendChild(div);
    });
    log.appendChild(fragment);
    logBuffer = []; // Clear buffer

    // Apply search filter if active
    const searchInput = document.getElementById('logSearch');
    if (searchInput && searchInput.value.trim()) {
        filterLogLines(searchInput.value.trim());
    }

    // Trim log if too many lines
    const lines = log.querySelectorAll('.log-line');
    if (lines.length > 500) {
        const toRemove = lines.length - 400;
        for (let i = 0; i < toRemove; i++) {
            lines[i].remove();
        }
    }
    log.scrollTop = log.scrollHeight;
}

export function filterLogLines(searchText) {
    const log = document.getElementById('dataLog');
    if (!log) return;
    const lines = log.querySelectorAll('.log-line');
    const lowerSearch = searchText.toLowerCase();
    lines.forEach(line => {
        if (!searchText) {
            line.style.display = '';
        } else {
            line.style.display = line.textContent.toLowerCase().includes(lowerSearch) ? '' : 'none';
        }
    });
}

export function releaseWakeLock() {
    if (wakeLockSentinel) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
    }
}

// --- IndexedDB Session Storage ---
const DB_NAME = 'BowerbirdPRO';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveSession(sessionData) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ id: 'current', ...sessionData, savedAt: Date.now() });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
        db.close();
    } catch (e) {
        // Silently fail — session save is best-effort
    }
}

export async function loadSession() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get('current');
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                db.close();
                resolve(request.result || null);
            };
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
        });
    } catch (e) {
        return null;
    }
}

export function showToast(message, type = 'info', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-hide');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

export async function clearSession() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete('current');
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
        db.close();
    } catch (e) {
        // Silently fail
    }
}
