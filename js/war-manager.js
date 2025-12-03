import { FACTIONS } from './config.js';
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
    }

    update(delta, playerPos) {
        this.spawnTimer += delta;

        if (this.spawnTimer > 8 && this.units.length < 16) {
            this.spawnTimer = 0;
            this.spawnSkirmish(playerPos);
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
        this.units.push({
            mesh: group,
            type: isHeli ? 'heli' : 'tank',
            faction: factionIndex,
            speed: isHeli ? 18 : 8,
            rotor: rotor
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
