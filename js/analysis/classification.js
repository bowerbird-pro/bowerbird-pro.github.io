/**
 * Simple k-NN classifier.
 */
let trainingData = []; // Array of { features: number[], label: string }

export function setTrainingData(data) {
    trainingData = data;
}

export function classifyState(features, k = 3) {
    if (trainingData.length === 0 || !features || features.length === 0) return "UNKNOWN";

    // Calculate distances
    const distances = trainingData.map(sample => ({
        label: sample.label,
        distance: euclideanDistance(features, sample.features)
    }));

    // Sort by distance and take k nearest
    distances.sort((a, b) => a.distance - b.distance);
    const kNearest = distances.slice(0, Math.min(k, distances.length));

    // Vote
    const votes = {};
    kNearest.forEach(n => {
        votes[n.label] = (votes[n.label] || 0) + 1;
    });

    let bestLabel = "UNKNOWN";
    let bestCount = 0;
    for (const [label, count] of Object.entries(votes)) {
        if (count > bestCount) {
            bestCount = count;
            bestLabel = label;
        }
    }
    return bestLabel;
}

function euclideanDistance(a, b) {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
}

/**
 * Parse CSV training data. Expected format:
 * feature1,feature2,...,label
 */
export function parseTrainingCSV(csvText) {
    const lines = csvText.split('\n').filter(l => l.trim());
    const data = [];
    // Skip header if first row contains non-numeric first column
    const startRow = isNaN(parseFloat(lines[0].split(',')[0])) ? 1 : 0;
    for (let i = startRow; i < lines.length; i++) {
        const parts = lines[i].split(',').map(p => p.trim());
        if (parts.length < 2) continue;
        const label = parts.pop();
        const features = parts.map(Number);
        if (features.some(isNaN)) continue;
        data.push({ features, label });
    }
    return data;
}
