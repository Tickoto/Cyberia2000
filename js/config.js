export const CONFIG = {
    chunkSize: 200,
    renderDistance: 2,
    cityThreshold: 0.45,
    cityInfluenceThreshold: 0.35,
    cityPlateauHeight: 1.1,
    gravity: 38.5,
    terminalVelocity: 150,
    speed: 20.0,
    runSpeed: 35.0,
    crouchSpeed: 12.0,
    jumpSpeed: 15.5,
    groundAccel: 10.0,
    airAccel: 4.25,
    groundFriction: 10.0,
    airDrag: 0.35,
    slopeLimit: 0.92,
    stepHeight: 0.75,
    edgeBlendDistance: 18,
    interactionRange: 18,
    interactionScanAngle: Math.PI / 5,
    objectDensity: 0.35,
    rareObjectChance: 0.08,
    biomeSeed: 7777,
    dayLength: 720,
    weatherChangeInterval: 240,
    ambientWindBase: 0.3,
    ambientWindVariance: 0.55,
    hazardTickInterval: 5,
    staminaDrainRate: 6,
    staminaRecoveryRate: 10,
    maxStamina: 100,
    cameraLag: 0.35,

    // Networking
    networkServerUrl: 'ws://192.168.1.2:8080',
    networkUpdateRate: 50,           // ms between network updates
    networkInterpolationDelay: 100,  // ms delay for smooth interpolation
    networkEnabled: true
};

// Legacy single city biome (for backward compatibility)
export const CITY_BIOME = {
    key: 'city',
    label: 'Urban Expanse',
    primaryColor: '#1a1a1a',
    altitudeBias: 0,
    humidity: 0.35,
    flora: ['street tree', 'planter shrub', 'plaza grass'],
    ambientSound: 'hum'
};

// Urban biome types - scalable from small villages to megacities
export const URBAN_BIOMES = {
    village: {
        key: 'village',
        label: 'Rural Village',
        primaryColor: '#2a3a2a',
        altitudeBias: 0,
        humidity: 0.45,
        flora: ['oak tree', 'garden shrub', 'wheat patch', 'hay bale'],
        ambientSound: 'birds',
        // Village-specific settings
        minBlocks: 2,
        maxBlocks: 4,
        blockSize: 45,
        roadWidth: 12,
        buildingMinHeight: 4,
        buildingMaxHeight: 12,
        buildingDensity: 0.5,   // Fewer buildings, more open space
        parkChance: 0.35,       // More parks/farms
        flatRadius: 150,        // Radius of flat terrain around center
        flatFalloff: 50,        // How quickly terrain returns to normal
        influenceThreshold: 0.65,
        populationDensity: 'sparse'
    },
    town: {
        key: 'town',
        label: 'Town Center',
        primaryColor: '#252525',
        altitudeBias: 0,
        humidity: 0.40,
        flora: ['street tree', 'hedge row', 'flower planter'],
        ambientSound: 'chatter',
        // Town-specific settings
        minBlocks: 4,
        maxBlocks: 8,
        blockSize: 55,
        roadWidth: 16,
        buildingMinHeight: 8,
        buildingMaxHeight: 35,
        buildingDensity: 0.65,
        parkChance: 0.25,
        flatRadius: 300,
        flatFalloff: 80,
        influenceThreshold: 0.55,
        populationDensity: 'moderate'
    },
    city: {
        key: 'city',
        label: 'Urban District',
        primaryColor: '#1a1a1a',
        altitudeBias: 0,
        humidity: 0.35,
        flora: ['street tree', 'planter shrub', 'plaza grass'],
        ambientSound: 'traffic',
        // City-specific settings
        minBlocks: 8,
        maxBlocks: 16,
        blockSize: 65,
        roadWidth: 20,
        buildingMinHeight: 20,
        buildingMaxHeight: 100,
        buildingDensity: 0.75,
        parkChance: 0.18,
        flatRadius: 600,
        flatFalloff: 120,
        influenceThreshold: 0.45,
        populationDensity: 'dense'
    },
    megacity: {
        key: 'megacity',
        label: 'Megacity Core',
        primaryColor: '#0f0f0f',
        altitudeBias: 0,
        humidity: 0.30,
        flora: ['rooftop garden', 'vertical farm', 'hydroponic bay'],
        ambientSound: 'machinery',
        // Megacity-specific settings
        minBlocks: 16,
        maxBlocks: 32,
        blockSize: 80,
        roadWidth: 28,
        buildingMinHeight: 50,
        buildingMaxHeight: 220,
        buildingDensity: 0.90,
        parkChance: 0.08,
        flatRadius: 1200,
        flatFalloff: 200,
        influenceThreshold: 0.30,
        populationDensity: 'extreme',
        // Megacity special features
        hasElevatedRoads: true,
        hasSubways: true,
        hasSkyBridges: true
    }
};

