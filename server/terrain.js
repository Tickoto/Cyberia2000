/**
 * Server-side Terrain Generation
 *
 * Simplified version of the client terrain for physics simulation.
 * Matches the core height calculation without visual features.
 */

// Configuration (match client values)
const CONFIG = {
    chunkSize: 200,
    cityThreshold: 0.45,
    cityInfluenceThreshold: 0.35,
    cityPlateauHeight: 1.1,
    biomeSeed: 7777
};

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function hash(x, z) {
    return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

function gradient(ix, iz) {
    const angle = 2 * Math.PI * hash(ix, iz);
    return { x: Math.cos(angle), z: Math.sin(angle) };
}

function perlin(x, z) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;

    const sx = fade(x - x0);
    const sz = fade(z - z0);

    const g00 = gradient(x0, z0);
    const g10 = gradient(x1, z0);
    const g01 = gradient(x0, z1);
    const g11 = gradient(x1, z1);

    const dx0 = x - x0;
    const dz0 = z - z0;
    const dx1 = x - x1;
    const dz1 = z - z1;

    const n00 = g00.x * dx0 + g00.z * dz0;
    const n10 = g10.x * dx1 + g10.z * dz0;
    const n01 = g01.x * dx0 + g01.z * dz1;
    const n11 = g11.x * dx1 + g11.z * dz1;

    const ix0 = lerp(n00, n10, sx);
    const ix1 = lerp(n01, n11, sx);
    return lerp(ix0, ix1, sz);
}

function ridge(value) {
    return 2 * (0.5 - Math.abs(0.5 - value));
}

function fbm(x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amplitude * perlin(x * frequency, z * frequency);
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return sum;
}

function turbulence(x, z, octaves = 4) {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        sum += Math.abs(perlin(x * frequency, z * frequency)) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return sum;
}

function domainWarp(x, z, strength = 10) {
    const offsetX = perlin(x * 0.01, z * 0.01) * strength;
    const offsetZ = perlin((x + 100) * 0.01, (z + 100) * 0.01) * strength;
    return { x: x + offsetX, z: z + offsetZ };
}

function plateau(height, sharpness = 4) {
    const normalized = (height + 1) * 0.5;
    return Math.pow(normalized, sharpness) * 2 - 1;
}

function terrace(height, steps = 5, smoothness = 0.3) {
    const stepped = Math.floor(height * steps) / steps;
    return lerp(stepped, height, smoothness);
}

function zoneField(wx, wz) {
    const coarse = perlin(wx * 0.0008, wz * 0.0008);
    const warp = perlin((wx + 700) * 0.003, (wz - 1200) * 0.003);
    return coarse * 0.75 + warp * 0.25;
}

function cityMask(wx, wz) {
    const field = zoneField(wx, wz);
    const rings = perlin((wx + 1200) * 0.002, (wz - 800) * 0.002) * 0.12;
    const edgeNoise = perlin(wx * 0.008, wz * 0.008) * 0.15;
    const intensity = Math.max(-1, Math.min(1, (field * 0.8 + rings + edgeNoise) * 0.85 + 0.25));

    // Smoothstep
    const t = (intensity - (CONFIG.cityThreshold - 0.15)) / 0.3;
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
}

export function getCityInfluence(wx, wz) {
    return cityMask(wx, wz);
}

function calculateNaturalTerrainHeight(wx, wz) {
    // Apply domain warping for organic terrain
    const warped = domainWarp(wx, wz, 15);
    const wx2 = warped.x;
    const wz2 = warped.z;

    // 1. Continental scale
    const continental = fbm(wx * 0.0015, wz * 0.0015, 3, 2.0, 0.5) * 18;

    // 2. Regional scale - mountains, valleys, plateaus
    const mountains = fbm(wx2 * 0.005, wz2 * 0.005, 6, 2.2, 0.48) * 15;
    const plateauNoise = perlin(wx * 0.004, wz * 0.004);
    const plateauMask = plateau(plateauNoise, 3);
    const plateauHeight = plateauMask > 0.3 ? terrace(plateauMask * 12, 4, 0.2) : 0;

    // 3. Local hills and valleys
    const hills = fbm(wx * 0.015, wz * 0.015, 4, 2.1, 0.5) * 8;

    // 4. Ridge systems
    const ridgeNoise1 = ridge(perlin(wx * 0.008, wz * 0.008));
    const ridgeNoise2 = ridge(perlin((wx + 1000) * 0.012, (wz - 500) * 0.012));
    const ridgeHeight = (ridgeNoise1 * 8 + ridgeNoise2 * 5) *
                       (1 + turbulence(wx * 0.02, wz * 0.02, 2) * 0.3);

    // 5. Micro detail
    const detail = fbm(wx * 0.04, wz * 0.04, 3, 2.5, 0.5) * 2.5;
    const microDetail = turbulence(wx * 0.08, wz * 0.08, 2) * 1.2;

    // River/valley systems
    const riverFlow1 = ridge(perlin(wx * 0.003, wz * 0.003));
    const riverFlow2 = ridge(perlin((wx + 500) * 0.0025, (wz + 500) * 0.0025));
    const riverCarve = Math.min(riverFlow1, riverFlow2);
    const riverDepth = Math.pow(1 - riverCarve, 3) * -8;

    // Canyon systems
    const canyonNoise = perlin(wx * 0.002, wz * 0.002);
    const canyonMask = canyonNoise > 0.4 ? 1 : 0;
    const canyonDepth = canyonMask * Math.pow(ridge(perlin(wx * 0.015, wz * 0.015)), 2) * -12;

    // Combine all layers
    let height = continental + mountains + plateauHeight + hills +
                 ridgeHeight + detail + microDetail +
                 riverDepth + canyonDepth;

    // Dramatic cliffs
    const cliffMask = turbulence(wx * 0.006, wz * 0.006, 3);
    if (cliffMask > 1.5) {
        height += (cliffMask - 1.5) * 6;
    }

    // Minimum height (ocean floor)
    height = Math.max(height, -30);

    return height;
}

export function getTerrainHeight(wx, wz) {
    const naturalHeight = calculateNaturalTerrainHeight(wx, wz);
    const cityInfluence = getCityInfluence(wx, wz);

    // City flattening
    if (cityInfluence >= CONFIG.cityInfluenceThreshold) {
        const plateauBlend = Math.min(1, cityInfluence * 1.35);
        return lerp(naturalHeight, CONFIG.cityPlateauHeight, plateauBlend);
    }

    return naturalHeight;
}

// Terrain normal for slope calculations
export function getTerrainNormal(wx, wz) {
    const eps = 0.5;
    const hL = getTerrainHeight(wx - eps, wz);
    const hR = getTerrainHeight(wx + eps, wz);
    const hD = getTerrainHeight(wx, wz - eps);
    const hU = getTerrainHeight(wx, wz + eps);

    const x = hL - hR;
    const y = 2 * eps;
    const z = hD - hU;
    const len = Math.sqrt(x*x + y*y + z*z);

    return { x: x/len, y: y/len, z: z/len };
}
