/**
 * Calculates regression for a set of points based on the specified type.
 * @param {Array<{x: number, y: number}>} points - Array of {x, y} objects.
 * @param {string} type - 'linear', 'polynomial', 'exponential', 'power', 'logarithmic'
 * @returns {object|null} Object containing equation parameters, rSquared, formula, and predict function.
 */
export function calculateRegression(points, type = 'linear') {
    if (!points || points.length < 2) return null;

    // Filter invalid points for specific models
    let validPoints = points;
    if (type === 'logarithmic') validPoints = points.filter(p => p.x > 0);
    else if (type === 'exponential' || type === 'power') validPoints = points.filter(p => p.y > 0);
    if (type === 'power') validPoints = validPoints.filter(p => p.x > 0);

    if (validPoints.length < 2) return null;

    switch (type) {
        case 'polynomial':
            return calculatePolynomialRegression(validPoints, 2); // Default to 2nd order
        case 'exponential':
            return calculateExponentialRegression(validPoints);
        case 'power':
            return calculatePowerRegression(validPoints);
        case 'logarithmic':
            return calculateLogarithmicRegression(validPoints);
        case 'linear':
        default:
            return calculateLinearRegression(validPoints);
    }
}

function calculateLinearRegression(points) {
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;

    for (let i = 0; i < n; i++) {
        const { x, y } = points[i];
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; sumYY += y * y;
    }

    const denominator = (n * sumXX) - (sumX * sumX);
    if (Math.abs(denominator) < 1e-10) return null;

    const slope = ((n * sumXY) - (sumX * sumY)) / denominator;
    const intercept = (sumY - (slope * sumX)) / n;

    const predict = (x) => slope * x + intercept;
    const rSquared = calculateRSquared(points, predict);

    return {
        type: 'linear',
        points: points.length,
        parameters: { slope, intercept },
        rSquared,
        formula: `y = ${slope.toFixed(4)}x ${intercept >= 0 ? '+' : ''} ${intercept.toFixed(4)}`,
        predict
    };
}

function calculatePolynomialRegression(points, order = 2) {
    // Solving Ax = B for coefficients a, b, c...
    // For 2nd order: y = ax^2 + bx + c
    // We need sums of x^0 to x^4

    const n = points.length;
    const lhs = []; // Matrix A
    const rhs = []; // Vector B

    // Create matrix for normal equations
    for (let r = 0; r <= order; r++) {
        let row = [];
        for (let c = 0; c <= order; c++) {
            let sumPowerX = 0;
            for (let i = 0; i < n; i++) sumPowerX += Math.pow(points[i].x, r + c);
            row.push(sumPowerX);
        }
        lhs.push(row);

        let sumPowerXY = 0;
        for (let i = 0; i < n; i++) sumPowerXY += points[i].y * Math.pow(points[i].x, r);
        rhs.push(sumPowerXY);
    }

    // Solve linear system using Gaussian elimination
    const coeffs = gaussianElimination(lhs, rhs);
    if (!coeffs) return null;

    // coeffs[0] is c (x^0), coeffs[1] is b (x^1), coeffs[2] is a (x^2)
    const [c, b, a] = coeffs;

    const predict = (x) => a * x * x + b * x + c;
    const rSquared = calculateRSquared(points, predict);

    return {
        type: 'polynomial',
        points: n,
        parameters: { a, b, c },
        rSquared,
        formula: `y = ${a.toFixed(4)}x² ${b >= 0 ? '+' : ''} ${b.toFixed(4)}x ${c >= 0 ? '+' : ''} ${c.toFixed(4)}`,
        predict
    };
}

function calculateExponentialRegression(points) {
    // Model: y = ae^(bx)  =>  ln(y) = ln(a) + bx
    // Linear regression on (x, ln(y))
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        const x = points[i].x;
        const y = Math.log(points[i].y);
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }

    const denominator = (n * sumXX) - (sumX * sumX);
    if (Math.abs(denominator) < 1e-10) return null;

    const b = ((n * sumXY) - (sumX * sumY)) / denominator;
    const lnA = (sumY - (b * sumX)) / n;
    const a = Math.exp(lnA);

    const predict = (x) => a * Math.exp(b * x);
    const rSquared = calculateRSquared(points, predict);

    return {
        type: 'exponential',
        points: n,
        parameters: { a, b },
        rSquared,
        formula: `y = ${a.toFixed(4)}e^(${b.toFixed(4)}x)`,
        predict
    };
}

function calculatePowerRegression(points) {
    // Model: y = ax^b  =>  ln(y) = ln(a) + b*ln(x)
    // Linear regression on (ln(x), ln(y))
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        const x = Math.log(points[i].x);
        const y = Math.log(points[i].y);
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }

    const denominator = (n * sumXX) - (sumX * sumX);
    if (Math.abs(denominator) < 1e-10) return null;

    const b = ((n * sumXY) - (sumX * sumY)) / denominator;
    const lnA = (sumY - (b * sumX)) / n;
    const a = Math.exp(lnA);

    const predict = (x) => a * Math.pow(x, b);
    const rSquared = calculateRSquared(points, predict);

    return {
        type: 'power',
        points: n,
        parameters: { a, b },
        rSquared,
        formula: `y = ${a.toFixed(4)}x^${b.toFixed(4)}`,
        predict
    };
}

function calculateLogarithmicRegression(points) {
    // Model: y = a + b*ln(x)
    // Linear regression on (ln(x), y)
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        const x = Math.log(points[i].x);
        const y = points[i].y;
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }

    const denominator = (n * sumXX) - (sumX * sumX);
    if (Math.abs(denominator) < 1e-10) return null;

    const b = ((n * sumXY) - (sumX * sumY)) / denominator;
    const a = (sumY - (b * sumX)) / n;

    const predict = (x) => a + b * Math.log(x);
    const rSquared = calculateRSquared(points, predict);

    return {
        type: 'logarithmic',
        points: n,
        parameters: { a, b },
        rSquared,
        formula: `y = ${a.toFixed(4)} + ${b.toFixed(4)}ln(x)`,
        predict
    };
}

function calculateRSquared(points, predictFunc) {
    const n = points.length;
    let sumY = 0;
    for (let i = 0; i < n; i++) sumY += points[i].y;
    const meanY = sumY / n;

    let ssTotal = 0;
    let ssRes = 0;

    for (let i = 0; i < n; i++) {
        const { x, y } = points[i];
        const yPred = predictFunc(x);
        ssTotal += Math.pow(y - meanY, 2);
        ssRes += Math.pow(y - yPred, 2);
    }

    if (ssTotal === 0) return 1; // Constant line fits perfectly
    return Math.max(0, 1 - (ssRes / ssTotal));
}

function gaussianElimination(A, b) {
    const n = b.length;
    // Forward elimination
    for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
        }

        // Swap rows
        [A[i], A[maxRow]] = [A[maxRow], A[i]];
        [b[i], b[maxRow]] = [b[maxRow], b[i]];

        if (Math.abs(A[i][i]) < 1e-10) return null; // Singular matrix

        // Eliminate
        for (let k = i + 1; k < n; k++) {
            const factor = A[k][i] / A[i][i];
            for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
            b[k] -= factor * b[i];
        }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) sum += A[i][j] * x[j];
        x[i] = (b[i] - sum) / A[i][i];
    }
    return x;
}
