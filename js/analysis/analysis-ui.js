import { calculateBasicStats } from './statistics.js';
import { calculateRegression } from './regression.js';
import { calculateDerivative, calculateIntegral } from './calculus.js';
import { calculateMovingAverage, calculateSavitzkyGolay } from './processing.js';
import * as ChartHandler from '../visualization/chart-handler.js';
import { translate } from '../utils/i18n.js';

const ui = {
    analysisResult: document.getElementById('analysisResult'),
    btnDerivative: document.getElementById('btnDerivative'),
    btnIntegral: document.getElementById('btnIntegral'),
    smoothingToggle: document.getElementById('smoothingToggle'),
    smoothingType: document.getElementById('smoothingType')
};

let currentRegressionType = 'linear';
// Smoothing state
let isSmoothingEnabled = false;
let currentSmoothingType = 'ma';

const trendlineStates = new Map(); // Tracks checking state by sensor label

// Color palettes for calculus operations - each sensor gets a different color
const derivativeColors = ['#FF6F00', '#F57C00', '#E65100', '#FF9800', '#FB8C00', '#F57F17', '#FF6D00', '#EF6C00', '#E64A19', '#D84315'];
const integralColors = ['#00ACC1', '#0097A7', '#00838F', '#26C6DA', '#00BCD4', '#0288D1', '#039BE5', '#0277BD', '#01579B', '#006064'];

// Toggle state for calculus operations
let isDerivativeActive = false;
let isIntegralActive = false;

// Throttle analysis updates for performance
let analysisUpdateTimeout = null;
let lastAnalysisUpdate = 0;
const ANALYSIS_UPDATE_INTERVAL = 200; // Update at most every 200ms

function throttledUpdateAnalysis() {
    const now = Date.now();

    // If enough time has passed, update immediately
    if (now - lastAnalysisUpdate > ANALYSIS_UPDATE_INTERVAL) {
        updateAnalysis();
        lastAnalysisUpdate = now;
        return;
    }

    // Otherwise, schedule an update
    if (analysisUpdateTimeout) clearTimeout(analysisUpdateTimeout);
    analysisUpdateTimeout = setTimeout(() => {
        updateAnalysis();
        lastAnalysisUpdate = Date.now();
    }, ANALYSIS_UPDATE_INTERVAL - (now - lastAnalysisUpdate));
}

export function resetCalculusButtons() {
    isDerivativeActive = false;
    isIntegralActive = false;
    if (ui.btnDerivative) ui.btnDerivative.classList.remove('active');
    if (ui.btnIntegral) ui.btnIntegral.classList.remove('active');
}

export function initAnalysisUI() {
    // Hook into chart updates with throttling
    window.onChartUpdate = throttledUpdateAnalysis;

    // Attach listeners to static controls
    document.getElementById('regressionTypeSelect').addEventListener('change', (e) => {
        currentRegressionType = e.target.value;
        updateAnalysis();
    });

    // Calculus Buttons
    if (ui.btnDerivative) {
        ui.btnDerivative.addEventListener('click', () => applyCalculus('derivative'));
    }
    if (ui.btnIntegral) {
        ui.btnIntegral.addEventListener('click', () => applyCalculus('integral'));
    }

    // Smoothing Controls
    if (ui.smoothingToggle) {
        ui.smoothingToggle.addEventListener('change', (e) => {
            isSmoothingEnabled = e.target.checked;
            ui.smoothingType.disabled = !isSmoothingEnabled;
            updateAnalysis();
        });
    }
    if (ui.smoothingType) {
        ui.smoothingType.addEventListener('change', (e) => {
            currentSmoothingType = e.target.value;
            updateAnalysis();
        });
    }
}

