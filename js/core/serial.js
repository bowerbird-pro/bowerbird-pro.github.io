import { logMessage, requestWakeLock } from '../utils/helpers.js';
import { translate } from '../utils/i18n.js';

let serialPort;
let serialReader;
let keepReading = false;

export async function connectSerial(baudRate, onDataCallback, onDisconnect) {
    if (!('serial' in navigator)) return alert(translate('alertNoWebSerial') || 'Web Serial API is not supported.');
    try {
        logMessage('logSerialConnecting');
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: parseInt(baudRate, 10) });

        logMessage('logSerialConnected');
        await requestWakeLock();

        keepReading = true;
        readFromSerial(onDataCallback);

        // Listen for disconnect? Web Serial doesn't have a simple 'disconnect' event on the port object itself in the same way, 
        // but 'disconnect' event exists on navigator.serial. 
        // For simplicity, we rely on the manual disconnect or error handling.

        return serialPort;
    } catch (error) {
        if (error.name !== 'NotFoundError') logMessage('logConnectionFailed', { error: error.message });
        throw error;
    }
}

export async function disconnectSerial() {
    keepReading = false;
    if (serialReader) {
        try { await serialReader.cancel(); } catch (e) { }
        serialReader.releaseLock();
        serialReader = null;
    }
    if (serialPort) {
        try { await serialPort.close(); } catch (e) { }
        serialPort = null;
    }
    logMessage('logSerialDisconnected');
}

async function readFromSerial(onDataCallback) {
    if (!serialPort || !serialPort.readable) return;
    const decoder = new TextDecoder('utf-8');
    let partialLine = '';
    serialReader = serialPort.readable.getReader();
    try {
        while (keepReading) {
            const { value, done } = await serialReader.read();
            if (done) break;
            partialLine += decoder.decode(value, { stream: true });
            const lines = partialLine.split('\n');
            partialLine = lines.pop() || '';
            lines.forEach(line => {
                if (line.trim()) onDataCallback(line.trim());
            });
        }
    } catch (error) {
        logMessage('logReadError', { error: error.message });
    } finally {
        if (serialReader) serialReader.releaseLock();
    }
}

export function isSerialConnected() {
    return !!serialPort;
}
