// Item Loader System
// This module loads all items and manages item registration

import { INTERACTIVE_OBJECTS } from '../interactive-objects.js';
import { getItemsForBiome as filterItemsByBiome, getBiomeSpawnWeight } from './biome-items-config.js';

class ItemRegistry {
    constructor() {
        this.items = new Map();
        this.itemsByCategory = new Map();
        this.itemsByRarity = new Map();
        this.itemsByBiome = new Map();
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        // Load all items from the legacy system
        INTERACTIVE_OBJECTS.forEach(item => {
            this.registerItem(item);
        });

        // Build biome-specific caches
        this.buildBiomeCaches();

        this.initialized = true;
        console.log(`[ItemRegistry] Loaded ${this.items.size} items`);
    }

    registerItem(item) {
        // Add to main registry
        this.items.set(item.id, item);

        // Add to category index
        if (!this.itemsByCategory.has(item.category)) {
            this.itemsByCategory.set(item.category, []);
        }
        this.itemsByCategory.get(item.category).push(item);

        // Add to rarity index
        if (!this.itemsByRarity.has(item.rarity)) {
            this.itemsByRarity.set(item.rarity, []);
        }
        this.itemsByRarity.get(item.rarity).push(item);
    }

    buildBiomeCaches() {
        const biomes = ['wasteland', 'marsh', 'highlands', 'crystal', 'oasis',
                       'volcanic', 'tundra', 'jungle', 'corrupted', 'bioluminescent'];

        biomes.forEach(biomeKey => {
            const items = filterItemsByBiome(biomeKey, Array.from(this.items.values()));
            this.itemsByBiome.set(biomeKey, items);
        });
    }

    getItem(id) {
        return this.items.get(id);
    }

    getItemsByCategory(category) {
        return this.itemsByCategory.get(category) || [];
    }

    getItemsByRarity(rarity) {
        return this.itemsByRarity.get(rarity) || [];
    }

    getItemsForBiome(biomeKey) {
        return this.itemsByBiome.get(biomeKey) || Array.from(this.items.values());
    }

    getAllItems() {
        return Array.from(this.items.values());
    }

    getRandomItemForBiome(biomeKey, rng = Math.random) {
        const items = this.getItemsForBiome(biomeKey);
        if (items.length === 0) return null;

        // Apply rarity weighting
        const rarityRoll = rng();
        let targetRarity = 'common';
        if (rarityRoll > 0.95) targetRarity = 'legendary';
        else if (rarityRoll > 0.75) targetRarity = 'rare';

        // Try to get an item of target rarity from this biome
        const rarityFiltered = items.filter(i => i.rarity === targetRarity);
        if (rarityFiltered.length > 0) {
            const index = Math.floor(rng() * rarityFiltered.length);
            return rarityFiltered[index];
        }

        // Fallback to any item
        const index = Math.floor(rng() * items.length);
        return items[index];
    }

    getCategoryStats() {
        const stats = {};
        this.itemsByCategory.forEach((items, category) => {
            stats[category] = items.length;
        });
        return stats;
    }

    getRarityStats() {
        const stats = {};
        this.itemsByRarity.forEach((items, rarity) => {
            stats[rarity] = items.length;
        });
        return stats;
    }
}

// Global singleton instance
export const itemRegistry = new ItemRegistry();

// Initialize on import
itemRegistry.initialize();

// Export for convenience
export function getItem(id) {
    return itemRegistry.getItem(id);
}

export function getItemsForBiome(biomeKey) {
    return itemRegistry.getItemsForBiome(biomeKey);
}

export function getRandomItemForBiome(biomeKey, rng) {
    return itemRegistry.getRandomItemForBiome(biomeKey, rng);
}

export function getAllItems() {
    return itemRegistry.getAllItems();
}