function applyCalculus(type) {
    const visibleDatasets = ChartHandler.getVisibleData();
    if (!visibleDatasets || visibleDatasets.length === 0) return;

    // Toggle logic
    if (type === 'derivative') {
        if (isDerivativeActive) {
            // Remove all derivative datasets
            removeCalculusDatasets('(Derivative)');
            isDerivativeActive = false;
            ui.btnDerivative.classList.remove('active');
        } else {
            // Add derivative datasets
            addCalculusDatasets(visibleDatasets, 'derivative');
            isDerivativeActive = true;
            ui.btnDerivative.classList.add('active');
        }
    } else if (type === 'integral') {
        if (isIntegralActive) {
            // Remove all integral datasets
            removeCalculusDatasets('(Integral)');
            isIntegralActive = false;
            ui.btnIntegral.classList.remove('active');
        } else {
            // Add integral datasets
            addCalculusDatasets(visibleDatasets, 'integral');
            isIntegralActive = true;
            ui.btnIntegral.classList.add('active');
        }
    }
}

function addCalculusDatasets(visibleDatasets, type) {
    let sensorIndex = 0;
    visibleDatasets.forEach(dataset => {
        if (dataset.isProcessed) return; // Don't process already processed data recursively

        let resultData = [];
        let labelSuffix = '';
        let color = '#FF5722';

        if (type === 'derivative') {
            resultData = calculateDerivative(dataset.data);
            labelSuffix = '(Derivative)';
            color = derivativeColors[sensorIndex % derivativeColors.length];
        } else if (type === 'integral') {
            resultData = calculateIntegral(dataset.data);
            labelSuffix = '(Integral)';
            color = integralColors[sensorIndex % integralColors.length];
        }

        if (resultData.length > 0) {
            ChartHandler.addProcessedDataset(
                resultData,
                `${dataset.label} ${labelSuffix}`,
                color,
                true // Use Secondary Axis
            );
        }

        sensorIndex++;
    });
}

function removeCalculusDatasets(suffix) {
    // Get all datasets and remove those with the specified suffix
    const allDatasets = ChartHandler.getVisibleData();
    allDatasets.forEach(dataset => {
        if (dataset.label.includes(suffix)) {
            ChartHandler.removeProcessedDataset(dataset.label);
        }
    });
}

function updateAnalysis() {
    const visibleDatasets = ChartHandler.getVisibleData();

    if (!visibleDatasets || visibleDatasets.length === 0 || visibleDatasets[0].data.length === 0) {
        ui.analysisResult.innerHTML = `<div class="analysis-placeholder" data-translate="selectRangeHint">${translate('selectRangeHint') || 'Select a range on the chart.'}</div>`;
        return;
    }

    let cardsHtml = '';

    // Generate HTML for all cards
    visibleDatasets.forEach((dataset, index) => {
        // Skip processing processed datasets for stats/regression to avoid clutter?
        // Or show them? Let's skip them in the card list to keep it clean, 
        // or maybe show them if the user wants stats on the derivative?
        // For now, let's process standard sensors. 
        // We can identify them by checking if they are NOT trendlines. 
        // ChartHandler.getVisibleData returns datasets. We need to know if they are raw sensors.
        // The simple check is likely `!dataset.isProcessed` provided by addProcessedDataset.
        // Taking a shortcut: Assume original datasets don't have isProcessed.

        let workingData = dataset.data;
        let displayLabel = dataset.label;

        // Apply smoothing if enabled and this is a raw sensor
        if (isSmoothingEnabled && !dataset.isProcessed && !dataset.isTrendline) { // Add isTrendline check if exposed
            // We want to visualize smoothed data.
            // Option 1: Replace data used for stats/regression.
            // Option 2: Plot smoothed line on chart.

            let smoothed = [];
            if (currentSmoothingType === 'ma') {
                smoothed = calculateMovingAverage(dataset.data, 5); // Window 5
            } else {
                smoothed = calculateSavitzkyGolay(dataset.data);
            }

            // Update chart with smoothed data overlay
            ChartHandler.addProcessedDataset(smoothed, `${dataset.label} (Smoothed)`, '#4CAF50', false); // Green, primary axis

            // Use smoothed data for stats? Usually yes.
            workingData = smoothed;
            // displayLabel += ' (Smoothed)'; 
        } else {
            // If smoothing disabled, remove any existing smoothed datasets for this label
            if (!dataset.isProcessed) {
                ChartHandler.removeProcessedDataset(`${dataset.label} (Smoothed)`);
            }
        }

        const dataValues = workingData.map(p => p.y);
        const stats = calculateBasicStats(dataValues);
        const regression = calculateRegression(workingData, currentRegressionType);

        // Check if this sensor has trendline enabled
        const isTrendlineEnabled = trendlineStates.get(dataset.label) || false;

        cardsHtml += generateAnalysisCard(dataset.label, stats, regression, isTrendlineEnabled);

        // Update Trendline on Chart
        if (isTrendlineEnabled && regression) {
            ChartHandler.updateTrendline(workingData, regression.predict, dataset.label, '#000000');
        } else {
            ChartHandler.removeTrendline(dataset.label);
        }
    });

    ui.analysisResult.innerHTML = `<div class="analysis-content">${cardsHtml}</div>`;

    // Attach Event Listeners to the new checkboxes
    const toggles = ui.analysisResult.querySelectorAll('.trendline-toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const label = e.target.getAttribute('data-label');
            trendlineStates.set(label, e.target.checked);
            updateAnalysis(); // Refreshes UI and Chart
        });
    });
}

