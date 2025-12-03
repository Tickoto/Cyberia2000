// Inventory System
// Manages player's collected items and inventory UI

import { getItem } from './items/item-loader.js';

export class Inventory {
    constructor() {
        this.items = new Map(); // itemId -> quantity
        this.maxCapacity = 50;
        this.listeners = [];
    }

    addItem(itemId, quantity = 1) {
        const item = getItem(itemId);
        if (!item) {
            console.warn(`[Inventory] Cannot add unknown item: ${itemId}`);
            return false;
        }

        const currentQty = this.items.get(itemId) || 0;
        const totalItems = this.getTotalItems();

        if (totalItems + quantity > this.maxCapacity) {
            console.warn(`[Inventory] Capacity exceeded. Cannot add ${quantity} of ${item.name}`);
            return false;
        }

        this.items.set(itemId, currentQty + quantity);
        this.notifyListeners('add', item, quantity);
        console.log(`[Inventory] Added ${quantity}x ${item.name}`);
        return true;
    }

    removeItem(itemId, quantity = 1) {
        const item = getItem(itemId);
        if (!item) return false;

        const currentQty = this.items.get(itemId) || 0;
        if (currentQty < quantity) {
            console.warn(`[Inventory] Not enough items. Have ${currentQty}, tried to remove ${quantity}`);
            return false;
        }

        const newQty = currentQty - quantity;
        if (newQty <= 0) {
            this.items.delete(itemId);
        } else {
            this.items.set(itemId, newQty);
        }

        this.notifyListeners('remove', item, quantity);
        console.log(`[Inventory] Removed ${quantity}x ${item.name}`);
        return true;
    }

    hasItem(itemId, quantity = 1) {
        const currentQty = this.items.get(itemId) || 0;
        return currentQty >= quantity;
    }

    getItemQuantity(itemId) {
        return this.items.get(itemId) || 0;
    }

    getTotalItems() {
        let total = 0;
        this.items.forEach(qty => total += qty);
        return total;
    }

    getItems() {
        const result = [];
        this.items.forEach((quantity, itemId) => {
            const item = getItem(itemId);
            if (item) {
                result.push({ item, quantity });
            }
        });
        return result;
    }

    clear() {
        this.items.clear();
        this.notifyListeners('clear', null, 0);
    }

    // Event system
    addListener(callback) {
        this.listeners.push(callback);
    }

    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    notifyListeners(action, item, quantity) {
        this.listeners.forEach(callback => {
            callback(action, item, quantity);
        });
    }

    // Serialization
    toJSON() {
        return {
            items: Array.from(this.items.entries()),
            maxCapacity: this.maxCapacity
        };
    }

    fromJSON(data) {
        this.items.clear();
        if (data.items) {
            data.items.forEach(([itemId, quantity]) => {
                this.items.set(itemId, quantity);
            });
        }
        if (data.maxCapacity) {
            this.maxCapacity = data.maxCapacity;
        }
        this.notifyListeners('load', null, 0);
    }
}

// Inventory UI Manager
export class InventoryUI {
    constructor(inventory) {
        this.inventory = inventory;
        this.isOpen = false;
        this.container = null;
        this.createUI();

        // Listen to inventory changes
        this.inventory.addListener((action, item, quantity) => {
            this.updateUI();
        });
    }

