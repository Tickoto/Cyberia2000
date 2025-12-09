/**
 * Physics Network Client
 *
 * Handles receiving physics state from the server and applying it to local entities.
 * Implements client-side interpolation for smooth movement.
 */

import { CONFIG } from './config.js';

// Message types for physics networking
export const PhysicsMessageType = {
    PHYSICS_STATE: 'physics_state',
    PLAYER_INPUT: 'player_input',
    VEHICLE_INPUT: 'vehicle_input',
    SPAWN_PLAYER: 'spawn_player',
    SPAWN_VEHICLE: 'spawn_vehicle'
};

/**
 * PhysicsStateBuffer - Stores physics states for interpolation
 */
class PhysicsStateBuffer {
    constructor(maxStates = 20) {
        this.states = [];
        this.maxStates = maxStates;
    }

    addState(state) {
        this.states.push(state);
        if (this.states.length > this.maxStates) {
            this.states.shift();
        }
    }

    getInterpolatedState(renderTime) {
        if (this.states.length < 2) {
            return this.states[this.states.length - 1] || null;
        }

        // Find the two states to interpolate between
        let before = null;
        let after = null;

        for (let i = 0; i < this.states.length - 1; i++) {
            if (this.states[i].timestamp <= renderTime &&
                this.states[i + 1].timestamp >= renderTime) {
                before = this.states[i];
                after = this.states[i + 1];
                break;
            }
        }

        // If no valid pair found, use the latest state
        if (!before || !after) {
            // Extrapolate from last two states if we're ahead of data
            if (this.states.length >= 2 && renderTime > this.states[this.states.length - 1].timestamp) {
                before = this.states[this.states.length - 2];
                after = this.states[this.states.length - 1];
            } else {
                return this.states[this.states.length - 1];
            }
        }

        // Calculate interpolation factor
        const duration = after.timestamp - before.timestamp;
        const t = duration > 0 ? (renderTime - before.timestamp) / duration : 0;
        const clampedT = Math.max(0, Math.min(1.5, t)); // Allow slight extrapolation

        return this.lerpState(before, after, clampedT);
    }

    lerpState(a, b, t) {
        return {
            position: {
                x: a.position.x + (b.position.x - a.position.x) * t,
                y: a.position.y + (b.position.y - a.position.y) * t,
                z: a.position.z + (b.position.z - a.position.z) * t
            },
            rotation: this.slerpQuat(a.rotation, b.rotation, t),
            velocity: {
                x: a.velocity.x + (b.velocity.x - a.velocity.x) * t,
                y: a.velocity.y + (b.velocity.y - a.velocity.y) * t,
                z: a.velocity.z + (b.velocity.z - a.velocity.z) * t
            },
            angularVelocity: {
                x: a.angularVelocity.x + (b.angularVelocity.x - a.angularVelocity.x) * t,
                y: a.angularVelocity.y + (b.angularVelocity.y - a.angularVelocity.y) * t,
                z: a.angularVelocity.z + (b.angularVelocity.z - a.angularVelocity.z) * t
            },
            grounded: t < 0.5 ? a.grounded : b.grounded,
            timestamp: a.timestamp + (b.timestamp - a.timestamp) * t
        };
    }

    // Simple quaternion slerp
    slerpQuat(a, b, t) {
        // Normalize quaternions
        const normalize = (q) => {
            const len = Math.sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w);
            return len > 0 ? { x: q.x/len, y: q.y/len, z: q.z/len, w: q.w/len } : q;
        };

        const qa = normalize(a);
        let qb = normalize(b);

        // Calculate dot product
        let dot = qa.x*qb.x + qa.y*qb.y + qa.z*qb.z + qa.w*qb.w;

        // If dot is negative, negate one quaternion to take shorter path
        if (dot < 0) {
            qb = { x: -qb.x, y: -qb.y, z: -qb.z, w: -qb.w };
            dot = -dot;
        }

        // Linear interpolation for close quaternions
        if (dot > 0.9995) {
            return normalize({
                x: qa.x + (qb.x - qa.x) * t,
                y: qa.y + (qb.y - qa.y) * t,
                z: qa.z + (qb.z - qa.z) * t,
                w: qa.w + (qb.w - qa.w) * t
            });
        }

        // Spherical interpolation
        const theta0 = Math.acos(dot);
        const theta = theta0 * t;
        const sinTheta = Math.sin(theta);
        const sinTheta0 = Math.sin(theta0);

