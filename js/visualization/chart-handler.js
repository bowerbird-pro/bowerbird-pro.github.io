import { logMessage } from '../utils/helpers.js';

let chart;
const MAX_VIEW_SECONDS = 60;
const MAX_DATA_POINTS = 100000;
let chartStartTime = null;
let chartMode = 'EXPANDING';
const sensorColors = ['#E6194B', '#4363d8', '#FFD700', '#3cb44b', '#911eb4', '#f58231', '#46f0f0', '#f032e6', '#000075', '#bfef45'];
let currentLang = 'ko';
// Full data store (kept separate from chart display for analysis)
let fullDataStore = [];
let mcuTimeOrigin = null;

// --- 보기 모드 (2026-10-19) ---
// 범위가 크게 다른 센서(자이로 -1~1 · 거리 30~300cm)를 한 Y축에 그리면 작은 쪽이 바닥에 납작하게 붙는다.
// 'split'     : 범위가 비슷한 센서끼리 묶어 위아래 칸으로 나눈다. 시간축은 하나(Vernier·PASCO·MakeCode 방식). 기본값.
// 'overlay'   : 한 Y축에 모두 겹친다(옛 동작). Y min/max 수동 입력은 이 모드에서만 쓴다.
// 'normalize' : 센서마다 숨은 Y축을 두어 보이는 구간의 최소~최대를 0~100% 로 맞춘다(모양·시점 비교). 툴팁은 실제 값.
// 'dual'      : 센서가 정확히 2개일 때만 — 왼쪽·오른쪽 Y축, 축 색 = 선 색.
// 한 캔버스·한 Chart 인스턴스 안에서 Y축만 바꾼다(Chart.js 의 stacked scale) — 확대·드래그 분석·추세선·PNG 저장이 그대로 동작한다.
export const VIEW_MODES = ['split', 'overlay', 'normalize', 'dual'];
let viewMode = 'split';
let panelGroups = null;            // [[센서 index, ...], ...] — 지금 그려지는 칸 묶음
let candidateKey = null;           // 묶음이 바뀔 때 흔들림 방지: 같은 새 묶음이 연속으로 나와야 적용
let candidateHits = 0;
let lastGroupCheck = 0;
const GROUP_CHECK_MS = 1000;
const GROUP_CONFIRM_CHECKS = 2;
const GROUP_MIN_SHARE = 0.1;       // 합친 칸 높이의 10% 미만으로 눌리는 센서는 다른 칸으로 뺀다
const GROUP_MIN_POINTS = 5;
const AUTO_GROUP_MIN_SENSORS = 5;  // 보이는 센서가 이보다 적으면 묶지 않고 센서마다 한 칸(2026-10-19 운영자 확인)
const PANEL_AXIS_PREFIX = 'yp_';
const AXIS_TEXT_COLOR = '#555';
let manualYRange = { min: null, max: null };
let axisLabels = { value: '값', normalized: '0~100%' };

