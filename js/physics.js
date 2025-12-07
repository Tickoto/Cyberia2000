import { CONFIG } from './config.js';

export class PhysicsSystem {
    constructor() {
        this.bodies = new Set();
        this.chunkColliders = new Map();
        this.dynamicVolumes = [];
        this._scratch = {
            gravity: new THREE.Vector3(0, -CONFIG.gravity, 0),
            horizontal: new THREE.Vector3(),
            normal: new THREE.Vector3(),
            tempNormal: new THREE.Vector3(0, 1, 0)
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
        if (!colliders || colliders.length === 0) return;

        const existing = this.chunkColliders.get(key);
        if (existing) {
            this.chunkColliders.set(key, existing.concat(colliders));
        } else {
            this.chunkColliders.set(key, colliders.slice());
        }
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
        const { gravity, horizontal, tempNormal } = this._scratch;
        body.velocity.addScaledVector(gravity, delta);

        body.velocity.x *= 1 - body.damping * delta;
        body.velocity.z *= 1 - body.damping * delta;

        const speed = body.velocity.length();
        if (speed > CONFIG.terminalVelocity) {
            body.velocity.setLength(CONFIG.terminalVelocity);
        }

        body.position.addScaledVector(body.velocity, delta);

        const colliders = this.getNearbyColliders(body.position);
        const collisionInfo = this.resolveCollisions(body, colliders);

        const colliderGround = this.groundCast(body.position, body.height, colliders);
        const terrainGround = this.sampleGround(body.position, terrainSampler);
        const useColliderNormal = colliderGround && colliderGround.point.y >= terrainGround.height - 0.01;

        const groundHeight = colliderGround
            ? Math.max(terrainGround.height, colliderGround.point.y)
            : terrainGround.height;
        const groundNormal = useColliderNormal ? tempNormal : terrainGround.normal;

        body.groundNormal.copy(groundNormal);
        const desiredHeight = groundHeight + 0.05;
        const penetration = desiredHeight - body.position.y;
        const movingDownward = body.velocity.y < 0;

        body.grounded = collisionInfo.onGround;

        if (penetration > 0) {
            body.position.y += penetration;
            const vertical = body.velocity.y;
            body.velocity.y = vertical < 0 ? 0 : Math.min(vertical, 1.5);

            horizontal.set(body.velocity.x, 0, body.velocity.z);
            const slide = this.projectOntoPlane(horizontal, groundNormal);
            body.velocity.x = slide.x * Math.max(0, 1 - body.friction * delta);
            body.velocity.z = slide.z * Math.max(0, 1 - body.friction * delta);
            body.grounded = true;

            if (vertical < -1 && body.bounciness > 0) {
                body.velocity.addScaledVector(groundNormal, -vertical * body.bounciness * 0.25);
            }
        } else if (penetration > -CONFIG.stepHeight && movingDownward) {
            body.position.y += Math.max(penetration, 0);
            body.velocity.y = Math.max(body.velocity.y, -1.5);
            body.grounded = true;
        } else if (Math.abs(penetration) < 0.25 && movingDownward) {
            body.position.y = THREE.MathUtils.lerp(body.position.y, desiredHeight, 0.35);
            body.velocity.y = Math.max(body.velocity.y, -2.5);
            body.grounded = true;
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

    groundCast(position, capsuleHeight, colliders) {
        if (!colliders?.length) return null;
        const origin = position.clone();
        origin.y += (capsuleHeight || 0) * 0.5;
        let closest = null;

        for (const box of colliders) {
            if (origin.x < box.min.x || origin.x > box.max.x) continue;
            if (origin.z < box.min.z || origin.z > box.max.z) continue;
            if (origin.y < box.min.y) continue;

            const distance = origin.y - box.max.y;
            if (distance < 0) continue;

            if (!closest || distance < closest.distance) {
                closest = {
                    point: new THREE.Vector3(origin.x, box.max.y, origin.z),
                    distance
                };
            }
        }

        return closest;
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

        let capsule = new THREE.Box3(
            new THREE.Vector3(body.position.x - radius, body.position.y, body.position.z - radius),
            new THREE.Vector3(body.position.x + radius, body.position.y + height, body.position.z + radius)
        );

        let onGround = false;
        const capsuleCenter = new THREE.Vector3();
        const colliderCenter = new THREE.Vector3();

        for (const box of colliders) {
            if (!capsule.intersectsBox(box)) continue;

            const overlapX = Math.min(capsule.max.x, box.max.x) - Math.max(capsule.min.x, box.min.x);
            const overlapY = Math.min(capsule.max.y, box.max.y) - Math.max(capsule.min.y, box.min.y);
            const overlapZ = Math.min(capsule.max.z, box.max.z) - Math.max(capsule.min.z, box.min.z);

            if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

            const minPenetration = Math.min(overlapX, overlapY, overlapZ);
            capsule.getCenter(capsuleCenter);
            box.getCenter(colliderCenter);

            const canStep = (box.max.y - body.position.y) <= CONFIG.stepHeight && (body.position.y + height) > box.min.y;

            if ((minPenetration === overlapX || minPenetration === overlapZ) && canStep) {
                body.position.y = box.max.y;
                if (body.velocity.y < 0) body.velocity.y = 0;
                onGround = true;
            } else if (minPenetration === overlapX) {
                const dir = Math.sign(capsuleCenter.x - colliderCenter.x) || 1;
                body.position.x += overlapX * dir;
                body.velocity.x = 0;
            } else if (minPenetration === overlapZ) {
                const dir = Math.sign(capsuleCenter.z - colliderCenter.z) || 1;
                body.position.z += overlapZ * dir;
                body.velocity.z = 0;
            } else {
                const dir = Math.sign(capsuleCenter.y - colliderCenter.y) || 1;
                body.position.y += overlapY * dir;
                if (dir > 0) onGround = true;
                if (body.velocity.y * dir < 0) body.velocity.y = 0;
            }

            capsule = new THREE.Box3(
                new THREE.Vector3(body.position.x - radius, body.position.y, body.position.z - radius),
                new THREE.Vector3(body.position.x + radius, body.position.y + height, body.position.z + radius)
            );
        }

        return { onGround };
    }
}