// Function to get urban biome type based on influence strength
// This should be called once per settlement/chunk to determine the settlement type,
// NOT per-vertex or per-building to avoid morphing between types
export function getUrbanBiomeType(influence, centerDistance = 0) {
    // Determine urban biome based on influence intensity
    // Higher influence = larger settlement type
    // Use discrete thresholds to avoid morphing between types
    if (influence >= 0.85) {
        return URBAN_BIOMES.megacity;
    } else if (influence >= 0.65) {
        return URBAN_BIOMES.city;
    } else if (influence >= 0.50) {
        return URBAN_BIOMES.town;
    } else if (influence >= 0.35) {
        return URBAN_BIOMES.village;
    }
    return null;
}

// Get urban biome type for a chunk based on its center influence
// This ensures consistent settlement type across the entire chunk
export function getUrbanBiomeForChunk(chunkCenterInfluence) {
    return getUrbanBiomeType(chunkCenterInfluence);
}

// Function to determine urban biome at a world position
export function getUrbanBiomeAtPosition(wx, wz, influence) {
    return getUrbanBiomeType(influence);
}

export const FACTIONS = [
    { name: "Iron Legion", color: 0xcc0000, key: 'red' },
    { name: "Cyber Syndicate", color: 0x00cc00, key: 'green' },
    { name: "Azure Alliance", color: 0x0044cc, key: 'blue' }
];

export const BIOMES = [
    {
        key: 'wasteland',
        label: 'Cracked Wasteland',
        primaryColor: '#2a4a2a',
        altitudeBias: 0.1,
        humidity: 0.2,
        flora: ['charred stump', 'ashen shrub', 'rusted sign'],
        ambientSound: 'wind'
    },
    {
        key: 'marsh',
        label: 'Toxic Marsh',
        primaryColor: '#1f332a',
        altitudeBias: -0.15,
        humidity: 0.85,
        flora: ['bulb reed', 'glow lily', 'fungal bloom'],
        ambientSound: 'drip'
    },
    {
        key: 'highlands',
        label: 'Highlands',
        primaryColor: '#365d7a',
        altitudeBias: 0.35,
        humidity: 0.45,
        flora: ['pine cluster', 'rock shelf', 'sky vine'],
        ambientSound: 'gust'
    },
    {
        key: 'crystal',
        label: 'Crystaline Steppe',
        primaryColor: '#4a4a7a',
        altitudeBias: 0.05,
        humidity: 0.3,
        flora: ['crystal shard', 'prism bloom', 'lumen grass'],
        ambientSound: 'hum'
    },
    {
        key: 'oasis',
        label: 'Desert Oasis',
        primaryColor: '#5a4a2a',
        altitudeBias: -0.05,
        humidity: 0.6,
        flora: ['palm stalk', 'succulent', 'cattail'],
        ambientSound: 'water'
    },
    {
        key: 'volcanic',
        label: 'Volcanic Wastes',
        primaryColor: '#4a2a1a',
        altitudeBias: 0.25,
        humidity: 0.15,
        flora: ['obsidian spike', 'lava bloom', 'ash cluster'],
        ambientSound: 'rumble'
    },
    {
        key: 'tundra',
        label: 'Frozen Tundra',
        primaryColor: '#d0e0f0',
        altitudeBias: 0.15,
        humidity: 0.25,
        flora: ['frozen pine', 'ice crystal', 'snow drift'],
        ambientSound: 'wind'
    },
    {
        key: 'jungle',
        label: 'Overgrown Jungle',
        primaryColor: '#1a3a1a',
        altitudeBias: -0.08,
        humidity: 0.95,
        flora: ['vine tangle', 'giant fern', 'jungle pod'],
        ambientSound: 'rustling'
    },
    {
        key: 'corrupted',
        label: 'Corrupted Zone',
        primaryColor: '#3a1a3a',
        altitudeBias: 0.02,
        humidity: 0.5,
        flora: ['twisted root', 'void bloom', 'corruption spire'],
        ambientSound: 'static'
    },
    {
        key: 'bioluminescent',
        label: 'Bioluminescent Fields',
        primaryColor: '#1a3a4a',
        altitudeBias: -0.12,
        humidity: 0.7,
        flora: ['glow mushroom', 'light moss', 'neon frond'],
        ambientSound: 'pulse'
    }
];