// 5) 공통 시간 커서: 마우스 위치에 세로선을 모든 칸에 걸쳐 긋고, 각 센서 선 위에 점을 찍는다.
const timeCursorPlugin = {
    id: 'timeCursor',
    afterEvent(c, args) {
        const e = args.event;
        const area = c.chartArea;
        if (!area) return;
        const inside = e.x >= area.left && e.x <= area.right && e.y >= area.top && e.y <= area.bottom;
        const next = (e.type === 'mouseout' || !inside) ? null : e.x;
        if (next !== c.$cursorX) {
            c.$cursorX = next;
            args.changed = true;
        }
    },
    afterDatasetsDraw(c) {
        const px = c.$cursorX;
        const xScale = c.scales.x;
        if (px == null || !xScale) return;
        const area = c.chartArea;
        const ctx = c.ctx;
        const xValue = xScale.getValueForPixel(px);

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, area.top);
        ctx.lineTo(px, area.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        c.data.datasets.forEach((d, i) => {
            if (d.isTrendline || d.isProcessed || !c.isDatasetVisible(i)) return;
            const p = nearestPoint(d.data, xValue);
            const yScale = c.scales[d.yAxisID || 'y'];
            if (!p || !yScale) return;
            ctx.beginPath();
            ctx.fillStyle = d.borderColor;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.arc(xScale.getPixelForValue(p.x), yScale.getPixelForValue(p.y), 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
        ctx.restore();
    }
};

// 나눠 보기에서 칸마다 옅은 바탕과 경계선을 그려 칸이 구분되게 한다.
const panelBackgroundPlugin = {
    id: 'panelBackground',
    beforeDatasetsDraw(c) {
        if (viewMode !== 'split') return;
        const area = c.chartArea;
        const panels = Object.values(c.scales).filter(s => s.options && s.options.stack === 'panels');
        if (panels.length < 2) return;
        const ctx = c.ctx;
        ctx.save();
        panels.forEach((s, k) => {
            if (k % 2 === 1) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.025)';
                ctx.fillRect(area.left, s.top, area.right - area.left, s.bottom - s.top);
            }
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(area.left, s.bottom + 0.5);
            ctx.lineTo(area.right, s.bottom + 0.5);
            ctx.stroke();
        });
        ctx.restore();
    }
};

export function initializeChart(canvasId) {
    if (typeof Chart === 'undefined') {
        logMessage('logChartJsError');
        return null;
    }
    try {
        const saved = localStorage.getItem('bowerbirdViewMode');
        if (VIEW_MODES.includes(saved)) viewMode = saved;
    } catch (e) { /* 저장소를 못 쓰면 기본값 */ }

    const ctx = document.getElementById(canvasId).getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [] },
        plugins: [timeCursorPlugin, panelBackgroundPlugin],
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
                            refreshLayout();
                            if (window.onChartUpdate) window.onChartUpdate();
                        }
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPanComplete: ({ chart }) => {
                            refreshLayout();
                            if (window.onChartUpdate) window.onChartUpdate();
                        }
                    }
                },
                legend: {
                    display: true, position: 'top', align: 'end',
                    // 센서를 숨기거나 다시 보이면 칸 묶음을 바로 다시 계산한다
                    onClick(e, item, legend) {
                        Chart.defaults.plugins.legend.onClick.call(this, e, item, legend);
                        refreshLayout();
                    }
                }
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
    applyLayout();
    return chart;
}

export function updateChartTranslations(translations, lang) {
    if (lang) currentLang = lang;
    if (translations.chartValueAxis) axisLabels.value = translations.chartValueAxis;
    if (translations.chartNormalizedAxis) axisLabels.normalized = translations.chartNormalizedAxis;
    if (chart && translations.chartTimeAxis && translations.chartValueAxis) {
        chart.options.scales.x.title.text = translations.chartTimeAxis;
        applyLayout();
    }
}

// --- 보기 모드 / 칸 묶음 ---

function sensorIndices() {
    if (!chart) return [];
    return chart.data.datasets
        .map((d, i) => (!d.isTrendline && !d.isProcessed) ? i : -1)
        .filter(i => i >= 0);
}

export function getViewMode() {
    return viewMode;
}

export function canUseDualAxis() {
    return sensorIndices().length === 2;
}

/** 보기 모드를 바꾼다. 실제로 적용된 모드를 돌려준다(좌우 Y축은 센서 2개가 아니면 나눠 보기로). */
export function setViewMode(mode) {
    if (!VIEW_MODES.includes(mode)) return viewMode;
    viewMode = mode;
    try { localStorage.setItem('bowerbirdViewMode', mode); } catch (e) { /* 무시 */ }
    panelGroups = null;
    candidateKey = null;
    refreshLayout();
    return effectiveMode();
}

function effectiveMode() {
    if (viewMode === 'dual' && !canUseDualAxis()) return 'split';
    return viewMode;
}

/**
 * 나눠 보기 = 센서마다 한 칸. 단 보이는 센서가 AUTO_GROUP_MIN_SENSORS(5) 이상이면 칸이 너무 얇아지므로
 * 아래 자동 묶기를 쓴다.
 * 2) 자동 묶기: 보이는 시간 구간에서 센서마다 최솟값·최댓값을 구하고,
 * 범위가 큰 센서부터 칸에 넣는다. 함께 넣었을 때 칸 안의 어느 센서라도
 * 합친 범위의 10% 미만으로 눌리면 새 칸을 만든다(크기 차이와 위치 차이를 함께 본다 —
 * 온도 25±0.5 와 습도 60±2 처럼 폭은 비슷해도 떨어져 있으면 따로 둔다).
 * 데이터가 아직 적으면 null(지금 묶음 유지).
 */
