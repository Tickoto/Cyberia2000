import { CONFIG } from './config.js';
import { getRandomItemForBiome } from './items/item-loader.js';
import { seededRandom } from './terrain.js';
import { biomeInfoAtPosition } from './terrain.js';

export class InteractionManager {
    constructor(scene) {
        this.scene = scene;
        this.objects = new Map();
        this.activePrompt = null;
        this.heightSampler = (x, z) => 0;
        this.cooldowns = new Map();
        this.inventory = null; // Will be set by main.js
    }

    setHeightSampler(fn) {
        this.heightSampler = fn;
    }

    setInventory(inventory) {
        this.inventory = inventory;
    }

    generateForChunk(cx, cz) {
        const key = `${cx},${cz}`;
        if (this.objects.has(key)) return this.objects.get(key);

        const list = [];
        const baseSeed = (cx + 991) * 7919 + (cz + 37) * 2971;
        const count = Math.floor(6 + CONFIG.objectDensity * 14 * seededRandom(baseSeed));

        // Get biome at chunk center for biome-specific item spawning
        const centerX = cx * CONFIG.chunkSize + CONFIG.chunkSize / 2;
        const centerZ = cz * CONFIG.chunkSize + CONFIG.chunkSize / 2;
        const biome = biomeInfoAtPosition(centerX, centerZ);

        for (let i = 0; i < count; i++) {
            const seed = baseSeed + i * 17;

            // Use biome-specific item selection
            const def = getRandomItemForBiome(biome.key, () => seededRandom(seed));

            if (!def) continue; // Skip if no item available

            const x = cx * CONFIG.chunkSize + seededRandom(seed + 1) * CONFIG.chunkSize;
            const z = cz * CONFIG.chunkSize + seededRandom(seed + 2) * CONFIG.chunkSize;
            const y = this.heightSampler(x, z);
            const mesh = this.createMesh(def, seed);
            mesh.position.set(x, y, z);
            mesh.userData = { type: 'interactive', def, seed };
            list.push(mesh);
            this.scene.add(mesh);
        }

        this.objects.set(key, list);
        return list;
    }

    clearForChunk(key) {
        const entries = this.objects.get(key);
        if (!entries) return;
        entries.forEach(obj => this.scene.remove(obj));
        this.objects.delete(key);
    }

    createMesh(def, seed) {
        const group = new THREE.Group();
        const baseColor = new THREE.Color(def.rarity === 'legendary' ? '#ffd27d' : '#88aadd');
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(3 + seededRandom(seed) * 2, 4 + seededRandom(seed + 1) * 3, 3 + seededRandom(seed + 2) * 2),
            new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.4, roughness: 0.6 })
        );
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const glow = new THREE.Mesh(
            new THREE.TorusGeometry(2.4, 0.3, 12, 48),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(baseColor).offsetHSL(0.1, 0.2, 0.1) })
        );
        glow.rotation.x = Math.PI / 2;
        glow.position.y = (body.geometry.parameters.height || 4) * 0.55;
        group.add(glow);

        const label = this.makeLabel(def.name, def.rarity);
        label.position.y = (body.geometry.parameters.height || 4) + 1.25;
        group.add(label);

        return group;
    }

    makeLabel(text, rarity) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = '28px "VT323"';
        ctx.fillStyle = rarity === 'legendary' ? '#f4c542' : '#aeeaff';
        ctx.fillText(text, 12, 42);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
        sprite.scale.set(6, 1.5, 1);
        return sprite;
    }

    findClosest(player, camera) {
        const origin = camera.position.clone();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(camera.quaternion);
        const raycaster = new THREE.Raycaster(origin, direction, 0, CONFIG.interactionRange);
        raycaster.camera = camera;
        const hits = raycaster.intersectObjects(Array.from(this.objects.values()).flat(), true);
        if (!hits.length) return null;

        const target = hits.find(hit => {
            let obj = hit.object;
            while (obj && !obj.userData.type && obj.parent) obj = obj.parent;
            if (!obj || obj.userData.type !== 'interactive') return false;
            const angle = direction.angleTo(obj.position.clone().sub(origin));
            return angle < CONFIG.interactionScanAngle;
        });

        if (!target) return null;

        let data = target.object;
        while (data && !data.userData.type && data.parent) data = data.parent;
        return data ? data.userData : null;
    }

    beginInteraction(target) {
        if (!target) return null;
        const cooldownKey = `${target.def.id}_${target.seed}`;
        const remaining = this.cooldowns.get(cooldownKey) || 0;
        const now = performance.now();
        if (remaining > now) {
            return {
                def: target.def,
                seed: target.seed,
                locked: true,
                remaining: ((remaining - now) / 1000).toFixed(1)
            };
        }

        const readings = this.sampleDiagnostics(target);
        return { def: target.def, seed: target.seed, readings };
    }

    sampleDiagnostics(target) {
        const rng = seededRandom(target.seed);
        return {
            integrity: Math.floor(60 + rng * 40),
            risk: Math.floor(5 + rng * 25),
            output: (0.5 + rng * 4).toFixed(2)
        };
    }

    performAction(target, action) {
        if (!target) return { message: 'No target available.', locked: false };
        const cooldownKey = `${target.def.id}_${target.seed}`;
        const now = performance.now();
        const lockUntil = this.cooldowns.get(cooldownKey) || 0;
        if (lockUntil > now) {
            return { message: `Cooling down (${((lockUntil - now) / 1000).toFixed(1)}s)`, locked: true };
        }

        const diagnostics = this.sampleDiagnostics(target);
        const template = target.def.outcomes?.[action] || `${action} executed.`;
        let message = template
            .replace('{integrity}', diagnostics.integrity)
            .replace('{risk}', diagnostics.risk)
            .replace('{output}', diagnostics.output);

        // Handle salvage action - add item to inventory
        let itemAdded = false;
        if (action === 'salvage' && this.inventory) {
            const success = this.inventory.addItem(target.def.id, 1);
            if (success) {
                message += ` [+1 ${target.def.name} added to inventory]`;
                itemAdded = true;
            } else {
                message += ' [Inventory full - item lost!]';
            }
        }

        const cooldownMs = Math.max(3000, target.def.cooldown * 1000 * 0.25);
        this.cooldowns.set(cooldownKey, now + cooldownMs);

        return {
            message,
            locked: false,
            cooldown: cooldownMs / 1000,
            diagnostics,
            itemAdded
        };
    }

    // Network sync method for receiving state from other clients
    syncObjectState(objectId, state) {
        if (!state) return;

        // Sync cooldown state
        if (state.cooldownUntil !== undefined) {
            const cooldownKey = objectId;
            this.cooldowns.set(cooldownKey, state.cooldownUntil);
        }
    }

    // Get current state for syncing to other clients
    getObjectState(target) {
        const cooldownKey = `${target.def.id}_${target.seed}`;
        return {
            objectId: cooldownKey,
            cooldownUntil: this.cooldowns.get(cooldownKey) || 0
        };
    }
}