    createUI() {
        // Create inventory container
        this.container = document.createElement('div');
        this.container.id = 'inventory-panel';
        this.container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 600px;
            max-height: 70vh;
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid #00ff88;
            padding: 20px;
            font-family: 'VT323', monospace;
            color: #00ff88;
            display: none;
            z-index: 10000;
            overflow-y: auto;
        `;

        // Create header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 1px solid #00ff88;
            padding-bottom: 10px;
        `;

        const title = document.createElement('h2');
        title.textContent = 'INVENTORY';
        title.style.cssText = 'margin: 0; font-size: 28px;';

        const capacity = document.createElement('span');
        capacity.id = 'inventory-capacity';
        capacity.style.cssText = 'font-size: 20px;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '[ESC] CLOSE';
        closeBtn.style.cssText = `
            background: transparent;
            border: 1px solid #00ff88;
            color: #00ff88;
            padding: 5px 10px;
            font-family: 'VT323', monospace;
            font-size: 18px;
            cursor: pointer;
        `;
        closeBtn.onclick = () => this.close();

        header.appendChild(title);
        header.appendChild(capacity);
        header.appendChild(closeBtn);

        // Create items list
        const itemsList = document.createElement('div');
        itemsList.id = 'inventory-items';
        itemsList.style.cssText = 'margin-top: 10px;';

        this.container.appendChild(header);
        this.container.appendChild(itemsList);
        document.body.appendChild(this.container);
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        this.container.style.display = 'block';
        this.updateUI();
    }

    close() {
        this.isOpen = false;
        this.container.style.display = 'none';
    }

    updateUI() {
        if (!this.isOpen) return;

        // Update capacity
        const capacityEl = document.getElementById('inventory-capacity');
        if (capacityEl) {
            const total = this.inventory.getTotalItems();
            capacityEl.textContent = `${total}/${this.inventory.maxCapacity}`;
        }

        // Update items list
        const itemsList = document.getElementById('inventory-items');
        if (!itemsList) return;

        itemsList.innerHTML = '';

        const items = this.inventory.getItems();

        if (items.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.textContent = 'No items in inventory';
            emptyMsg.style.cssText = 'text-align: center; padding: 40px; opacity: 0.5;';
            itemsList.appendChild(emptyMsg);
            return;
        }

        // Sort by rarity and name
        items.sort((a, b) => {
            const rarityOrder = { legendary: 0, rare: 1, common: 2 };
            const rarityDiff = (rarityOrder[a.item.rarity] || 2) - (rarityOrder[b.item.rarity] || 2);
            if (rarityDiff !== 0) return rarityDiff;
            return a.item.name.localeCompare(b.item.name);
        });

        items.forEach(({ item, quantity }) => {
            const itemEl = this.createItemElement(item, quantity);
            itemsList.appendChild(itemEl);
        });
    }

    createItemElement(item, quantity) {
        const el = document.createElement('div');
        el.style.cssText = `
            background: rgba(0, 255, 136, 0.1);
            border: 1px solid #00ff88;
            padding: 10px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: background 0.2s;
        `;

        el.onmouseenter = () => {
            el.style.background = 'rgba(0, 255, 136, 0.2)';
        };
        el.onmouseleave = () => {
            el.style.background = 'rgba(0, 255, 136, 0.1)';
        };

        const rarityColors = {
            common: '#888888',
            rare: '#00aaff',
            legendary: '#ff00ff'
        };

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 5px;';

        const name = document.createElement('span');
        name.textContent = item.name;
        name.style.cssText = `font-size: 20px; color: ${rarityColors[item.rarity] || '#00ff88'};`;

        const qtyBadge = document.createElement('span');
        qtyBadge.textContent = `x${quantity}`;
        qtyBadge.style.cssText = 'font-size: 18px; opacity: 0.8;';

        header.appendChild(name);
        header.appendChild(qtyBadge);

        const desc = document.createElement('div');
        desc.textContent = item.description || 'No description';
        desc.style.cssText = 'font-size: 14px; opacity: 0.7; margin-top: 5px;';

        const meta = document.createElement('div');
        meta.style.cssText = 'margin-top: 5px; font-size: 14px; opacity: 0.6;';
        meta.textContent = `Category: ${item.category} | Rarity: ${item.rarity} | Energy: ${item.energy}`;

        el.appendChild(header);
        el.appendChild(desc);
        el.appendChild(meta);

        return el;
    }
}

// Global inventory instance
export const playerInventory = new Inventory();
export const inventoryUI = new InventoryUI(playerInventory);