function computeGroups() {
    const idx = sensorIndices();
    if (idx.length <= 1) return [idx];
    const xs = chart.scales.x;
    const minX = (xs && isFinite(xs.min)) ? xs.min : -Infinity;
    const maxX = (xs && isFinite(xs.max)) ? xs.max : Infinity;

    const visible = idx.filter(i => chart.isDatasetVisible(i)); // 숨긴 센서는 칸을 차지하지 않는다
    if (visible.length === 0) return [idx];
    if (visible.length < AUTO_GROUP_MIN_SENSORS) return visible.map(i => [i]);

    const stats = [];
    for (const i of visible) {
        const pts = binaryRangeFilter(chart.data.datasets[i].data, minX, maxX);
        if (pts.length < GROUP_MIN_POINTS) return null;
        let lo = Infinity, hi = -Infinity;
        for (const p of pts) {
            if (p.y < lo) lo = p.y;
            if (p.y > hi) hi = p.y;
        }
        stats.push({ i, lo, hi, span: hi - lo });
    }
    if (stats.length === 0) return [idx];

    stats.sort((a, b) => b.span - a.span);
    const groups = [];
    for (const s of stats) {
        const target = groups.find(g => {
            const span = Math.max(g.hi, s.hi) - Math.min(g.lo, s.lo);
            return span === 0 || [...g.members, s].every(m => m.span / span >= GROUP_MIN_SHARE);
        });
        if (target) {
            target.members.push(s);
            target.lo = Math.min(target.lo, s.lo);
            target.hi = Math.max(target.hi, s.hi);
        } else {
            groups.push({ members: [s], lo: s.lo, hi: s.hi });
        }
    }
    return groups
        .map(g => g.members.map(m => m.i).sort((a, b) => a - b))
        .sort((a, b) => a[0] - b[0]);
}

/**
 * 나눠 보기의 칸 묶음을 다시 계산한다. immediate 가 아니면 1초에 한 번만 보고,
 * 바뀐 묶음은 2번 연속 같게 나와야 적용한다(값이 경계에서 오갈 때 칸이 깜빡이지 않게).
 */
function maybeRegroup(immediate) {
    if (!chart || effectiveMode() !== 'split') return false;
    const now = performance.now();
    if (!immediate && now - lastGroupCheck < GROUP_CHECK_MS) return false;
    lastGroupCheck = now;

    const groups = computeGroups();
    if (!groups) return false;
    const key = JSON.stringify(groups);
    if (key === JSON.stringify(panelGroups)) {
        candidateKey = null;
        return false;
    }
    if (!immediate && panelGroups) {
        if (key !== candidateKey) {
            candidateKey = key;
            candidateHits = 1;
            return false;
        }
        if (++candidateHits < GROUP_CONFIRM_CHECKS) return false;
    }
    panelGroups = groups;
    candidateKey = null;
    applyLayout();
    return true;
}

/** 확대·이동·범례 클릭·불러오기 뒤에 부른다 — 묶음을 바로 다시 보고 축을 다시 짠다. */
export function refreshLayout() {
    if (!chart) return;
    chart.update('none'); // 새로 들어온 데이터로 x 범위부터 맞춘다(묶음은 보이는 구간 기준)
    if (!maybeRegroup(true)) applyLayout();
}

function baseValueAxis() {
    return {
        type: 'linear',
        position: 'left',
        title: { display: true, text: axisLabels.value, color: AXIS_TEXT_COLOR },
        ticks: { color: AXIS_TEXT_COLOR }
    };
}

