/**
 * Calculates the numerical derivative of a dataset.
 * Uses central difference for interior points and forward/backward difference for endpoints.
 * @param {Array<{x: number, y: number}>} data - Sorted array of points
 * @returns {Array<{x: number, y: number}>} - Array of points representing dy/dx
 */
export function calculateDerivative(data) {
    if (data.length < 2) return [];

    const derivative = [];

    for (let i = 0; i < data.length; i++) {
        let dy, dx;

        if (i === 0) {
            // Forward difference
            dx = data[i + 1].x - data[i].x;
            dy = data[i + 1].y - data[i].y;
        } else if (i === data.length - 1) {
            // Backward difference
            dx = data[i].x - data[i - 1].x;
            dy = data[i].y - data[i - 1].y;
        } else {
            // Central difference
            dx = data[i + 1].x - data[i - 1].x;
            dy = data[i + 1].y - data[i - 1].y;
        }

        if (dx !== 0) {
            derivative.push({ x: data[i].x, y: dy / dx });
        } else {
            derivative.push({ x: data[i].x, y: 0 });
        }
    }

    return derivative;
}

/**
 * Calculates the numerical cumulative integral of a dataset using the Trapezoidal Rule.
 * @param {Array<{x: number, y: number}>} data - Sorted array of points
 * @returns {Array<{x: number, y: number}>} - Array of points representing cumulative area
 */
export function calculateIntegral(data) {
    if (data.length < 2) return [];

    const integral = [];
    let area = 0;

    // Initial point starts at 0 area (relative) or can assume constant? 
    // Usually integral starts from 0 at t0.
    integral.push({ x: data[0].x, y: 0 });

    for (let i = 1; i < data.length; i++) {
        const dx = data[i].x - data[i - 1].x;
        const avgY = (data[i].y + data[i - 1].y) / 2;
        area += avgY * dx;
        integral.push({ x: data[i].x, y: area });
    }

    return integral;
}
