// Configuration mapping biomes to item categories and specific items
// This determines which items spawn in which biomes

export const BIOME_ITEM_CONFIG = {
    wasteland: {
        categories: ['training', 'utility', 'systems'],
        specificItems: ['obj_001', 'obj_002', 'obj_003', 'obj_004', 'obj_005'],
        weight: 1.0,
        description: 'Basic salvage and training equipment'
    },
    marsh: {
        categories: ['medical', 'agriculture', 'systems'],
        specificItems: ['obj_010', 'obj_011', 'obj_012'],
        weight: 0.9,
        description: 'Biological and medical equipment'
    },
    highlands: {
        categories: ['exploration', 'utility', 'systems'],
        specificItems: ['obj_020', 'obj_021', 'obj_022'],
        weight: 0.85,
        description: 'Survey and exploration gear'
    },
    crystal: {
        categories: ['research', 'hacking', 'systems'],
        specificItems: ['obj_030', 'obj_031', 'obj_032'],
        weight: 0.8,
        description: 'Advanced research equipment'
    },
    oasis: {
        categories: ['agriculture', 'commerce', 'systems'],
        specificItems: ['obj_040', 'obj_041', 'obj_042'],
        weight: 0.75,
        description: 'Trade and agricultural systems'
    },
    volcanic: {
        categories: ['manufacturing', 'resource', 'systems'],
        specificItems: ['obj_050', 'obj_051', 'obj_052'],
        weight: 0.7,
        description: 'Industrial equipment'
    },
    tundra: {
        categories: ['security', 'utility', 'systems'],
        specificItems: ['obj_060', 'obj_061', 'obj_062'],
        weight: 0.65,
        description: 'Cold-weather and security systems'
    },
    jungle: {
        categories: ['medical', 'agriculture', 'exploration', 'systems'],
        specificItems: ['obj_070', 'obj_071', 'obj_072'],
        weight: 0.6,
        description: 'Biological and exploration equipment'
    },
    corrupted: {
        categories: ['hacking', 'security', 'systems'],
        specificItems: ['obj_080', 'obj_081', 'obj_082'],
        weight: 0.55,
        description: 'Compromised and hacking equipment'
    },
    bioluminescent: {
        categories: ['research', 'medical', 'systems'],
        specificItems: ['obj_090', 'obj_091', 'obj_092'],
        weight: 0.5,
        description: 'Exotic research equipment'
    }
};

// Item rarity weights for spawning
export const RARITY_WEIGHTS = {
    common: 0.7,
    rare: 0.25,
    legendary: 0.05
};

// Get items that can spawn in a specific biome
export function getItemsForBiome(biomeKey, allItems) {
    const config = BIOME_ITEM_CONFIG[biomeKey];
    if (!config) return allItems;

    // Filter items by category or specific ID
    return allItems.filter(item => {
        // Check if item is specifically assigned to this biome
        if (config.specificItems.includes(item.id)) return true;

        // Check if item's category is allowed in this biome
        if (config.categories.includes(item.category)) return true;

        return false;
    });
}

// Get spawn weight for a biome (affects density)
export function getBiomeSpawnWeight(biomeKey) {
    return BIOME_ITEM_CONFIG[biomeKey]?.weight || 1.0;
}
