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
    const min = Math.min(...data);
    const max = Math.max(...data);
    
    const sum = data.reduce((a, b) => a + b, 0);
    const mean = sum / count;

    const squaredDiffs = data.map(value => Math.pow(value - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / count;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
        count,
        min,
        max,
        mean,
        stdDev
    };
}
