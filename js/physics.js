import { CONFIG } from './config.js';

export class PhysicsSystem {
    constructor() {
        this.bodies = new Set();
        this.colliders = [];
        this.chunkColliders = new Map();
        this.boundingBoxes = new Map();
        this.dynamicVolumes = [];
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 50;
        this.stepHeight = CONFIG.stepHeight || 0.6;
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
            angularVelocity: new THREE.Vector3(), 
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            radius: 0.5,
            height: 1.6,
            grounded: false,
            bounciness: 0.05,
            friction: CONFIG.groundFriction,
            damping: CONFIG.airDrag,
            angularDamping: 0.5,
            slopeLimit: CONFIG.slopeLimit,
            groundNormal: new THREE.Vector3(0, 1, 0),
            noCollisions: false,
            noGravity: false,
            enableAngularPhysics: false 
        };
        const merged = Object.assign(defaults, body);
        this.bodies.add(merged);
        return merged;
    }

    register(mesh) {
        if (!mesh || !mesh.isMesh) return false;
        if (mesh.userData && mesh.userData.noCollision) return false;
        if (this.colliders.includes(mesh)) return false;

        const box = new THREE.Box3().setFromObject(mesh);
        const size = new THREE.Vector3();
        box.getSize(size);

        const minSize = Math.min(size.x, size.y, size.z);
        const isLargeSurface = minSize < 0.05 && (size.x > 2 || size.z > 2);
        if (minSize < 0.05 && !isLargeSurface) return false;

        this.colliders.push(mesh);
        this.boundingBoxes.set(mesh, box);
        return true;
    }

    unregister(mesh) {
        const idx = this.colliders.indexOf(mesh);
        if (idx >= 0) {
            this.colliders.splice(idx, 1);
            this.boundingBoxes.delete(mesh);
        }
    }

    registerHierarchy(root) {
        const added = [];
        if (!root) return added;
        root.traverse(obj => {
            if (this.register(obj)) added.push(obj);
        });
        return added;
    }

    unregisterHierarchy(root) {
        if (!root) return;
        root.traverse(obj => this.unregister(obj));
    }

    addChunkColliders(key, colliders) {
        if (!colliders || colliders.length === 0) return;
        const entry = this.chunkColliders.get(key) || { boxes: [], meshes: [], grounds: [] };
        colliders.forEach(collider => {
            if (!collider) return;
            if (collider instanceof THREE.Box3) {
                entry.boxes.push(collider.clone());
                return;
            }
            if (collider.isObject3D || collider.isMesh) {
                if (this.register(collider)) {
                    entry.meshes.push(collider);
                }
            }
        });
        if (entry.boxes.length || entry.meshes.length) {
            this.chunkColliders.set(key, entry);
        }
    }

    addChunkGroup(key, root) {
        if (!root) return;
        const entry = this.chunkColliders.get(key) || { boxes: [], meshes: [], grounds: [] };
        root.traverse(obj => {
            if (this.register(obj)) {
                if (obj.userData && obj.userData.isGround) {
                    entry.grounds.push(obj);
                } else {
                    entry.meshes.push(obj);
                }
            }
        });
        if (entry.boxes.length || entry.meshes.length || entry.grounds.length) {
            this.chunkColliders.set(key, entry);
        }
    }

    removeChunkColliders(key) {
        const entry = this.chunkColliders.get(key);
        if (entry?.meshes) entry.meshes.forEach(mesh => this.unregister(mesh));
        if (entry?.grounds) entry.grounds.forEach(mesh => this.unregister(mesh));
        this.chunkColliders.delete(key);
    }

    updateColliderBox(mesh) {
        if (!mesh || !mesh.isMesh) return null;
        const box = this.boundingBoxes.get(mesh) || new THREE.Box3();
        mesh.updateWorldMatrix(true, false);
        box.setFromObject(mesh);
        box.owner = mesh;
        this.boundingBoxes.set(mesh, box);
        return box;
    }

    getAllColliders() {
        const list = [];
        for (const mesh of this.colliders) {
            const box = this.updateColliderBox(mesh);
            if (box) list.push(box);
        }
        for (const entry of this.chunkColliders.values()) {
            if (entry.boxes?.length) list.push(...entry.boxes);
        }
        return list;
    }

    getNearbyColliders(position) {
        const cx = Math.floor(position.x / CONFIG.chunkSize);
        const cz = Math.floor(position.z / CONFIG.chunkSize);
        const list = [];
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                const key = `${cx + x},${cz + z}`;
                const entry = this.chunkColliders.get(key);
                if (!entry) continue;
                if (entry.boxes?.length) list.push(...entry.boxes);
                if (entry.meshes?.length) {
                    entry.meshes.forEach(mesh => {
                        const box = this.updateColliderBox(mesh);
                        if (box) list.push(box);
                    });
                }
            }
        }
        return list;
    }

    registerDynamicVolume(box, effect) {
        this.dynamicVolumes.push({ box, effect });
    }

    groundCast(body) {
        if (!this.colliders.length) return null;
        const origin = body.position.clone();
        origin.y += body.height * 0.5;
        this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
        const hits = this.raycaster.intersectObjects(this.colliders, false);
        if (!hits.length) return null;
        const validHit = hits.find(hit => {
            if (hit.object.userData && hit.object.userData.vehicle && body.vehicleRef && hit.object.userData.vehicle === body.vehicleRef) {
                return false;
            }
            return true;
        });
        return validHit || null;
    }

    step(delta, terrainSampler) {
        this.bodies.forEach(body => this.integrate(body, delta, terrainSampler));
    }

    integrate(body, delta, terrainSampler) {
        const { gravity, horizontal, tempNormal } = this._scratch;
        if (!body.noGravity) {
            body.velocity.addScaledVector(gravity, delta);
        }

        body.velocity.x *= 1 - body.damping * delta;
        body.velocity.z *= 1 - body.damping * delta;

        const speed = body.velocity.length();
        if (speed > CONFIG.terminalVelocity) {
            body.velocity.setLength(CONFIG.terminalVelocity);
        }

        body.position.addScaledVector(body.velocity, delta);

        if (body.enableAngularPhysics && body.angularVelocity) {
            body.angularVelocity.multiplyScalar(Math.pow(body.angularDamping, delta * 60));
            body.rotation.x += body.angularVelocity.x * delta;
            body.rotation.y += body.angularVelocity.y * delta;
            body.rotation.z += body.angularVelocity.z * delta;
            
            // Allow faster tumbling for realistic crashes
            const maxAngular = 15; 
            body.angularVelocity.x = THREE.MathUtils.clamp(body.angularVelocity.x, -maxAngular, maxAngular);
            body.angularVelocity.y = THREE.MathUtils.clamp(body.angularVelocity.y, -maxAngular, maxAngular);
            body.angularVelocity.z = THREE.MathUtils.clamp(body.angularVelocity.z, -maxAngular, maxAngular);
        }

        if (body.noCollisions) {
            this.applyVolumes(body, delta);
            return;
        }

        // Walls/Objects Collision (Box3)
        const collisionInfo = this.resolveCollisions(body.position, body.velocity, body.radius, body.height, body);

        // GROUND COLLISION LOGIC
        // If it's a vehicle, SKIP the character-controller snapping. 
        // VehicleManager handles suspension and chassis collision.
        if (!body.isVehicle) {
            const groundInfo = this.groundCast(body);
            const terrainGround = this.sampleGround(body.position, terrainSampler);

            const groundHeight = groundInfo
                ? Math.max(terrainGround.height, groundInfo.point.y)
                : terrainGround.height;
            const groundNormal = groundInfo ? tempNormal : terrainGround.normal;

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
            } else if (penetration > -this.stepHeight && movingDownward) {
                body.position.y += Math.max(penetration, 0);
                body.velocity.y = Math.max(body.velocity.y, -1.5);
                body.grounded = true;
            }
        } else {
            // Vehicles are only grounded if collision resolution says so (e.g. on top of a static object)
            // Otherwise, they float until Suspension or Chassis Collision logic kicks in.
            body.grounded = collisionInfo.onGround;
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

    resolveCollisions(position, velocity, radius, height, body = null) {
        const colliders = this.getNearbyColliders(position);
        if (!colliders.length) return { onGround: false };

        const r = body?.isVehicle ? radius * 0.8 : radius;
        let capsule = new THREE.Box3(
            new THREE.Vector3(position.x - r, position.y, position.z - r),
            new THREE.Vector3(position.x + r, position.y + height, position.z + r)
        );

        let onGround = false;
        const capsuleCenter = new THREE.Vector3();
        const colliderCenter = new THREE.Vector3();

        for (const box of colliders) {
            if (body?.isVehicle && box.owner?.userData?.vehicle === body?.vehicleRef) continue;
            if (!capsule.intersectsBox(box)) continue;

            const overlapX = Math.min(capsule.max.x, box.max.x) - Math.max(capsule.min.x, box.min.x);
            const overlapY = Math.min(capsule.max.y, box.max.y) - Math.max(capsule.min.y, box.min.y);
            const overlapZ = Math.min(capsule.max.z, box.max.z) - Math.max(capsule.min.z, box.min.z);

            if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

            const minPenetration = Math.min(overlapX, overlapY, overlapZ);
            capsule.getCenter(capsuleCenter);
            box.getCenter(colliderCenter);

            const canStep = (box.max.y - position.y) <= this.stepHeight && (position.y + height) > box.min.y;

            if ((minPenetration === overlapX || minPenetration === overlapZ) && canStep && !body?.isVehicle) {
                position.y = box.max.y;
                if (velocity.y < 0) velocity.y = 0;
                onGround = true;
            } else if (minPenetration === overlapX) {
                const dir = Math.sign(capsuleCenter.x - colliderCenter.x) || 1;
                position.x += overlapX * dir;
                velocity.x *= body?.isVehicle ? 0.8 : 0;
            } else if (minPenetration === overlapZ) {
                const dir = Math.sign(capsuleCenter.z - colliderCenter.z) || 1;
                position.z += overlapZ * dir;
                velocity.z *= body?.isVehicle ? 0.8 : 0;
            } else {
                const dir = Math.sign(capsuleCenter.y - colliderCenter.y) || 1;
                position.y += overlapY * dir;
                if (dir > 0) onGround = true;
                if (velocity.y < 0 && dir > 0) velocity.y *= -0.3; // Bounce
                if (velocity.y > 0 && dir < 0) velocity.y = 0;
            }

            capsule = new THREE.Box3(
                new THREE.Vector3(position.x - r, position.y, position.z - r),
                new THREE.Vector3(position.x + r, position.y + height, position.z + r)
            );
        }

        return { onGround };
    }
}