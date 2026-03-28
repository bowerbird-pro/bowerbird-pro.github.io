/**
 * Calculates basic statistics for an array of numbers.
 * @param {number[]} data - Array of numerical values.
 * @returns {object} Object containing mean, min, max, stdDev, count.
 */
export function calculateBasicStats(data) {
    if (!data || data.length === 0) {
        return {
            count: 0,
            min: 0,
            max: 0,
            mean: 0,
            stdDev: 0
        };
    }

    const count = data.length;

    // Loop-based min/max to avoid stack overflow with large datasets (>65K points)
    let min = Infinity, max = -Infinity, sum = 0;
    for (let i = 0; i < count; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    const mean = sum / count;

    // Single-pass stdDev calculation (avoids creating intermediate arrays)
    let sqDiffSum = 0;
    for (let i = 0; i < count; i++) {
        const diff = data[i] - mean;
        sqDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(sqDiffSum / count);

    return {
        count,
        min,
        max,
        mean,
        stdDev
    };
}
