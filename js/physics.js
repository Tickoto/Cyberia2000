import { CONFIG } from './config.js';

export class PhysicsSystem {
    constructor() {
        this.bodies = new Set();
        this.chunkColliders = new Map();
        this.dynamicVolumes = [];
        this._scratch = {
            gravity: new THREE.Vector3(0, -CONFIG.gravity, 0),
            horizontal: new THREE.Vector3(),
            normal: new THREE.Vector3()
        };
    }

    registerBody(body) {
        const defaults = {
            mass: 1,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            radius: 0.5,
            height: 1.6,
            grounded: false,
            bounciness: 0.05,
            friction: CONFIG.groundFriction,
            damping: CONFIG.airDrag,
            slopeLimit: CONFIG.slopeLimit,
            groundNormal: new THREE.Vector3(0, 1, 0)
        };
        const merged = Object.assign(defaults, body);
        this.bodies.add(merged);
        return merged;
    }

    addChunkColliders(key, colliders) {
        this.chunkColliders.set(key, colliders);
    }

    removeChunkColliders(key) {
        this.chunkColliders.delete(key);
    }

    getNearbyColliders(position) {
        const cx = Math.floor(position.x / CONFIG.chunkSize);
        const cz = Math.floor(position.z / CONFIG.chunkSize);
        const list = [];

        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                const key = `${cx + x},${cz + z}`;
                const chunkList = this.chunkColliders.get(key);
                if (chunkList) list.push(...chunkList);
            }
        }

        return list;
    }

    registerDynamicVolume(box, effect) {
        this.dynamicVolumes.push({ box, effect });
    }

    step(delta, terrainSampler) {
        this.bodies.forEach(body => this.integrate(body, delta, terrainSampler));
    }

    integrate(body, delta, terrainSampler) {
        const { gravity, horizontal, normal } = this._scratch;
        body.velocity.addScaledVector(gravity, delta);

        body.velocity.x *= 1 - body.damping * delta;
        body.velocity.z *= 1 - body.damping * delta;

        const speed = body.velocity.length();
        if (speed > CONFIG.terminalVelocity) {
            body.velocity.setLength(CONFIG.terminalVelocity);
        }

        body.position.addScaledVector(body.velocity, delta);

        const colliders = this.getNearbyColliders(body.position);
        this.resolveCollisions(body, colliders);

        const groundInfo = this.sampleGround(body.position, terrainSampler);
        body.groundNormal.copy(groundInfo.normal);

        const groundHeight = groundInfo.height;
        const desiredHeight = groundHeight + 0.05;
        const penetration = desiredHeight - body.position.y;
        const movingDownward = body.velocity.y < 0;

        if (penetration > 0) {
            body.position.y += penetration;
            const vertical = body.velocity.y;
            body.velocity.y = vertical < 0 ? 0 : Math.min(vertical, 1.5);

            horizontal.set(body.velocity.x, 0, body.velocity.z);
            const slide = this.projectOntoPlane(horizontal, groundInfo.normal);
            body.velocity.x = slide.x * Math.max(0, 1 - body.friction * delta);
            body.velocity.z = slide.z * Math.max(0, 1 - body.friction * delta);
            body.grounded = true;

            if (vertical < -1 && body.bounciness > 0) {
                body.velocity.addScaledVector(groundInfo.normal, -vertical * body.bounciness * 0.25);
            }
        } else if (penetration > -CONFIG.stepHeight && movingDownward) {
            body.position.y += Math.max(penetration, 0);
            body.velocity.y = Math.max(body.velocity.y, -1.5);
            body.grounded = true;
        } else if (Math.abs(penetration) < 0.25 && movingDownward) {
            body.position.y = THREE.MathUtils.lerp(body.position.y, desiredHeight, 0.35);
            body.velocity.y = Math.max(body.velocity.y, -2.5);
            body.grounded = true;
        } else {
            body.grounded = false;
        }

        this.applyVolumes(body, delta);
    }

    projectOntoPlane(vector, normal) {
        const dot = vector.dot(normal);
        return vector.clone().sub(normal.clone().multiplyScalar(dot));
    }

    sampleGround(position, terrainSampler) {
        const eps = 0.6;
        const h = terrainSampler(position.x, position.z);
        const hx = terrainSampler(position.x + eps, position.z);
        const hz = terrainSampler(position.x, position.z + eps);
        const normal = new THREE.Vector3(h - hx, 2 * eps, h - hz).normalize();
        return { height: h, normal };
    }

    applyVolumes(body, delta) {
        this.dynamicVolumes.forEach(volume => {
            if (volume.box.containsPoint(body.position)) {
                volume.effect(body, delta);
            }
        });
    }

    resolveCollisions(body, colliders) {
        const radius = body.radius || 0.5;
        const height = body.height || 1.6;
        const bodyTop = body.position.y + height;

        for (const box of colliders) {
            if (body.position.y > box.max.y || bodyTop < box.min.y) continue;

            const closestX = Math.max(box.min.x, Math.min(body.position.x, box.max.x));
            const closestZ = Math.max(box.min.z, Math.min(body.position.z, box.max.z));

            const dx = body.position.x - closestX;
            const dz = body.position.z - closestZ;
            const distSq = dx * dx + dz * dz;

            if (distSq < radius * radius && distSq > 0.0001) {
                const dist = Math.sqrt(distSq);
                const push = radius - dist;
                const nx = dx / dist;
                const nz = dz / dist;

                body.position.x += nx * push;
                body.position.z += nz * push;

                if (body.velocity) {
                    const normal = new THREE.Vector3(nx, 0, nz);
                    const tangent = this.projectOntoPlane(body.velocity.clone(), normal);
                    body.velocity.copy(tangent.multiplyScalar(0.65));
                }
            } else if (distSq <= 0.0001 && radius > 0) {
                body.position.z += radius * 0.5;
            }

            const slopeNormal = new THREE.Vector3(0, 1, 0);
            const dot = slopeNormal.dot(new THREE.Vector3(0, 1, 0));
            if (dot < body.slopeLimit && body.grounded) {
                body.velocity.x *= 0.5;
                body.velocity.z *= 0.5;
            }
        }
    }
}