function generateAnalysisCard(label, stats, regression, isChecked) {
    const safeNum = (num) => (num !== undefined && num !== null) ? num.toFixed(3) : '-';
    // Inline style constant for items
    const itemStyle = 'display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0; line-height: 1.2; padding: 0;';

    let regressionHtml = '';
    if (regression) {
        regressionHtml = `
            <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="analysisModel">${translate('analysisModel')}</span>
                <span class="analysis-value" style="font-size: 0.8rem;">${regression.formula}</span>
            </div>
            <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="analysisRSquared">${translate('analysisRSquared')}</span>
                <span class="analysis-value">${regression.rSquared.toFixed(4)}</span>
            </div>
            <div class="analysis-item" style="margin-top: 5px; padding-top: 2px; border-top: 1px dashed #eee; display: flex; justify-content: flex-end; align-items: center; line-height: 1.2;">
               <label style="cursor: pointer; display: flex; align-items: center; justify-content: flex-end; width: auto; gap: 5px; font-size: 0.8rem; color: #555; white-space: nowrap; margin: 0;">
                    <input type="checkbox" class="trendline-toggle" data-label="${label}" ${isChecked ? 'checked' : ''} style="margin: 0; padding: 0; transform: translateY(1px);"> 
                    <span data-translate="analysisShowTrendline" style="display: inline-block;">${translate('analysisShowTrendline')}</span>
               </label>
            </div>
        `;
    } else {
        regressionHtml = `
             <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="analysisModel">${translate('analysisModel')}</span>
                <span class="analysis-value" style="font-size: 0.8rem; color: #999;" data-translate="analysisFitFailed">${translate('analysisFitFailed')}</span>
            </div>
        `;
    }

    return `
        <div class="analysis-group">
            <h5>${label}</h5>
            <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="statsMean">${translate('statsMean')}</span>
                <span class="analysis-value">${safeNum(stats.mean)}</span>
            </div>
            <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="statsMinMax">${translate('statsMinMax')}</span>
                <span class="analysis-value">${safeNum(stats.min)} / ${safeNum(stats.max)}</span>
            </div>
            <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="statsStdDev">${translate('statsStdDev')}</span>
                <span class="analysis-value">${safeNum(stats.stdDev)}</span>
            </div>
            <div class="analysis-item" style="${itemStyle}">
                <span class="analysis-label" data-translate="statsCount">${translate('statsCount')}</span>
                <span class="analysis-value">${stats.count}</span>
            </div>
            ${regressionHtml}
        </div>
    `;
}
