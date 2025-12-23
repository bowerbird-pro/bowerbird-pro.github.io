import { logMessage } from '../utils/helpers.js';

let chart;
const MAX_VIEW_SECONDS = 60;
let chartStartTime = null;
let chartMode = 'EXPANDING';
const sensorColors = ['#E6194B', '#4363d8', '#FFD700', '#3cb44b', '#911eb4', '#f58231', '#46f0f0', '#f032e6', '#000075', '#bfef45'];
let currentLang = 'ko';

export function initializeChart(canvasId) {
    if (typeof Chart === 'undefined') {
        logMessage('logChartJsError');
        return null;
    }
    const ctx = document.getElementById(canvasId).getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        drag: { enabled: true, backgroundColor: 'rgba(54, 162, 235, 0.2)' }, // Enable selecting a region
                        mode: 'x',
                        onZoomComplete: ({ chart }) => {
                            if (window.onChartUpdate) window.onChartUpdate();
                        }
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPanComplete: ({ chart }) => {
                            if (window.onChartUpdate) window.onChartUpdate();
                        }
                    }
                },
                legend: { display: true, position: 'top', align: 'end' }
            },
            scales: {
                x: { type: 'linear', title: { display: true, text: '시간', color: '#555' }, ticks: { color: '#555', maxTicksLimit: 10 } },
                y: { title: { display: true, text: '값', color: '#555' }, ticks: { color: '#555' } },
                y1: {
                    type: 'linear',
                    display: false,
                    position: 'right',
                    title: { display: true, text: '처리된 값', color: '#555' },
                    ticks: { color: '#555' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
    logMessage('logChartInit');
    return chart;
}

export function updateChartTranslations(translations, lang) {
    if (lang) currentLang = lang;
    if (chart && translations.chartTimeAxis && translations.chartValueAxis) {
        chart.options.scales.x.title.text = translations.chartTimeAxis;
        chart.options.scales.y.title.text = translations.chartValueAxis;
        chart.update('none');
    }
}

export function updateChartDatasets(sensorNames) {
    if (!chart) return;

    // Store existing trendlines to re-add them after update or keeping them safe
    const trendlines = chart.data.datasets.filter(d => d.isTrendline);

    // Re-build sensor datasets
    // We want to ensure sensor datasets are at indices 0 to N-1
    sensorNames.forEach((name, i) => {
        // Find if this sensor dataset already exists (by index, assuming order matches)
        // We need to distinguish between sensor datasets and trendlines.
        // Let's assume non-trendline datasets are sensors.
        let sensorDataset = chart.data.datasets.find((d, idx) => !d.isTrendline && idx === i);

        if (sensorDataset) {
            sensorDataset.label = name;
        } else {
            // It might be that the slot is taken by a trendline if we are not careful, 
            // but we filter trendlines separately.
            chart.data.datasets[i] = {
                label: name,
                data: [],
                borderColor: sensorColors[i % sensorColors.length],
                tension: 0.1,
                pointRadius: 1,
                borderWidth: 1,
                isTrendline: false
            };
        }
    });

    // Remove any extra sensor datasets (if sensor count decreased)
    // We count how many non-trendline datasets we have.
    const currentSensorDatasets = chart.data.datasets.filter(d => !d.isTrendline);
    if (currentSensorDatasets.length > sensorNames.length) {
        // We need to remove the extras. 
        // This is tricky because indices are mixed.
        // Easiest way: Re-construct the datasets array.

        const newDatasets = [];
        sensorNames.forEach((name, i) => {
            let existing = chart.data.datasets.find(d => !d.isTrendline && d.label === name)
                || chart.data.datasets.find((d, idx) => !d.isTrendline && idx === i);

            if (!existing) {
                existing = {
                    label: name, data: [], borderColor: sensorColors[i % sensorColors.length],
                    tension: 0.1, pointRadius: 1, borderWidth: 1, isTrendline: false
                };
            } else {
                existing.label = name; // Update label just in case
            }
            newDatasets.push(existing);
        });

        // Add back trendlines
        // We should double check if the trendlines still correspond to valid sensors.
        // trendline.linkedSensorLabel could be used? For now, keep them if they exist.
        newDatasets.push(...trendlines);

        chart.data.datasets = newDatasets;
    } else {
        // If we didn't destroy the array, we just need to ensure trendlines are at the end?
        // Actually, just filtering properties is safer.
        // Let's stick to the splice logic but be careful.

        // 1. Identify all trendlines
        const savedTrendlines = chart.data.datasets.filter(d => d.isTrendline);
        // 2. Identify all sensors (truncate if needed)
        let sensors = chart.data.datasets.filter(d => !d.isTrendline);
        if (sensors.length > sensorNames.length) sensors = sensors.slice(0, sensorNames.length);

        // 3. Ensure sensors are initialized
        sensorNames.forEach((name, i) => {
            if (!sensors[i]) {
                sensors[i] = {
                    label: name, data: [], borderColor: sensorColors[i % sensorColors.length],
                    tension: 0.1, pointRadius: 1, borderWidth: 1, isTrendline: false
                };
            } else {
                sensors[i].label = name;
            }
        });

        chart.data.datasets = [...sensors, ...savedTrendlines];
    }

    chart.update();
}

/**
 * Draws a trendline for a specific sensor.
 * @param {Array<{x:number, y:number}>} sourceData - Original data.
 * @param {Function} predictFunc - Prediction function.
 * @param {string} sensorLabel - Label of the sensor this trendline belongs to.
 * @param {string} color - Color for the trendline (usually matching sensor but darker/different).
 */
export function updateTrendline(sourceData, predictFunc, sensorLabel, color) {
    if (!chart || !sourceData || sourceData.length < 2) return;

    const minX = sourceData[0].x;
    const maxX = sourceData[sourceData.length - 1].x;
    const step = (maxX - minX) / 100;

    const trendData = [];
    for (let x = minX; x <= maxX; x += step) {
        trendData.push({ x: x, y: predictFunc(x) });
    }
    trendData.push({ x: maxX, y: predictFunc(maxX) });

    const trendLabel = `${sensorLabel} (Trend)`;
    let trendDataset = chart.data.datasets.find(d => d.isTrendline && d.linkedSensor === sensorLabel);

    if (!trendDataset) {
        trendDataset = {
            label: trendLabel,
            data: trendData,
            borderColor: color || '#000000',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            isTrendline: true,
            linkedSensor: sensorLabel,
            order: -1
        };
        chart.data.datasets.push(trendDataset);
    } else {
        trendDataset.data = trendData;
        trendDataset.borderColor = color || trendDataset.borderColor;
    }
    chart.update('none');
}

/**
 * Adds a processed dataset (Derivative, Integral, etc.) to the chart.
 * @param {Array<{x:number, y:number}>} data 
 * @param {string} label 
 * @param {string} color 
 * @param {boolean} useSecondaryAxis 
 */
export function addProcessedDataset(data, label, color, useSecondaryAxis = false) {
    if (!chart) return;

    // Check if dataset already exists
    let dataset = chart.data.datasets.find(d => d.label === label);

    // Configuration
    const yAxisID = useSecondaryAxis ? 'y1' : 'y';
    if (useSecondaryAxis) {
        chart.options.scales.y1.display = true;
    }

    if (!dataset) {
        dataset = {
            label: label,
            data: data,
            borderColor: color,
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.4,
            yAxisID: yAxisID,
            isProcessed: true // Marker to identify processed data
        };
        chart.data.datasets.push(dataset);
    } else {
        dataset.data = data;
        dataset.borderColor = color;
        dataset.yAxisID = yAxisID;
    }

    chart.update('none');
}

/**
 * Removes a processed dataset by label.
 * @param {string} label 
 */
export function removeProcessedDataset(label) {
    if (!chart) return;
    const index = chart.data.datasets.findIndex(d => d.label === label);
    if (index !== -1) {
        chart.data.datasets.splice(index, 1);

        // Hide secondary axis if no datasets use it
        const usingSecondary = chart.data.datasets.some(d => d.yAxisID === 'y1');
        if (!usingSecondary) {
            chart.options.scales.y1.display = false;
        }

        chart.update('none');
    }
}

export function removeTrendline(sensorLabel) {
    if (!chart) return;
    const index = chart.data.datasets.findIndex(d => d.isTrendline && d.linkedSensor === sensorLabel);
    if (index !== -1) {
        chart.data.datasets.splice(index, 1);
        chart.update('none');
    }
}

/**
 * Retrieves data points for all visible datasets within the current viewport.
 * @returns {Array<object>} Array of objects per dataset: { label, data: [{x,y}, ...] }
 */
export function getVisibleData() {
    if (!chart) return [];

    const minX = chart.scales.x.min;
    const maxX = chart.scales.x.max;

    return chart.data.datasets.map(dataset => {
        // Find data points within the range
        // Note: dataset.data is sorted by x. Could simplify with binary search if needed, but linear filter is fine for moderate size.
        const visiblePoints = dataset.data.filter(point => point.x >= minX && point.x <= maxX);
        return {
            label: dataset.label,
            data: visiblePoints,
            isProcessed: dataset.isProcessed || false
        };
    });
}

export function resetChart() {
    if (chart && chart.data.datasets) chart.data.datasets.forEach(dataset => dataset.data = []);
    chartStartTime = null;
    chartMode = 'EXPANDING';
    dataPointBuffer = [];
    lastDataFlush = 0;
}

// Batch data point buffer for performance
let dataPointBuffer = [];
let lastDataFlush = 0;
const DATA_FLUSH_INTERVAL = 50; // Flush every 50ms

export function addDataPoint(values, currentTime) {
    if (!chartStartTime) chartStartTime = currentTime;
    const elapsedSeconds = (currentTime - chartStartTime) / 1000;

    // Add to buffer instead of directly to chart
    dataPointBuffer.push({ values, elapsedSeconds });

    // Flush buffer periodically
    const now = Date.now();
    if (now - lastDataFlush > DATA_FLUSH_INTERVAL) {
        flushDataPoints();
        lastDataFlush = now;
    }
}

function flushDataPoints() {
    if (!chart || dataPointBuffer.length === 0) return;

    // Add all buffered points at once
    dataPointBuffer.forEach(({ values, elapsedSeconds }) => {
        values.forEach((value, i) => {
            if (chart.data.datasets[i]) {
                chart.data.datasets[i].data.push({ x: elapsedSeconds, y: value });
            }
        });
    });

    dataPointBuffer = [];
}

// Ensure buffer is flushed when needed
export function forceFlushData() {
    flushDataPoints();
}

export function renderLoop() {
    // Flush any pending data points before rendering
    flushDataPoints();

    if (!chart || !chart.data.datasets.length || !chart.data.datasets[0] || chart.data.datasets[0].data.length < 2) {
        return;
    }
    const firstPoint = chart.data.datasets[0].data[0];
    const lastPoint = chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1];
    const totalDuration = lastPoint.x - firstPoint.x;

    // Auto-switch to SHIFTING if in EXPANDING mode and duration exceeds limit
    if (chartMode === 'EXPANDING' && currentZoomLevel !== 'ALL' && totalDuration > (currentZoomLevel || MAX_VIEW_SECONDS)) {
        chartMode = 'SHIFTING';
    }

    let visibleMin, visibleMax;

    if (currentZoomLevel === 'ALL') {
        visibleMin = firstPoint.x;
        visibleMax = lastPoint.x;
        chart.options.scales.x.min = visibleMin;
        chart.options.scales.x.max = visibleMax;
    } else if (chartMode === 'EXPANDING') {
        chart.options.scales.x.min = firstPoint.x;
        chart.options.scales.x.max = Math.max(lastPoint.x, firstPoint.x + (currentZoomLevel || MAX_VIEW_SECONDS));
    } else {
        // SHIFTING or Manual
        const viewDuration = currentZoomLevel || MAX_VIEW_SECONDS;
        visibleMax = lastPoint.x;
        visibleMin = visibleMax - viewDuration;

        chart.options.scales.x.min = visibleMin;
        chart.options.scales.x.max = visibleMax;

        // Optimization: Remove data points heavily outside of view
        chart.data.datasets.forEach(dataset => {
            while (dataset.data.length > 2 && dataset.data[1].x < visibleMin - viewDuration) {
                dataset.data.shift();
            }
        });
    }
    updateXAxisTicks(chart.options.scales.x.max - chart.options.scales.x.min);
    chart.update('none');
}

let currentZoomLevel = null; // null = Auto (defaults to MAX_VIEW_SECONDS), 'ALL' = all data, Number = seconds

export function setZoomLevel(level) {
    if (level === 'all') {
        currentZoomLevel = 'ALL';
        chartMode = 'SHIFTING'; // Will be handled in renderLoop
    } else if (level === 'auto') {
        currentZoomLevel = null;
        chartMode = 'EXPANDING';
    } else {
        currentZoomLevel = parseInt(level, 10);
        chartMode = 'SHIFTING'; // Force shifting mode for fixed windows
    }
}

function updateXAxisTicks(viewDuration) {
    chart.options.scales.x.ticks.callback = function (value) {
        if (!chartStartTime) return value;
        const date = new Date(chartStartTime.getTime() + value * 1000);
        if (viewDuration <= 10) return date.toLocaleTimeString(currentLang, { minute: '2-digit', second: '2-digit' }) + '.' + date.getMilliseconds().toString().padStart(3, '0').substring(0, 1);
        if (viewDuration <= 120) return date.toLocaleTimeString(currentLang, { minute: '2-digit', second: '2-digit' });
        return date.toLocaleTimeString(currentLang, { hour12: false });
    };
}