        const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
        const s1 = sinTheta / sinTheta0;

        return normalize({
            x: qa.x * s0 + qb.x * s1,
            y: qa.y * s0 + qb.y * s1,
            z: qa.z * s0 + qb.z * s1,
            w: qa.w * s0 + qb.w * s1
        });
    }

    clear() {
        this.states = [];
    }
}

/**
 * PhysicsNetworkClient - Main class for physics network synchronization
 */
export class PhysicsNetworkClient {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.enabled = false;
        this.serverPhysicsEnabled = false;

        // Entity state buffers for interpolation
        this.entityBuffers = new Map(); // entityId -> PhysicsStateBuffer

        // Local entities (controlled by this client)
        this.localEntities = new Set();

        // Callbacks
        this.onPhysicsState = null;
        this.onEntityStateUpdate = null;

        // Configuration
        this.interpolationDelay = CONFIG.networkInterpolationDelay || 100; // ms
        this.inputSendRate = 50; // ms between input sends
        this.lastInputSendTime = 0;

        // Input state
        this.pendingPlayerInput = null;
        this.pendingVehicleInput = null;
        this.currentVehicleId = null;

        // Stats
        this.statesReceived = 0;
        this.lastServerTime = 0;
    }

    /**
     * Initialize physics networking
     */
    initialize() {
        if (!this.networkManager) {
            console.warn('PhysicsNetworkClient: No network manager provided');
            return false;
        }

        // Register message handler for physics state
        this.networkManager.registerMessageHandler(
            PhysicsMessageType.PHYSICS_STATE,
            (data, clientId, timestamp) => this.handlePhysicsState(data, timestamp)
        );

        this.enabled = true;
        console.log('PhysicsNetworkClient: Initialized');
        return true;
    }

    /**
     * Called when server confirms physics is enabled
     */
    setServerPhysicsEnabled(enabled, tickRate, broadcastRate) {
        this.serverPhysicsEnabled = enabled;
        if (enabled) {
            // Adjust interpolation delay based on server broadcast rate
            this.interpolationDelay = Math.max(50, 1000 / broadcastRate * 2);
            console.log(`PhysicsNetworkClient: Server physics enabled, interpolation delay: ${this.interpolationDelay}ms`);
        }
    }

    /**
     * Handle incoming physics state from server
     */
    handlePhysicsState(data, serverTimestamp) {
        if (!data.bodies || !Array.isArray(data.bodies)) return;

        this.statesReceived++;
        this.lastServerTime = data.timestamp || serverTimestamp;

        for (const bodyState of data.bodies) {
            const entityId = bodyState.entityId;
            if (!entityId) continue;

            // Skip local entities - we don't interpolate our own state
            if (this.localEntities.has(entityId)) continue;

            // Get or create state buffer for this entity
            let buffer = this.entityBuffers.get(entityId);
            if (!buffer) {
                buffer = new PhysicsStateBuffer();
                this.entityBuffers.set(entityId, buffer);
            }

            // Add state to buffer
            buffer.addState({
                ...bodyState,
                timestamp: this.lastServerTime
            });
        }

        // Callback for additional processing
        if (this.onPhysicsState) {
            this.onPhysicsState(data, serverTimestamp);
        }
    }

    /**
     * Get interpolated state for an entity
     */
    getEntityState(entityId) {
        const buffer = this.entityBuffers.get(entityId);
        if (!buffer) return null;

        const renderTime = Date.now() - this.interpolationDelay;
        return buffer.getInterpolatedState(renderTime);
    }

    /**
     * Mark an entity as locally controlled
     */
    setLocalEntity(entityId, isLocal = true) {
        if (isLocal) {
            this.localEntities.add(entityId);
        } else {
            this.localEntities.delete(entityId);
        }
    }

    /**
     * Check if an entity is locally controlled
     */
    isLocalEntity(entityId) {
        return this.localEntities.has(entityId);
    }

    /**
     * Send player input to server
     */
    sendPlayerInput(input) {
        if (!this.enabled || !this.serverPhysicsEnabled) return;

        this.pendingPlayerInput = {
            forward: input.forward || false,
            backward: input.backward || false,
            left: input.left || false,
            right: input.right || false,
            jump: input.jump || false,
            running: input.running || false,
            rotationY: input.rotationY || 0
        };
    }

    /**
     * Send vehicle input to server
     */
    sendVehicleInput(vehicleId, input) {
        if (!this.enabled || !this.serverPhysicsEnabled) return;

        this.currentVehicleId = vehicleId;
        this.pendingVehicleInput = {
            vehicleId,
            throttle: input.throttle || 0,
            steer: input.steer || 0,
            brake: input.brake || false,
            lift: input.lift || 0,
            pitch: input.pitch || 0,
            roll: input.roll || 0,
            yaw: input.yaw || 0
        };
    }

    /**
     * Clear vehicle input (when exiting vehicle)
     */
    clearVehicleInput() {
        this.currentVehicleId = null;
        this.pendingVehicleInput = null;
    }

    /**
     * Request player spawn on server
     */
    spawnPlayer(position, username, appearance) {
        if (!this.networkManager || !this.networkManager.isConnected) return;

        this.networkManager.send(PhysicsMessageType.SPAWN_PLAYER, {
            position,
            username,
            appearance
        });
    }

    /**
     * Request vehicle spawn on server
     */
    spawnVehicle(vehicleType, position) {
        if (!this.networkManager || !this.networkManager.isConnected) return;

        this.networkManager.send(PhysicsMessageType.SPAWN_VEHICLE, {
            vehicleType,
            position
        });
    }

    /**
     * Update loop - call this every frame
     */
    update(delta) {
        if (!this.enabled || !this.serverPhysicsEnabled) return;

        const now = Date.now();

        // Send pending inputs at throttled rate
        if (now - this.lastInputSendTime >= this.inputSendRate) {
            this.lastInputSendTime = now;

            // Send player input
            if (this.pendingPlayerInput && !this.currentVehicleId) {
                this.networkManager.send(PhysicsMessageType.PLAYER_INPUT, this.pendingPlayerInput);
            }

            // Send vehicle input
            if (this.pendingVehicleInput) {
                this.networkManager.send(PhysicsMessageType.VEHICLE_INPUT, this.pendingVehicleInput);
            }
        }

        // Update entity states through callback
        if (this.onEntityStateUpdate) {
            for (const [entityId, buffer] of this.entityBuffers) {
                if (this.localEntities.has(entityId)) continue;

                const state = this.getEntityState(entityId);
                if (state) {
                    this.onEntityStateUpdate(entityId, state);
                }
            }
        }
    }

    /**
     * Remove entity tracking
     */
    removeEntity(entityId) {
        this.entityBuffers.delete(entityId);
        this.localEntities.delete(entityId);
    }

    /**
     * Clear all state
     */
    clear() {
        this.entityBuffers.clear();
        this.localEntities.clear();
        this.pendingPlayerInput = null;
        this.pendingVehicleInput = null;
        this.currentVehicleId = null;
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            enabled: this.enabled,
            serverPhysicsEnabled: this.serverPhysicsEnabled,
            entitiesTracked: this.entityBuffers.size,
            localEntities: this.localEntities.size,
            statesReceived: this.statesReceived,
            interpolationDelay: this.interpolationDelay
        };
    }
}

