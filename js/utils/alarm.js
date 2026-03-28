import { showToast } from './helpers.js';
import { translate } from './i18n.js';

// Store alarms per sensor: { sensorIndex: { min: number|null, max: number|null, triggered: boolean } }
const alarms = new Map();
let alarmLog = [];

export function setAlarm(sensorIndex, min, max) {
    alarms.set(sensorIndex, { min: min !== '' ? parseFloat(min) : null, max: max !== '' ? parseFloat(max) : null, triggered: false });
}

export function removeAlarm(sensorIndex) {
    alarms.delete(sensorIndex);
}

export function clearAllAlarms() {
    alarms.clear();
    alarmLog = [];
}

export function checkAlarms(values, sensorNames) {
    values.forEach((value, i) => {
        const alarm = alarms.get(i);
        if (!alarm) return;

        const sensorName = sensorNames[i] || `Sensor ${i + 1}`;
        let violated = false;
        let msg = '';

        if (alarm.min !== null && value < alarm.min) {
            violated = true;
            msg = `${sensorName}: ${value.toFixed(2)} < ${alarm.min} (min)`;
        }
        if (alarm.max !== null && value > alarm.max) {
            violated = true;
            msg = `${sensorName}: ${value.toFixed(2)} > ${alarm.max} (max)`;
        }

        if (violated && !alarm.triggered) {
            alarm.triggered = true;
            showToast(`\u26A0 ${msg}`, 'error', 5000);
            alarmLog.push({ time: new Date().toLocaleTimeString(), message: msg });

            // Browser notification if permitted
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Bowerbird PRO Alert', { body: msg });
            }
        }

        if (!violated) {
            alarm.triggered = false; // Reset trigger when back in range
        }
    });
}

export function getAlarmLog() {
    return alarmLog;
}

export function getAlarms() {
    return alarms;
}
