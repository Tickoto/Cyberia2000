import { FACTIONS, CONFIG } from './config.js';
import { getTerrainHeight } from './terrain.js';

// ============================================
// WAR MANAGER
// ============================================
export class WarManager {
    constructor(scene) {
        this.scene = scene;
        this.units = [];
        this.projectiles = [];
        this.spawnTimer = 0;

        // Network sync
        this.networkManager = null;
        this.networkUpdateTimer = 0;
        this.networkUpdateInterval = 0.1; // 10 times per second
    }

    // Set network manager for syncing units
    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
        // Note: isHost is checked dynamically from networkManager to handle
        // the case where host status is determined after connection
    }

    // Check if this client is the network host (dynamic check)
    get isNetworkHost() {
        return this.networkManager?.isHost || false;
    }

    // Get sync data for all units
    getUnitsSyncData() {
        return this.units.map(unit => ({
            id: unit.networkId || `unit_${this.units.indexOf(unit)}`,
            position: {
                x: unit.mesh.position.x,
                y: unit.mesh.position.y,
                z: unit.mesh.position.z
            },
            rotationY: unit.mesh.rotation.y,
            faction: unit.faction,
            unitType: unit.type,
            speed: unit.speed
        }));
    }

    // Apply sync data from network
    applyUnitsSyncData(data) {
        if (!data || !Array.isArray(data)) return;

        for (const unitData of data) {
            const existing = this.units.find(u => u.networkId === unitData.id);
            if (existing) {
                // Update existing unit position
                const targetPos = new THREE.Vector3(
                    unitData.position.x,
                    unitData.position.y,
                    unitData.position.z
                );
                existing.mesh.position.lerp(targetPos, 0.3);
                existing.mesh.rotation.y = THREE.MathUtils.lerp(
                    existing.mesh.rotation.y,
                    unitData.rotationY,
                    0.3
                );
            } else {
                // Create new unit from sync data (for non-host clients)
                this.spawnSyncedUnit(unitData);
            }
        }

        // Remove units that no longer exist on host
        const syncedIds = new Set(data.map(u => u.id));
        for (let i = this.units.length - 1; i >= 0; i--) {
            if (!syncedIds.has(this.units[i].networkId)) {
                this.scene.remove(this.units[i].mesh);
                this.units.splice(i, 1);
            }
        }
    }

    // Spawn a unit from network sync data (for non-host clients)
    spawnSyncedUnit(data) {
        const isHeli = data.unitType === 'heli';
        const faction = FACTIONS[data.faction];
        const group = new THREE.Group();

        const colorMat = new THREE.MeshLambertMaterial({ color: faction.color });
        const grayMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

        let rotor = null;

        if (isHeli) {
            const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 8), colorMat);
            group.add(body);

            const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 6), colorMat);
            tail.position.z = -5;
            group.add(tail);

            rotor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 0.8), grayMat);
            rotor.position.y = 2;
            group.add(rotor);

            const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.3), grayMat);
            tailRotor.position.set(0, 0.5, -8);
            group.add(tailRotor);
        } else {
            const body = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 8), colorMat);
            body.position.y = 1;
            group.add(body);

            const turret = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 3), colorMat);
            turret.position.y = 2.6;
            group.add(turret);

            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 5, 8), grayMat);
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(0, 2.6, 4);
            group.add(barrel);

            const trackL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 8), grayMat);
            trackL.position.set(2.5, 0.75, 0);
            group.add(trackL);

            const trackR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 8), grayMat);
            trackR.position.set(-2.5, 0.75, 0);
            group.add(trackR);
        }

        group.position.set(data.position.x, data.position.y, data.position.z);
        group.rotation.y = data.rotationY || 0;

        this.scene.add(group);

        this.units.push({
            mesh: group,
            type: data.unitType,
            faction: data.faction,
            speed: data.speed || (isHeli ? 18 : 8),
            rotor: rotor,
            networkId: data.id
        });
    }

    // Broadcast unit sync data to all clients (called by host)
    broadcastUnitSync() {
        if (!this.networkManager || !this.networkManager.isConnected) return;

        const syncData = this.getUnitsSyncData();
        this.networkManager.broadcast('unit_sync', {
            units: syncData
        });
    }

    update(delta, playerPos) {
        this.spawnTimer += delta;
        this.networkUpdateTimer += delta;

        // Only host spawns new units
        const canSpawn = !this.networkManager || this.isNetworkHost;

        if (canSpawn && this.spawnTimer > 8 && this.units.length < 16) {
            this.spawnTimer = 0;
            this.spawnSkirmish(playerPos);
        }

        // Host broadcasts unit sync data periodically
        if (this.networkManager && this.isNetworkHost && this.networkUpdateTimer >= this.networkUpdateInterval) {
            this.networkUpdateTimer = 0;
            this.broadcastUnitSync();
        }

        for (let i = this.units.length - 1; i >= 0; i--) {
            const unit = this.units[i];

            if (unit.type === 'heli' && unit.rotor) {
                unit.rotor.rotation.y += delta * 15;
            }

            const enemy = this.findEnemy(unit);
            if (enemy) {
                const dir = new THREE.Vector3()
                    .subVectors(enemy.mesh.position, unit.mesh.position);
                dir.y = 0;

                if (dir.length() > 0.1) {
                    const targetAngle = Math.atan2(dir.x, dir.z);
                    unit.mesh.rotation.y = targetAngle;

                    const dist = unit.mesh.position.distanceTo(enemy.mesh.position);
                    if (dist > 50) {
                        dir.normalize();
                        unit.mesh.position.x += dir.x * unit.speed * delta;
                        unit.mesh.position.z += dir.z * unit.speed * delta;
                    }
                }

                if (Math.random() < 0.03) {
                    this.fireProjectile(unit.mesh.position, enemy.mesh.position, FACTIONS[unit.faction].color);
                    if (Math.random() < 0.08) {
                        this.destroyUnit(enemy);
                    }
                }
            } else {
                const forward = new THREE.Vector3(
                    Math.sin(unit.mesh.rotation.y),
                    0,
                    Math.cos(unit.mesh.rotation.y)
                );
                unit.mesh.position.add(forward.multiplyScalar(unit.speed * 0.3 * delta));
            }

            if (unit.type === 'tank') {
                const terrainY = getTerrainHeight(unit.mesh.position.x, unit.mesh.position.z);
                const desiredY = terrainY + 1.25;
                if (unit.mesh.position.y < desiredY - 0.05) {
                    unit.mesh.position.y = desiredY;
                } else {
                    unit.mesh.position.y = THREE.MathUtils.lerp(unit.mesh.position.y, desiredY, 0.35);
                }
            }

            if (unit.mesh.position.distanceTo(playerPos) > 500) {
                this.scene.remove(unit.mesh);
                this.units.splice(i, 1);
            }
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            proj.life -= delta;
            proj.mesh.material.opacity = proj.life * 3;

            if (proj.life <= 0) {
                this.scene.remove(proj.mesh);
                this.projectiles.splice(i, 1);
            }
        }

        this.updateFactionCounts();
    }

    spawnSkirmish(playerPos) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 120 + Math.random() * 80;
        const cx = playerPos.x + Math.cos(angle) * dist;
        const cz = playerPos.z + Math.sin(angle) * dist;

        const f1 = Math.floor(Math.random() * 3);
        const f2 = (f1 + 1 + Math.floor(Math.random() * 2)) % 3;

        for (let i = 0; i < 2; i++) {
            this.spawnUnit(f1, cx - 25 + Math.random() * 10, cz + Math.random() * 10);
            this.spawnUnit(f2, cx + 25 + Math.random() * 10, cz + Math.random() * 10);
        }
    }

    spawnUnit(factionIndex, x, z) {
        const isHeli = Math.random() > 0.6;
        const faction = FACTIONS[factionIndex];
        const group = new THREE.Group();

        const colorMat = new THREE.MeshLambertMaterial({ color: faction.color });
        const grayMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

        let rotor = null;

        if (isHeli) {
            const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 8), colorMat);
            group.add(body);

            const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 6), colorMat);
            tail.position.z = -5;
            group.add(tail);

            rotor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 0.8), grayMat);
            rotor.position.y = 2;
            group.add(rotor);

            const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.3), grayMat);
            tailRotor.position.set(0, 0.5, -8);
            group.add(tailRotor);

            group.position.set(x, 70 + Math.random() * 30, z);
        } else {
            const body = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 8), colorMat);
            body.position.y = 1;
            group.add(body);

            const turret = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 3), colorMat);
            turret.position.y = 2.6;
            group.add(turret);

            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 5, 8), grayMat);
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(0, 2.6, 4);
            group.add(barrel);

            const trackL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 8), grayMat);
            trackL.position.set(2.5, 0.75, 0);
            group.add(trackL);

            const trackR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 8), grayMat);
            trackR.position.set(-2.5, 0.75, 0);
            group.add(trackR);

            const terrainY = getTerrainHeight(x, z);
            group.position.set(x, terrainY + 1.25, z);
        }

        this.scene.add(group);

        // Generate unique network ID for syncing
        const networkId = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        this.units.push({
            mesh: group,
            type: isHeli ? 'heli' : 'tank',
            faction: factionIndex,
            speed: isHeli ? 18 : 8,
            rotor: rotor,
            networkId: networkId
        });
    }

    findEnemy(unit) {
        let nearest = null;
        let nearestDist = Infinity;

        for (const other of this.units) {
            if (other.faction !== unit.faction) {
                const dist = unit.mesh.position.distanceTo(other.mesh.position);
                if (dist < nearestDist) {
                    nearest = other;
                    nearestDist = dist;
                }
            }
        }
        return nearest;
    }

    fireProjectile(from, to, color) {
        const start = from.clone();
        const end = to.clone();
        start.y += 2;
        end.y += 2;

        const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
        const mat = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 1
        });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);

        this.projectiles.push({ mesh: line, life: 0.25 });
    }

    destroyUnit(unit) {
        const idx = this.units.indexOf(unit);
        if (idx === -1) return;

        const explosion = new THREE.Mesh(
            new THREE.SphereGeometry(4, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xffaa00 })
        );
        explosion.position.copy(unit.mesh.position);
        this.scene.add(explosion);
        setTimeout(() => this.scene.remove(explosion), 150);

        this.scene.remove(unit.mesh);
        this.units.splice(idx, 1);
    }

    updateFactionCounts() {
        const counts = [0, 0, 0];
        this.units.forEach(u => counts[u.faction]++);

        document.getElementById('faction-red-count').textContent = counts[0];
        document.getElementById('faction-green-count').textContent = counts[1];
        document.getElementById('faction-blue-count').textContent = counts[2];
    }
}

// ============================================
