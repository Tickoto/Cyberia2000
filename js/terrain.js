import { CONFIG, BIOMES, CITY_BIOME, URBAN_BIOMES, getUrbanBiomeType } from './config.js';
import { evaluateCityHeight, evaluateUrbanRamp } from './city-terrain-regulator.js';

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

export function hash(x, z) {
    return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

export function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function gradient(ix, iz) {
    const angle = 2 * Math.PI * hash(ix, iz);
    return { x: Math.cos(angle), z: Math.sin(angle) };
}

// Terrain generation is expensive and often queried with the same coordinates.
// A small cache massively reduces the amount of repeated noise work when building
// geometry for adjacent chunks or when sampling normals.
const HEIGHT_CACHE = new Map();
const HEIGHT_CACHE_LIMIT = 25000;

function cacheKey(wx, wz) {
    return `${Math.round(wx * 10) / 10},${Math.round(wz * 10) / 10}`;
}

function setCachedHeight(key, value) {
    if (HEIGHT_CACHE.size > HEIGHT_CACHE_LIMIT) {
        // Avoid unbounded growth by clearing in chunks
        HEIGHT_CACHE.clear();
    }
    HEIGHT_CACHE.set(key, value);
}

function getCachedHeight(wx, wz) {
    const key = cacheKey(wx, wz);
    if (HEIGHT_CACHE.has(key)) {
        return HEIGHT_CACHE.get(key);
    }
    return { cached: false, key };
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

// A more directed fbm variant that allows distinct per-axis stretching. This helps
// produce believable valley floors that align with city streets and coastal cliffs.
function anisotropicFbm(x, z, options = {}) {
    const { octaves = 5, lacunarity = 2.1, gain = 0.52, stretchX = 1, stretchZ = 1 } = options;
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    for (let i = 0; i < octaves; i++) {
        const nx = x * frequency * stretchX;
        const nz = z * frequency * stretchZ;
        sum += amplitude * perlin(nx, nz);
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return sum;
}

// Turbulence function for more chaotic terrain
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

// Warped domain for more organic terrain
function domainWarp(x, z, strength = 10) {
    const offsetX = perlin(x * 0.01, z * 0.01) * strength;
    const offsetZ = perlin((x + 100) * 0.01, (z + 100) * 0.01) * strength;
    return { x: x + offsetX, z: z + offsetZ };
}

// Helper used for slope-aware flattening. Returns a tuple of {height, normal}
// using a small finite difference.
function sampleHeightAndNormal(fn, wx, wz, epsilon = 0.65) {
    const h = fn(wx, wz);
    const hx = fn(wx + epsilon, wz) - fn(wx - epsilon, wz);
    const hz = fn(wx, wz + epsilon) - fn(wx, wz - epsilon);
    const normal = new THREE.Vector3(-hx, 2 * epsilon, -hz).normalize();
    return { height: h, normal, slope: Math.sqrt(hx * hx + hz * hz) / (2 * epsilon) };
}

// Plateau/mesa formation function
function plateau(height, sharpness = 4) {
    const normalized = (height + 1) * 0.5; // Convert from [-1,1] to [0,1]
    return Math.pow(normalized, sharpness) * 2 - 1;
}

// Terracing function for stepped plateaus
function terrace(height, steps = 5, smoothness = 0.3) {
    const stepped = Math.floor(height * steps) / steps;
    return lerp(stepped, height, smoothness);
}

// Moisture/temperature fields used to shape biome transitions and terrain height.
function moistureField(wx, wz) {
    const macro = perlin(wx * 0.0004, wz * 0.0004);
    const micro = perlin((wx + 900) * 0.006, (wz - 400) * 0.006) * 0.3;
    return THREE.MathUtils.clamp((macro * 0.7 + micro) * 0.5 + 0.5, 0, 1);
}

function temperatureField(wx, wz) {
    const lat = Math.sin(wz * 0.0002) * 0.4;
    const altitudeEffect = getCityInfluence(wx, wz) > 0.2 ? -0.05 : 0; // Urban heat islands
    const noise = perlin(wx * 0.0006, wz * 0.0006) * 0.2;
    return THREE.MathUtils.clamp(0.6 + lat + noise + altitudeEffect, 0, 1);
}

// Erosion mask that softens high slopes and deep ravines to prevent extreme steps
// when a city flattens terrain nearby.
function erosionMask(wx, wz) {
    const base = turbulence(wx * 0.012, wz * 0.012, 3);
    const ridges = ridge(perlin(wx * 0.01, wz * 0.01));
    return THREE.MathUtils.clamp((base + ridges) * 0.35, 0, 1);
}

function biomeAt(cx, cz) {
    const noise = perlin((cx + CONFIG.biomeSeed) * 0.06, (cz + CONFIG.biomeSeed) * 0.06);
    const index = Math.abs(Math.floor((noise + 1) * 0.5 * BIOMES.length)) % BIOMES.length;
    return BIOMES[index];
}

function riverMask(wx, wz) {
    const flow = ridge(Math.abs(perlin(wx * 0.004, wz * 0.004)));
    return Math.pow(1 - flow, 2);
}

function zoneField(wx, wz) {
    const coarse = perlin(wx * 0.0008, wz * 0.0008);
    const warp = perlin((wx + 700) * 0.003, (wz - 1200) * 0.003);
    const combined = (coarse * 0.75 + warp * 0.25);
    return combined;
}

function blendedBiome(wx, wz) {
    const cityInfluence = getCityInfluence(wx, wz);

    // Check for urban biomes based on influence intensity
    const urbanBiome = getUrbanBiomeType(cityInfluence);
    if (urbanBiome) {
        return urbanBiome;
    }

    // Legacy fallback for backward compatibility
    if (cityInfluence >= CONFIG.cityInfluenceThreshold * 0.85) {
        return CITY_BIOME;
    }

    const size = CONFIG.chunkSize;
    const cx = Math.floor(wx / size);
    const cz = Math.floor(wz / size);
    const biome = biomeAt(cx, cz);
    const neighbors = [
        biomeAt(cx + 1, cz),
        biomeAt(cx - 1, cz),
        biomeAt(cx, cz + 1),
        biomeAt(cx, cz - 1)
    ];

    const lx = wx - cx * size;
    const lz = wz - cz * size;
    const tx = Math.min(lx / size, 1 - lx / size);
    const tz = Math.min(lz / size, 1 - lz / size);
    const edge = Math.min(tx, tz);
    const blendStrength = THREE.MathUtils.smoothstep(edge, 0, CONFIG.edgeBlendDistance / size);

    const mixTarget = neighbors[Math.floor(hash(cx, cz) * neighbors.length)];
    return blendBiomes(biome, mixTarget, blendStrength);
}

function blendBiomes(a, b, t) {
    if (!b) return a;
    return {
        key: `${a.key}_${b.key}`,
        label: t > 0.5 ? b.label : a.label,
        primaryColor: t > 0.5 ? b.primaryColor : a.primaryColor,
        altitudeBias: lerp(a.altitudeBias, b.altitudeBias, t),
        humidity: lerp(a.humidity, b.humidity, t),
        flora: t > 0.5 ? b.flora : a.flora,
        ambientSound: t > 0.5 ? b.ambientSound : a.ambientSound
    };
}

function cityMask(wx, wz) {
    const field = zoneField(wx, wz);
    const rings = perlin((wx + 1200) * 0.002, (wz - 800) * 0.002) * 0.12;
    const edgeNoise = perlin(wx * 0.008, wz * 0.008) * 0.15;
    const intensity = THREE.MathUtils.clamp((field * 0.8 + rings + edgeNoise) * 0.85 + 0.25, -1, 1);
    return THREE.MathUtils.smoothstep(intensity, CONFIG.cityThreshold - 0.15, CONFIG.cityThreshold + 0.15);
}

export function getCityInfluence(wx, wz) {
    return cityMask(wx, wz);
}

export function calculateNaturalTerrainHeight(wx, wz) {
    const cached = getCachedHeight(wx, wz);
    if (cached.cached === true) {
        return cached.height;
    }

    const biome = blendedBiome(wx, wz);

    // Apply domain warping for more organic, natural-looking terrain
    const warped = domainWarp(wx, wz, 15);
    const wx2 = warped.x;
    const wz2 = warped.z;

    // Multi-scale terrain generation
    // 1. Continental scale - large landmasses, ocean trenches
    const continental = fbm(wx * 0.0015, wz * 0.0015, 3, 2.0, 0.5) * 18;

    // 2. Regional scale - mountains, valleys, plateaus
    const mountains = fbm(wx2 * 0.005, wz2 * 0.005, 6, 2.2, 0.48) * 15;
    const plateauNoise = perlin(wx * 0.004, wz * 0.004);
    const plateauMask = plateau(plateauNoise, 3);
    const plateauHeight = plateauMask > 0.3 ? terrace(plateauMask * 12, 4, 0.2) : 0;

    // 3. Local hills and valleys
    const hills = fbm(wx * 0.015, wz * 0.015, 4, 2.1, 0.5) * 8;

    // 4. Ridge systems - create dramatic mountain ridges
    const ridgeNoise1 = ridge(perlin(wx * 0.008, wz * 0.008));
    const ridgeNoise2 = ridge(perlin((wx + 1000) * 0.012, (wz - 500) * 0.012));
    const ridgeHeight = (ridgeNoise1 * 8 + ridgeNoise2 * 5) *
                       (1 + turbulence(wx * 0.02, wz * 0.02, 2) * 0.3);

    // 5. Micro detail - small bumps and variations
    const detail = fbm(wx * 0.04, wz * 0.04, 3, 2.5, 0.5) * 2.5;
    const microDetail = turbulence(wx * 0.08, wz * 0.08, 2) * 1.2;

    // Biome-specific modifications
    const biomeOffset = biome.altitudeBias * 12;

    // Enhanced river/valley systems
    const riverFlow1 = ridge(perlin(wx * 0.003, wz * 0.003));
    const riverFlow2 = ridge(perlin((wx + 500) * 0.0025, (wz + 500) * 0.0025));
    const riverCarve = Math.min(riverFlow1, riverFlow2);
    const riverDepth = Math.pow(1 - riverCarve, 3) * -8;

    // Canyon systems in certain areas
    const canyonNoise = perlin(wx * 0.002, wz * 0.002);
    const canyonMask = canyonNoise > 0.4 ? 1 : 0;
    const canyonDepth = canyonMask * Math.pow(ridge(perlin(wx * 0.015, wz * 0.015)), 2) * -12;

    // Coastal shelves and dune bands, useful for smoother approaches into plains
    const shelfNoise = anisotropicFbm(wx * 0.002, wz * 0.002, { octaves: 3, stretchX: 0.7, stretchZ: 1.4 }) * 6;
    const duneNoise = anisotropicFbm(wx * 0.018, wz * 0.018, { octaves: 2, stretchX: 1.6, stretchZ: 0.8 }) * 1.2;

    // Climate driven adjustments (wetlands sink, frozen peaks are craggier)
    const moisture = moistureField(wx, wz);
    const temperature = temperatureField(wx, wz);
    const wetlandCarve = THREE.MathUtils.clamp((moisture - 0.6) * 10, 0, 1) * -3.5;
    const permafrostBonus = THREE.MathUtils.clamp((0.35 - temperature) * 6, 0, 1) * 5 * ridgeNoise1;
    const erosion = erosionMask(wx, wz) * -2.5;

    // Combine all layers
    let height = continental + mountains + plateauHeight + hills +
                 ridgeHeight + detail + microDetail + biomeOffset +
                 riverDepth + canyonDepth + shelfNoise + duneNoise +
                 wetlandCarve + permafrostBonus + erosion;

    // Add some dramatic cliffs using turbulence
    const cliffMask = turbulence(wx * 0.006, wz * 0.006, 3);
    if (cliffMask > 1.5) {
        height += (cliffMask - 1.5) * 6;
    }

    // Ensure minimum height (ocean floor)
    height = Math.max(height, -30);

    setCachedHeight(cached.key, { cached: true, height });
    return height;
}

export function getTerrainHeight(wx, wz) {
    const naturalHeight = calculateNaturalTerrainHeight(wx, wz);
    const cityInfluence = getCityInfluence(wx, wz);
    const cityProfile = evaluateCityHeight(wx, wz);
    const rampProfile = evaluateUrbanRamp(wx, wz, naturalHeight);

    // Get the appropriate urban biome based on influence
    const urbanBiome = getUrbanBiomeType(cityInfluence);

    // If we're in an urban biome, apply appropriate flattening using multiple stages:
    // 1. Strong flattening at the core (forcePlateau)
    // 2. Graded transition band that honors the source slope and builds ramps for roads
    // 3. Soft blend into natural terrain beyond city limits.
    if (urbanBiome) {
        const threshold = urbanBiome.influenceThreshold || CONFIG.cityInfluenceThreshold;
        const flatteningStrength = urbanBiome.key === 'megacity' ? 1.75 :
                                   urbanBiome.key === 'city' ? 1.45 :
                                   urbanBiome.key === 'town' ? 1.25 : 1.05;

        if (cityInfluence >= threshold && cityProfile.forcePlateau) {
            return CONFIG.cityPlateauHeight + rampProfile.heightOffset;
        }

        // Blend the plateau height with ramp-aware adjustments so that roads follow a
        // believable grade when climbing into hills.
        const plateauBlend = Math.min(1, cityProfile.blend * (cityInfluence * flatteningStrength));
        if (plateauBlend > 0) {
            const rampHeight = naturalHeight + rampProfile.heightOffset;
            const plateauTarget = CONFIG.cityPlateauHeight + rampProfile.heightOffset * 0.65;
            const blendFromSlope = THREE.MathUtils.clamp(rampProfile.slopeFactor * plateauBlend, 0, 1);
            const intermediate = lerp(naturalHeight, rampHeight, blendFromSlope);
            return lerp(intermediate, plateauTarget, plateauBlend);
        }
    }

    // Legacy fallback
    if (cityInfluence >= CONFIG.cityInfluenceThreshold && cityProfile.forcePlateau) {
        return CONFIG.cityPlateauHeight + rampProfile.heightOffset;
    }

    const plateauBlend = Math.min(1, cityProfile.blend * (cityInfluence * 1.35));
    if (plateauBlend > 0) {
        return lerp(naturalHeight, CONFIG.cityPlateauHeight + rampProfile.heightOffset * 0.4, plateauBlend);
    }

    return naturalHeight + rampProfile.heightOffset * rampProfile.outsideFalloff;
}

// Export function to get urban biome info at position
export function getUrbanBiomeAtPosition(wx, wz) {
    const cityInfluence = getCityInfluence(wx, wz);
    return getUrbanBiomeType(cityInfluence);
}

export function biomeInfoAtPosition(wx, wz) {
    return blendedBiome(wx, wz);
}

export function decorateTerrainNormal(wx, wz) {
    const eps = 0.5;
    const hL = getTerrainHeight(wx - eps, wz);
    const hR = getTerrainHeight(wx + eps, wz);
    const hD = getTerrainHeight(wx, wz - eps);
    const hU = getTerrainHeight(wx, wz + eps);
    const normal = new THREE.Vector3(hL - hR, 2 * eps, hD - hU);
    normal.normalize();
    return normal;
}

// Utility used heavily by the world manager to obtain both height and surface data.
// This ensures city ramps and edge smoothing are reused across systems (roads,
// building placement, physics sampler) without multiple identical calculations.
export function sampleTerrain(wx, wz) {
    const height = getTerrainHeight(wx, wz);
    const { normal, slope } = sampleHeightAndNormal(getTerrainHeight, wx, wz, 0.85);
    return { height, normal, slope };
}

// Exposed for tests and debugging: reset the internal height cache so that changes
// to generator parameters are immediately reflected without a full page refresh.
export function clearTerrainCache() {
    HEIGHT_CACHE.clear();
}

// Provide a verbose breakdown of the terrain layers for debugging or analytics.
// This can be consumed by developer tools to visualize why a specific coordinate
// ended up at its final elevation when biomes, cities, and erosion interact.
export function debugTerrainBreakdown(wx, wz) {
    const warped = domainWarp(wx, wz, 15);
    const continental = fbm(wx * 0.0015, wz * 0.0015, 3, 2.0, 0.5) * 18;
    const mountains = fbm(warped.x * 0.005, warped.z * 0.005, 6, 2.2, 0.48) * 15;
    const hills = fbm(wx * 0.015, wz * 0.015, 4, 2.1, 0.5) * 8;
    const ridgeNoise1 = ridge(perlin(wx * 0.008, wz * 0.008));
    const ridgeNoise2 = ridge(perlin((wx + 1000) * 0.012, (wz - 500) * 0.012));
    const ridgeHeight = (ridgeNoise1 * 8 + ridgeNoise2 * 5) * (1 + turbulence(wx * 0.02, wz * 0.02, 2) * 0.3);
    const detail = fbm(wx * 0.04, wz * 0.04, 3, 2.5, 0.5) * 2.5;
    const microDetail = turbulence(wx * 0.08, wz * 0.08, 2) * 1.2;
    const plateauNoise = perlin(wx * 0.004, wz * 0.004);
    const plateauMask = plateau(plateauNoise, 3);
    const plateauHeight = plateauMask > 0.3 ? terrace(plateauMask * 12, 4, 0.2) : 0;
    const riverFlow1 = ridge(perlin(wx * 0.003, wz * 0.003));
    const riverFlow2 = ridge(perlin((wx + 500) * 0.0025, (wz + 500) * 0.0025));
    const riverCarve = Math.min(riverFlow1, riverFlow2);
    const riverDepth = Math.pow(1 - riverCarve, 3) * -8;
    const canyonDepth = (perlin(wx * 0.002, wz * 0.002) > 0.4 ? 1 : 0) * Math.pow(ridge(perlin(wx * 0.015, wz * 0.015)), 2) * -12;
    const shelfNoise = anisotropicFbm(wx * 0.002, wz * 0.002, { octaves: 3, stretchX: 0.7, stretchZ: 1.4 }) * 6;
    const duneNoise = anisotropicFbm(wx * 0.018, wz * 0.018, { octaves: 2, stretchX: 1.6, stretchZ: 0.8 }) * 1.2;
    const moisture = moistureField(wx, wz);
    const temperature = temperatureField(wx, wz);
    const wetlandCarve = THREE.MathUtils.clamp((moisture - 0.6) * 10, 0, 1) * -3.5;
    const permafrostBonus = THREE.MathUtils.clamp((0.35 - temperature) * 6, 0, 1) * 5 * ridgeNoise1;
    const erosion = erosionMask(wx, wz) * -2.5;

    const cityInfluence = getCityInfluence(wx, wz);
    const cityProfile = evaluateCityHeight(wx, wz);
    const rampProfile = evaluateUrbanRamp(wx, wz, 0);

    return {
        layers: {
            continental,
            mountains,
            hills,
            plateauHeight,
            ridges: ridgeHeight,
            detail,
            microDetail,
            rivers: riverDepth,
            canyon: canyonDepth,
            shelfNoise,
            duneNoise,
            wetlandCarve,
            permafrostBonus,
            erosion
        },
        climate: { moisture, temperature },
        city: { influence: cityInfluence, plateau: cityProfile, ramp: rampProfile }
    };
}

// Helper to sample a grid of heights for an entire chunk. This is primarily used in
// higher-level systems that need to plan multi-chunk structures (highways, rivers)
// without recomputing the expensive height logic on every query.
export function sampleChunkGrid(cx, cz, resolution = 12) {
    const ox = cx * CONFIG.chunkSize;
    const oz = cz * CONFIG.chunkSize;
    const step = CONFIG.chunkSize / (resolution - 1);
    const grid = [];
    for (let ix = 0; ix < resolution; ix++) {
        const row = [];
        for (let iz = 0; iz < resolution; iz++) {
            const wx = ox + ix * step;
            const wz = oz + iz * step;
            row.push(sampleTerrain(wx, wz));
        }
        grid.push(row);
    }
    return { origin: { x: ox, z: oz }, step, grid };
}

// Light-weight textual summary for on-screen diagnostics. This keeps UI code
// simple while still exposing the most important signals for a location.
export function getTerrainDebugString(wx, wz) {
    const biome = blendedBiome(wx, wz);
    const cityInfluence = getCityInfluence(wx, wz);
    const height = getTerrainHeight(wx, wz);
    const slope = sampleTerrain(wx, wz).slope;
    const components = [
        `biome:${biome.label}`,
        `city:${cityInfluence.toFixed(2)}`,
        `height:${height.toFixed(2)}`,
        `slope:${slope.toFixed(2)}`
    ];
    const urbanBiome = getUrbanBiomeType(cityInfluence);
    if (urbanBiome) {
        components.push(`urban:${urbanBiome.key}`);
    }
    return components.join(' | ');
}

// Convenience gradient sampler for AI agents that need to choose traversable paths
// without invoking the full physics stack.
export function terrainGradient(wx, wz, delta = 0.75) {
    const hL = getTerrainHeight(wx - delta, wz);
    const hR = getTerrainHeight(wx + delta, wz);
    const hD = getTerrainHeight(wx, wz - delta);
    const hU = getTerrainHeight(wx, wz + delta);
    return {
        dx: (hR - hL) / (2 * delta),
        dz: (hU - hD) / (2 * delta)
    };
}
