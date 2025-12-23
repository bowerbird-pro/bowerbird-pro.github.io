import { logMessage, requestWakeLock } from '../utils/helpers.js';
import { translate } from '../utils/i18n.js';

let bleDevice;
let bleCharacteristic;
const BLE_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_CHAR_UUID_RECEIVE = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const bleDecoder = new TextDecoder('utf-8');
let blePartialLine = '';

export async function connectBLE(deviceType, onDataCallback, onDisconnectCallback) {
    if (!('bluetooth' in navigator)) return alert(translate('alertNoWebBluetooth') || 'Web Bluetooth API is not supported.');

    const opts = deviceType === 'microbit'
        ? { filters: [{ namePrefix: "BBC micro:bit" }], optionalServices: [BLE_SERVICE_UUID] }
        : { filters: [{ services: [BLE_SERVICE_UUID] }] };

    try {
        logMessage('logBleScanning');
        bleDevice = await navigator.bluetooth.requestDevice(opts);
        logMessage('logBleDeviceSelected', { name: bleDevice.name || bleDevice.id });

        bleDevice.addEventListener('gattserverdisconnected', () => {
            onBLEDisconnected(onDisconnectCallback);
        });

        const server = await bleDevice.gatt.connect();
        await requestWakeLock();

        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        bleCharacteristic = await service.getCharacteristic(BLE_CHAR_UUID_RECEIVE);

        await bleCharacteristic.startNotifications();

        // Define listener wrapper to pass to addEventListener
        const notificationHandler = (event) => handleBleNotification(event, onDataCallback);
        bleCharacteristic.addEventListener('characteristicvaluechanged', notificationHandler);

        // Store handler reference to remove it later if needed? 
        // Ideally we attach it to the object or closure. 
        // For simplicity, we assume one connection at a time.
        bleCharacteristic._notificationHandler = notificationHandler;

        logMessage('logBleConnected');
        return bleDevice;
    } catch (error) {
        logMessage('logBleFailed', { error: error.message });
        if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
        else onBLEDisconnected(onDisconnectCallback);
        throw error;
    }
}

export async function disconnectBLE() {
    logMessage('logBleDisconnecting');
    if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
    else logMessage('logBleAlreadyDisconnected');
}

function onBLEDisconnected(callback) {
    logMessage('logBleDisconnected');
    if (bleCharacteristic && bleCharacteristic._notificationHandler) {
        bleCharacteristic.removeEventListener('characteristicvaluechanged', bleCharacteristic._notificationHandler);
    }
    bleCharacteristic = null;
    bleDevice = null;
    if (callback) callback();
}

function handleBleNotification(event, callback) {
    const value = event.target.value;
    blePartialLine += bleDecoder.decode(value, { stream: true });
    const lines = blePartialLine.split('\n');
    blePartialLine = lines.pop() || '';
    lines.forEach(line => {
        if (line.trim()) callback(line.trim());
    });
}

export function isBleConnected() {
    return bleDevice && bleDevice.gatt.connected;
}