/** 지금 보기 모드와 칸 묶음에 맞게 Y축을 만들고 데이터셋을 축에 붙인다. */
function applyLayout() {
    if (!chart) return;
    const scales = chart.options.scales;
    const ds = chart.data.datasets;
    Object.keys(scales)
        .filter(k => k.startsWith(PANEL_AXIS_PREFIX) || k.startsWith('y_sensor_'))
        .forEach(k => delete scales[k]);
    scales.y = baseValueAxis();

    const idx = sensorIndices();
    const axisOf = {};
    const mode = effectiveMode();

    if (mode === 'overlay' || idx.length === 0) {
        if (manualYRange.min !== null) scales.y.min = manualYRange.min;
        if (manualYRange.max !== null) scales.y.max = manualYRange.max;
    } else if (mode === 'split') {
        const valid = panelGroups && panelGroups.flat().every(i => idx.includes(i));
        const groups = valid ? panelGroups : [idx];
        groups.forEach((g, k) => {
            const id = k === 0 ? 'y' : PANEL_AXIS_PREFIX + k;
            const color = g.length === 1 ? ds[g[0]].borderColor : AXIS_TEXT_COLOR;
            const axis = k === 0 ? scales.y : (scales[id] = baseValueAxis());
            // weight 가 클수록 위 칸 — 센서 번호가 작은 묶음이 맨 위
            Object.assign(axis, { stack: 'panels', stackWeight: 1, offset: true, weight: groups.length - k });
            axis.title = { display: true, text: g.map(i => ds[i].label).join(', '), color };
            axis.ticks = { color, maxTicksLimit: groups.length > 2 ? 4 : 6 };
            g.forEach(i => { axisOf[i] = id; });
        });
    } else if (mode === 'normalize') {
        Object.assign(scales.y, { min: 0, max: 100 });
        scales.y.title.text = axisLabels.normalized;
        scales.y.ticks.callback = v => v + '%';
        idx.forEach(i => {
            const id = PANEL_AXIS_PREFIX + 'n' + i;
            scales[id] = { type: 'linear', display: false, grace: '5%' };
            axisOf[i] = id;
        });
    } else if (mode === 'dual') {
        const [a, b] = idx;
        const rightId = PANEL_AXIS_PREFIX + 'right';
        scales.y.title = { display: true, text: ds[a].label, color: ds[a].borderColor };
        scales.y.ticks = { color: ds[a].borderColor };
        scales[rightId] = {
            type: 'linear', position: 'right',
            title: { display: true, text: ds[b].label, color: ds[b].borderColor },
            ticks: { color: ds[b].borderColor },
            grid: { drawOnChartArea: false }
        };
        axisOf[a] = 'y';
        axisOf[b] = rightId;
    }

    // 숨긴 센서 등 칸에 안 들어간 센서는 첫 축에 둔다(숨긴 데이터셋은 축 범위에 영향이 없다)
    idx.forEach(i => { ds[i].yAxisID = axisOf[i] || 'y'; });
    // 추세선·스무딩·이상치 표시는 원래 센서와 같은 축에
    ds.forEach(d => {
        if (d.isTrendline) d.yAxisID = axisForSensor(d.linkedSensor);
        else if (d.isProcessed) d.yAxisID = d.useSecondaryAxis ? 'y1' : axisForSensor(d.linkedSensor);
    });

    chart.update('none');
}

function axisForSensor(label) {
    if (!chart || !label) return 'y';
    const sensor = chart.data.datasets.find(d => !d.isTrendline && !d.isProcessed && d.label === label);
    return (sensor && sensor.yAxisID) || 'y';
}

/** "센서 1 (Smoothed)" → "센서 1" 처럼 가공 데이터 이름에서 원래 센서 이름을 찾는다. */
function linkedSensorOf(label) {
    if (!chart) return null;
    const sensor = chart.data.datasets.find(d => !d.isTrendline && !d.isProcessed && label.startsWith(d.label + ' ('));
    return sensor ? sensor.label : null;
}

function nearestPoint(data, x) {
    if (!data || data.length === 0) return null;
    let lo = 0, hi = data.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (data[mid].x < x) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(data[lo - 1].x - x) < Math.abs(data[lo].x - x)) lo--;
    return data[lo];
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

    applyLayout();
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
            yAxisID: axisForSensor(sensorLabel),
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

    // Configuration — 2차 축이 아니면 원래 센서와 같은 축(나눠 보기의 칸)에 그린다
    const linkedSensor = linkedSensorOf(label);
    const yAxisID = useSecondaryAxis ? 'y1' : axisForSensor(linkedSensor);
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
            linkedSensor: linkedSensor,
            useSecondaryAxis: useSecondaryAxis,
            isProcessed: true // Marker to identify processed data
        };
        chart.data.datasets.push(dataset);
    } else {
        dataset.data = data;
        dataset.borderColor = color;
        dataset.yAxisID = yAxisID;
        dataset.linkedSensor = linkedSensor;
        dataset.useSecondaryAxis = useSecondaryAxis;
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
        const visiblePoints = binaryRangeFilter(dataset.data, minX, maxX);
        return {
            label: dataset.label,
            data: visiblePoints,
            isProcessed: dataset.isProcessed || false
        };
    });
}

/**
 * Retrieves ALL data points for all datasets from full data store (ignores viewport and downsampling).
 */
export function getAllData() {
    if (!chart) return [];

    return chart.data.datasets.map((dataset, i) => ({
        label: dataset.label,
        data: (!dataset.isTrendline && !dataset.isProcessed && fullDataStore[i])
            ? fullDataStore[i]
            : dataset.data,
        isProcessed: dataset.isProcessed || false
    }));
}

