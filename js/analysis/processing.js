/**
 * Computes the Simple Moving Average (SMA).
 * @param {Array<{x: number, y: number}>} data 
 * @param {number} windowSize - Number of points to average (odd number preferred).
 * @returns {Array<{x: number, y: number}>}
 */
export function calculateMovingAverage(data, windowSize) {
    if (data.length < windowSize) return data;

    // Ensure windowSize is at least 1
    const w = Math.max(1, Math.floor(windowSize));
    const smoothed = [];

    for (let i = 0; i < data.length; i++) {
        let sum = 0;
        let count = 0;

        // Simple window centered around i if possible, or trailing?
        // Let's use a centered window for better phase alignment on graphs.
        const start = Math.max(0, i - Math.floor(w / 2));
        const end = Math.min(data.length - 1, i + Math.floor(w / 2));

        for (let j = start; j <= end; j++) {
            sum += data[j].y;
            count++;
        }

        smoothed.push({ x: data[i].x, y: sum / count });
    }
    return smoothed;
}

/**
 * Computes Savitzky-Golay smoothing.
 * Implements a simplified 5-point quadratic/cubic smoothing.
 * Coefficients: [-3, 12, 17, 12, -3] / 35
 * @param {Array<{x: number, y: number}>} data 
 * @returns {Array<{x: number, y: number}>}
 */
export function calculateSavitzkyGolay(data) {
    if (data.length < 5) return data; // Not enough points

    const smoothed = [];
    const coeffs = [-3, 12, 17, 12, -3];
    const norm = 35;

    // For edges, we just keep original data or use simpler smoothing.
    // Let's keep original for indexes 0,1 and N-2, N-1
    smoothed.push(data[0]);
    smoothed.push(data[1]);

    for (let i = 2; i < data.length - 2; i++) {
        let y = 0;
        for (let j = -2; j <= 2; j++) {
            y += data[i + j].y * coeffs[j + 2];
        }
        smoothed.push({ x: data[i].x, y: y / norm });
    }

    smoothed.push(data[data.length - 2]);
    smoothed.push(data[data.length - 1]);

    return smoothed;
}