/**
 * Helper function to convert quaternion to Euler angles (YXZ order)
 */
export function quaternionToEuler(q) {
    // Convert quaternion to Euler angles (YXZ order for Three.js)
    const { x, y, z, w } = q;

    // Roll (X-axis rotation)
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    // Pitch (Y-axis rotation)
    const sinp = 2 * (w * y - z * x);
    let pitch;
    if (Math.abs(sinp) >= 1) {
        pitch = Math.sign(sinp) * Math.PI / 2;
    } else {
        pitch = Math.asin(sinp);
    }

    // Yaw (Z-axis rotation)
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return { x: roll, y: pitch, z: yaw };
}

/**
 * Helper function to convert Euler angles to quaternion
 */
export function eulerToQuaternion(euler) {
    const { x, y, z } = euler;

    const cy = Math.cos(y * 0.5);
    const sy = Math.sin(y * 0.5);
    const cp = Math.cos(x * 0.5);
    const sp = Math.sin(x * 0.5);
    const cr = Math.cos(z * 0.5);
    const sr = Math.sin(z * 0.5);

    return {
        w: cr * cp * cy + sr * sp * sy,
        x: sr * cp * cy - cr * sp * sy,
        y: cr * sp * cy + sr * cp * sy,
        z: cr * cp * sy - sr * sp * cy
    };
}