/**
 * Binary search based range filter for sorted data arrays.
 */
function binaryRangeFilter(data, minX, maxX) {
    if (!data || data.length === 0) return [];

    // Find start index (first element >= minX)
    let lo = 0, hi = data.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (data[mid].x < minX) lo = mid + 1;
        else hi = mid;
    }
    const startIdx = lo;

    // Find end index (first element > maxX)
    hi = data.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (data[mid].x <= maxX) lo = mid + 1;
        else hi = mid;
    }
    const endIdx = lo;

    return data.slice(startIdx, endIdx);
}

export function resetChart() {
    if (chart && chart.data.datasets) chart.data.datasets.forEach(dataset => dataset.data = []);
    chartStartTime = null;
    chartMode = 'EXPANDING';
    dataPointBuffer = [];
    lastDataFlush = 0;
    fullDataStore = [];
    mcuTimeOrigin = null;
    // 새 기록·불러오기는 한 칸에서 다시 시작한다(지난 세션의 x 범위·칸 묶음을 버린다)
    panelGroups = null;
    candidateKey = null;
    if (chart) {
        delete chart.options.scales.x.min;
        delete chart.options.scales.x.max;
        applyLayout();
    }
}

// Batch data point buffer for performance
let dataPointBuffer = [];
let lastDataFlush = 0;
const DATA_FLUSH_INTERVAL = 50; // Flush every 50ms

export function addDataPoint(values, timeInfo) {
    let elapsedSeconds;

    if (timeInfo && timeInfo.mcuMs !== undefined) {
        // MCU timestamp (milliseconds from MCU boot)
        if (!chartStartTime) chartStartTime = new Date();
        if (!mcuTimeOrigin) mcuTimeOrigin = timeInfo.mcuMs;
        elapsedSeconds = (timeInfo.mcuMs - mcuTimeOrigin) / 1000;
    } else {
        // Browser Date object
        if (!chartStartTime) chartStartTime = timeInfo;
        elapsedSeconds = (timeInfo - chartStartTime) / 1000;
    }

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

    // Add all buffered points to both chart and full data store
    dataPointBuffer.forEach(({ values, elapsedSeconds }) => {
        values.forEach((value, i) => {
            if (chart.data.datasets[i]) {
                chart.data.datasets[i].data.push({ x: elapsedSeconds, y: value });
            }
            // Store in full data store for analysis
            if (!fullDataStore[i]) fullDataStore[i] = [];
            fullDataStore[i].push({ x: elapsedSeconds, y: value });
        });
    });

    dataPointBuffer = [];

    // Downsample chart datasets if exceeding memory limit
    chart.data.datasets.forEach((dataset, i) => {
        if (!dataset.isTrendline && !dataset.isProcessed && dataset.data.length > MAX_DATA_POINTS) {
            dataset.data = downsample(dataset.data, MAX_DATA_POINTS);
        }
    });
}

/**
 * Downsample data by keeping every Nth point (LTTB-like simplification).
 */
function downsample(data, targetPoints) {
    if (data.length <= targetPoints) return data;
    const step = Math.ceil(data.length / targetPoints);
    const result = [];
    for (let i = 0; i < data.length; i += step) {
        result.push(data[i]);
    }
    // Always include last point
    if (result[result.length - 1] !== data[data.length - 1]) {
        result.push(data[data.length - 1]);
    }
    return result;
}

// Ensure buffer is flushed when needed
export function forceFlushData() {
    flushDataPoints();
}

/**
 * Export chart as PNG image download.
 */
export function exportChartImage() {
    if (!chart) return;
    const url = chart.toBase64Image('image/png', 1);
    const link = document.createElement('a');
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    link.download = `Bowerbird_PRO_chart_${dateStr}_${timeStr}.png`;
    link.href = url;
    link.click();
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
    maybeRegroup(false);
    chart.update('none');
}

// --- Y-Axis Range Manual Setting ---
// 겹쳐 보기에서만 쓴다(다른 모드는 칸·센서마다 자동 범위). 값은 기억해 두었다가 겹쳐 보기로 돌아오면 적용.
export function setYAxisRange(min, max) {
    const toNum = v => (v === '' || v === null || v === undefined || isNaN(v)) ? null : Number(v);
    manualYRange = { min: toNum(min), max: toNum(max) };
    applyLayout();
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
