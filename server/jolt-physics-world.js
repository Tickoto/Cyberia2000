/**
 * Jolt Physics World - Server-side physics simulation
 *
 * This module provides server-authoritative physics using Jolt Physics.
 * The server runs the physics simulation and broadcasts state to all clients.
 */

import initJolt from 'jolt-physics/wasm-compat';

// Physics configuration
const PHYSICS_CONFIG = {
    gravity: -38.5,           // Match game gravity
    fixedTimeStep: 1/60,      // 60 Hz physics
    maxSubSteps: 4,           // Max physics sub-steps per frame
    broadPhaseLayerCount: 2,  // Moving and non-moving layers
    objectLayerCount: 4       // Static, Dynamic, Player, Vehicle
};

// Object layers for collision filtering
const LAYER_STATIC = 0;
const LAYER_DYNAMIC = 1;
const LAYER_PLAYER = 2;
const LAYER_VEHICLE = 3;

// Broad phase layers
const BP_LAYER_NON_MOVING = 0;
const BP_LAYER_MOVING = 1;

/**
 * JoltPhysicsWorld - Manages the Jolt physics simulation
 */
export class JoltPhysicsWorld {
    constructor() {
        this.Jolt = null;
        this.joltInterface = null;
        this.physicsSystem = null;
        this.bodyInterface = null;

        // Body tracking
        this.bodies = new Map();          // bodyId -> { id, type, entityId, body }
        this.entityBodies = new Map();    // entityId -> bodyId

        // Terrain heightfield
        this.terrainShape = null;
        this.terrainBody = null;

        // Accumulator for fixed timestep
        this.accumulator = 0;

        // Stats
        this.stepCount = 0;
        this.lastStepTime = 0;
    }

    /**
     * Initialize Jolt Physics
     */
    async initialize() {
        console.log('Initializing Jolt Physics...');

        // Initialize Jolt WASM module
        this.Jolt = await initJolt();

        // Setup collision filtering first (creates the filter objects)
        this.setupCollisionFiltering();

        // Create physics system settings
        const settings = new this.Jolt.JoltSettings();
        settings.mMaxBodies = 10240;
        settings.mMaxBodyPairs = 65536;
        settings.mMaxContactConstraints = 10240;
        settings.mNumBodyMutexes = 0; // Auto-detect
        settings.mNumVelocitySteps = 10;
        settings.mNumPositionSteps = 2;

        // Assign the collision filters to settings (required by WASM bindings)
        settings.mObjectLayerPairFilter = this.objectFilter;
        settings.mBroadPhaseLayerInterface = this.bpLayerInterface;
        settings.mObjectVsBroadPhaseLayerFilter = this.objectVsBpFilter;

        // Create Jolt interface
        this.joltInterface = new this.Jolt.JoltInterface(settings);
        this.Jolt.destroy(settings);

        this.physicsSystem = this.joltInterface.GetPhysicsSystem();
        this.bodyInterface = this.physicsSystem.GetBodyInterface();

        // Set gravity
        this.physicsSystem.SetGravity(new this.Jolt.Vec3(0, PHYSICS_CONFIG.gravity, 0));

        console.log('Jolt Physics initialized successfully');
        return true;
    }

    /**
     * Setup collision filtering between layers
     */
    setupCollisionFiltering() {
        const Jolt = this.Jolt;

        // Object layer pair filter - determines which layers can collide
        this.objectFilter = new Jolt.ObjectLayerPairFilterTable(PHYSICS_CONFIG.objectLayerCount);

        // Static collides with everything
        this.objectFilter.EnableCollision(LAYER_STATIC, LAYER_DYNAMIC);
        this.objectFilter.EnableCollision(LAYER_STATIC, LAYER_PLAYER);
        this.objectFilter.EnableCollision(LAYER_STATIC, LAYER_VEHICLE);

        // Dynamic objects collide with everything
        this.objectFilter.EnableCollision(LAYER_DYNAMIC, LAYER_DYNAMIC);
        this.objectFilter.EnableCollision(LAYER_DYNAMIC, LAYER_PLAYER);
        this.objectFilter.EnableCollision(LAYER_DYNAMIC, LAYER_VEHICLE);

        // Players collide with static, dynamic, and vehicles (but not other players for now)
        this.objectFilter.EnableCollision(LAYER_PLAYER, LAYER_VEHICLE);

        // Vehicles collide with everything
        this.objectFilter.EnableCollision(LAYER_VEHICLE, LAYER_VEHICLE);

        // Broad phase layer interface
        this.bpLayerInterface = new Jolt.BroadPhaseLayerInterfaceTable(
            PHYSICS_CONFIG.objectLayerCount,
            PHYSICS_CONFIG.broadPhaseLayerCount
        );

        // Map object layers to broad phase layers
        this.bpLayerInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, BP_LAYER_NON_MOVING);
        this.bpLayerInterface.MapObjectToBroadPhaseLayer(LAYER_DYNAMIC, BP_LAYER_MOVING);
        this.bpLayerInterface.MapObjectToBroadPhaseLayer(LAYER_PLAYER, BP_LAYER_MOVING);
        this.bpLayerInterface.MapObjectToBroadPhaseLayer(LAYER_VEHICLE, BP_LAYER_MOVING);

        // Object vs broad phase layer filter
        this.objectVsBpFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
            this.bpLayerInterface,
            PHYSICS_CONFIG.broadPhaseLayerCount,
            this.objectFilter,
            PHYSICS_CONFIG.objectLayerCount
        );
    }

    /**
     * Create a static ground plane
     */
    createGroundPlane(y = 0) {
        const Jolt = this.Jolt;

        const planeShape = new Jolt.PlaneShape(
            new Jolt.Plane(new Jolt.Vec3(0, 1, 0), -y),
            null,
            1000 // Half extent
        );

        const creationSettings = new Jolt.BodyCreationSettings(
            planeShape,
            new Jolt.RVec3(0, 0, 0),
            new Jolt.Quat(0, 0, 0, 1),
            Jolt.EMotionType_Static,
            LAYER_STATIC
        );

        const body = this.bodyInterface.CreateBody(creationSettings);
        this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);

        Jolt.destroy(creationSettings);

        return body;
    }

    /**
     * Create a height field terrain from a sampler function
     */
    createTerrainHeightfield(centerX, centerZ, size, resolution, heightSampler) {
        const Jolt = this.Jolt;

        // Sample heights into a flat array
        const samples = resolution * resolution;
        const heights = new Float32Array(samples);
        const scale = size / resolution;

        let minHeight = Infinity;
        let maxHeight = -Infinity;

        for (let z = 0; z < resolution; z++) {
            for (let x = 0; x < resolution; x++) {
                const wx = centerX - size/2 + x * scale;
                const wz = centerZ - size/2 + z * scale;
                const h = heightSampler(wx, wz);
                heights[z * resolution + x] = h;
                minHeight = Math.min(minHeight, h);
                maxHeight = Math.max(maxHeight, h);
            }
        }

        // Create height field shape settings
        const shapeSettings = new Jolt.HeightFieldShapeSettings(
            heights,
            new Jolt.Vec3(centerX - size/2, 0, centerZ - size/2),
            new Jolt.Vec3(scale, 1, scale),
            resolution
        );

        const shapeResult = shapeSettings.Create();
        if (shapeResult.HasError()) {
            console.error('Failed to create heightfield:', shapeResult.GetError().c_str());
            Jolt.destroy(shapeSettings);
            return null;
        }

        const shape = shapeResult.Get();

        const creationSettings = new Jolt.BodyCreationSettings(
            shape,
            new Jolt.RVec3(0, 0, 0),
            new Jolt.Quat(0, 0, 0, 1),
            Jolt.EMotionType_Static,
            LAYER_STATIC
        );

        const body = this.bodyInterface.CreateBody(creationSettings);
        this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);

        Jolt.destroy(creationSettings);
        Jolt.destroy(shapeSettings);

        this.terrainBody = body;
        return body;
    }

    /**
     * Create a dynamic box body (for vehicles, crates, etc.)
     */
    createBoxBody(entityId, position, rotation, halfExtents, mass, options = {}) {
        const Jolt = this.Jolt;

        const shape = new Jolt.BoxShape(
            new Jolt.Vec3(halfExtents.x, halfExtents.y, halfExtents.z),
            0.05 // Convex radius
        );

        const layer = options.isVehicle ? LAYER_VEHICLE : LAYER_DYNAMIC;
        const motionType = mass > 0 ? Jolt.EMotionType_Dynamic : Jolt.EMotionType_Static;

        const creationSettings = new Jolt.BodyCreationSettings(
            shape,
            new Jolt.RVec3(position.x, position.y, position.z),
            new Jolt.Quat(rotation.x, rotation.y, rotation.z, rotation.w),
            motionType,
            layer
        );

        if (mass > 0) {
            creationSettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
            creationSettings.mMassPropertiesOverride.mMass = mass;
        }

        // Configure body properties
        creationSettings.mLinearDamping = options.linearDamping ?? 0.05;
        creationSettings.mAngularDamping = options.angularDamping ?? 0.5;
        creationSettings.mFriction = options.friction ?? 0.5;
        creationSettings.mRestitution = options.restitution ?? 0.1;
        creationSettings.mGravityFactor = options.gravityFactor ?? 1.0;

        const body = this.bodyInterface.CreateBody(creationSettings);
        const bodyId = body.GetID();

        this.bodyInterface.AddBody(bodyId, Jolt.EActivation_Activate);

        Jolt.destroy(creationSettings);

        // Track the body
        const bodyInfo = {
            id: bodyId.GetIndexAndSequenceNumber(),
            type: options.isVehicle ? 'vehicle' : 'dynamic',
            entityId: entityId,
            body: body,
            mass: mass,
            halfExtents: halfExtents
        };

        this.bodies.set(bodyInfo.id, bodyInfo);
        this.entityBodies.set(entityId, bodyInfo.id);

        return bodyInfo;
    }

    /**
     * Create a capsule body for players
     */
    createCapsuleBody(entityId, position, height, radius, mass, options = {}) {
        const Jolt = this.Jolt;

        // Capsule with height as the cylinder part (total height = height + 2*radius)
        const shape = new Jolt.CapsuleShape(height / 2, radius);

        const creationSettings = new Jolt.BodyCreationSettings(
            shape,
            new Jolt.RVec3(position.x, position.y + height/2 + radius, position.z),
            new Jolt.Quat(0, 0, 0, 1),
            Jolt.EMotionType_Dynamic,
            LAYER_PLAYER
        );

        creationSettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
        creationSettings.mMassPropertiesOverride.mMass = mass;

        // Player-specific settings
        creationSettings.mLinearDamping = 0.0;
        creationSettings.mAngularDamping = 0.0;
        creationSettings.mFriction = 0.5;
        creationSettings.mRestitution = 0.0;
        creationSettings.mAllowSleeping = false;

        // Lock rotation for character controller
        creationSettings.mAllowedDOFs = Jolt.EAllowedDOFs_TranslationX |
                                        Jolt.EAllowedDOFs_TranslationY |
                                        Jolt.EAllowedDOFs_TranslationZ;

        const body = this.bodyInterface.CreateBody(creationSettings);
        const bodyId = body.GetID();

        this.bodyInterface.AddBody(bodyId, Jolt.EActivation_Activate);

        Jolt.destroy(creationSettings);

        const bodyInfo = {
            id: bodyId.GetIndexAndSequenceNumber(),
            type: 'player',
            entityId: entityId,
            body: body,
            mass: mass,
            height: height,
            radius: radius,
            grounded: false
        };

        this.bodies.set(bodyInfo.id, bodyInfo);
        this.entityBodies.set(entityId, bodyInfo.id);

        return bodyInfo;
    }

    /**
     * Create a vehicle with wheel constraints
     */
    createVehicle(entityId, vehicleType, position, rotation) {
        const Jolt = this.Jolt;

        // Vehicle configurations
        const VEHICLE_CONFIGS = {
            tank: {
                halfExtents: { x: 2.8, y: 1.1, z: 4.25 },
                mass: 12000,
                wheels: [
                    { pos: { x: 2.5, y: -0.2, z: 3.5 }, radius: 0.5, width: 0.4 },
                    { pos: { x: -2.5, y: -0.2, z: 3.5 }, radius: 0.5, width: 0.4 },
                    { pos: { x: 2.5, y: -0.2, z: -3.5 }, radius: 0.5, width: 0.4 },
                    { pos: { x: -2.5, y: -0.2, z: -3.5 }, radius: 0.5, width: 0.4 }
                ],
                maxEngineTorque: 800,
                maxSteerAngle: 0.5
            },
            jeep: {
                halfExtents: { x: 1.2, y: 0.9, z: 2.3 },
                mass: 2000,
                wheels: [
                    { pos: { x: 1.2, y: -0.2, z: 1.6 }, radius: 0.5, width: 0.3 },
                    { pos: { x: -1.2, y: -0.2, z: 1.6 }, radius: 0.5, width: 0.3 },
                    { pos: { x: 1.2, y: -0.2, z: -1.6 }, radius: 0.5, width: 0.3 },
                    { pos: { x: -1.2, y: -0.2, z: -1.6 }, radius: 0.5, width: 0.3 }
                ],
                maxEngineTorque: 400,
                maxSteerAngle: 0.6
            },
            helicopter: {
                halfExtents: { x: 1.5, y: 1.5, z: 4.5 },
                mass: 1800,
                wheels: [], // No wheels for helicopter
                isHelicopter: true
            }
        };

        const config = VEHICLE_CONFIGS[vehicleType] || VEHICLE_CONFIGS.jeep;

        // Create vehicle body
        const bodyInfo = this.createBoxBody(entityId, position, rotation, config.halfExtents, config.mass, {
            isVehicle: true,
            linearDamping: config.isHelicopter ? 0.1 : 0.05,
            angularDamping: config.isHelicopter ? 0.5 : 0.3,
            friction: 0.3,
            gravityFactor: config.isHelicopter ? 0.0 : 1.0 // Helicopter controls its own lift
        });

        bodyInfo.vehicleType = vehicleType;
        bodyInfo.vehicleConfig = config;
        bodyInfo.inputs = { throttle: 0, steer: 0, brake: false, lift: 0, pitch: 0, roll: 0, yaw: 0 };

        return bodyInfo;
    }

    /**
     * Apply input to a vehicle
     */
    applyVehicleInput(entityId, inputs) {
        const bodyId = this.entityBodies.get(entityId);
        if (!bodyId) return;

        const bodyInfo = this.bodies.get(bodyId);
        if (!bodyInfo || bodyInfo.type !== 'vehicle') return;

        bodyInfo.inputs = { ...bodyInfo.inputs, ...inputs };
    }

    /**
     * Apply input to a player
     */
    applyPlayerInput(entityId, inputs) {
        const bodyId = this.entityBodies.get(entityId);
        if (!bodyId) return;

        const bodyInfo = this.bodies.get(bodyId);
        if (!bodyInfo || bodyInfo.type !== 'player') return;

        const Jolt = this.Jolt;
        const body = bodyInfo.body;

        // Calculate movement velocity based on inputs
        const speed = inputs.running ? 35.0 : 20.0;
        const moveX = (inputs.right ? 1 : 0) - (inputs.left ? 1 : 0);
        const moveZ = (inputs.forward ? 1 : 0) - (inputs.backward ? 1 : 0);

        // Get current velocity
        const currentVel = body.GetLinearVelocity();

        // Calculate desired horizontal velocity
        let vx = moveX * speed;
        let vz = moveZ * speed;

        // Apply rotation (must match Three.js applyAxisAngle(Y, angle) which is counterclockwise)
        if (inputs.rotationY !== undefined) {
            const cos = Math.cos(inputs.rotationY);
            const sin = Math.sin(inputs.rotationY);
            // Three.js Y-axis rotation: x' = x*cos + z*sin, z' = -x*sin + z*cos
            const rx = vx * cos + vz * sin;
            const rz = -vx * sin + vz * cos;
            vx = rx;
            vz = rz;
        }

        // Preserve vertical velocity, apply horizontal
        let vy = currentVel.GetY();

        // Jump
        if (inputs.jump && bodyInfo.grounded) {
            vy = 15.5; // Jump speed
        }

        this.bodyInterface.SetLinearVelocity(
            body.GetID(),
            new Jolt.Vec3(vx, vy, vz)
        );
    }

    /**
     * Process vehicle physics (called during step)
     */
    updateVehicles(delta) {
        const Jolt = this.Jolt;

        for (const [bodyId, bodyInfo] of this.bodies) {
            if (bodyInfo.type !== 'vehicle') continue;

            const body = bodyInfo.body;
            const config = bodyInfo.vehicleConfig;
            const inputs = bodyInfo.inputs || {};

            if (config.isHelicopter) {
                // Helicopter physics
                this.updateHelicopterPhysics(bodyInfo, delta);
            } else {
                // Ground vehicle physics
                this.updateGroundVehiclePhysics(bodyInfo, delta);
            }
        }
    }

    updateHelicopterPhysics(bodyInfo, delta) {
        const Jolt = this.Jolt;
        const body = bodyInfo.body;
        const inputs = bodyInfo.inputs;
        const mass = bodyInfo.mass;

        // Get current state
        const pos = body.GetPosition();
        const rot = body.GetRotation();
        const vel = body.GetLinearVelocity();
        const angVel = body.GetAngularVelocity();

        // Hover force (counters gravity when lift = 0)
        const gravity = Math.abs(PHYSICS_CONFIG.gravity);
        const hoverForce = mass * gravity;

        // Lift input adds/subtracts from hover
        const liftInput = inputs.lift || 0;
        const totalLift = hoverForce * (1 + liftInput * 0.8);

        // Apply lift force in world up direction (rotated by helicopter orientation)
        const upLocal = new Jolt.Vec3(0, 1, 0);
        const upWorld = rot.RotateAxisX(upLocal);

        const liftForce = new Jolt.Vec3(
            upWorld.GetX() * totalLift,
            upWorld.GetY() * totalLift,
            upWorld.GetZ() * totalLift
        );

        body.AddForce(liftForce);

        // Pitch/roll/yaw torques
        const pitchTorque = (inputs.pitch || 0) * 50000;
        const rollTorque = -(inputs.roll || 0) * 50000;
        const yawTorque = (inputs.yaw || 0) * 25000;

        body.AddTorque(new Jolt.Vec3(pitchTorque, yawTorque, rollTorque));

        // Damping
        const dampedVel = new Jolt.Vec3(
            vel.GetX() * 0.995,
            vel.GetY() * 0.995,
            vel.GetZ() * 0.995
        );
        this.bodyInterface.SetLinearVelocity(body.GetID(), dampedVel);

        const dampedAngVel = new Jolt.Vec3(
            angVel.GetX() * 0.95,
            angVel.GetY() * 0.95,
            angVel.GetZ() * 0.95
        );
        this.bodyInterface.SetAngularVelocity(body.GetID(), dampedAngVel);

        Jolt.destroy(upLocal);
    }

    updateGroundVehiclePhysics(bodyInfo, delta) {
        const Jolt = this.Jolt;
        const body = bodyInfo.body;
        const inputs = bodyInfo.inputs;
        const config = bodyInfo.vehicleConfig;

        // Get current state
        const pos = body.GetPosition();
        const rot = body.GetRotation();
        const vel = body.GetLinearVelocity();

        // Calculate forward direction
        const forwardLocal = new Jolt.Vec3(0, 0, 1);
        const forward = rot.RotateAxisX(forwardLocal);

        // Engine force
        const throttle = inputs.throttle || 0;
        const engineForce = throttle * (config.maxEngineTorque || 400) * 100;

        body.AddForce(new Jolt.Vec3(
            forward.GetX() * engineForce,
            0,
            forward.GetZ() * engineForce
        ));

        // Steering torque
        const steer = inputs.steer || 0;
        const speed = Math.sqrt(vel.GetX() * vel.GetX() + vel.GetZ() * vel.GetZ());
        const steerTorque = steer * speed * bodyInfo.mass * 2;

        body.AddTorque(new Jolt.Vec3(0, steerTorque, 0));

        // Brake
        if (inputs.brake) {
            const brakeForce = 0.95;
            const brakeedVel = new Jolt.Vec3(
                vel.GetX() * brakeForce,
                vel.GetY(),
                vel.GetZ() * brakeForce
            );
            this.bodyInterface.SetLinearVelocity(body.GetID(), brakeedVel);
        }

        Jolt.destroy(forwardLocal);
    }

    /**
     * Check if player is grounded
     */
    updatePlayerGroundState(bodyInfo) {
        const Jolt = this.Jolt;
        const body = bodyInfo.body;

        // Cast a ray downward from the player
        const pos = body.GetPosition();
        const rayOrigin = new Jolt.RVec3(pos.GetX(), pos.GetY(), pos.GetZ());
        const rayDir = new Jolt.Vec3(0, -1, 0);

        const rayLength = bodyInfo.height / 2 + bodyInfo.radius + 0.1;

        // Simple ground check based on velocity
        const vel = body.GetLinearVelocity();
        bodyInfo.grounded = Math.abs(vel.GetY()) < 0.5 && pos.GetY() < bodyInfo.height + 1;

        Jolt.destroy(rayOrigin);
        Jolt.destroy(rayDir);
    }

    /**
     * Step the physics simulation
     */
    step(deltaTime) {
        if (!this.joltInterface) return;

        const startTime = performance.now();

        // Update vehicles with their inputs
        this.updateVehicles(deltaTime);

        // Update player ground states
        for (const [bodyId, bodyInfo] of this.bodies) {
            if (bodyInfo.type === 'player') {
                this.updatePlayerGroundState(bodyInfo);
            }
        }

        // Fixed timestep accumulation
        this.accumulator += deltaTime;

        let steps = 0;
        while (this.accumulator >= PHYSICS_CONFIG.fixedTimeStep && steps < PHYSICS_CONFIG.maxSubSteps) {
            this.joltInterface.Step(
                PHYSICS_CONFIG.fixedTimeStep,
                1 // Collision steps
            );
            this.accumulator -= PHYSICS_CONFIG.fixedTimeStep;
            steps++;
        }

        // Prevent spiral of death
        if (this.accumulator > PHYSICS_CONFIG.fixedTimeStep * PHYSICS_CONFIG.maxSubSteps) {
            this.accumulator = 0;
        }

        this.stepCount++;
        this.lastStepTime = performance.now() - startTime;
    }

    /**
     * Get body state for network sync
     */
    getBodyState(entityId) {
        const bodyId = this.entityBodies.get(entityId);
        if (!bodyId) return null;

        const bodyInfo = this.bodies.get(bodyId);
        if (!bodyInfo) return null;

        const Jolt = this.Jolt;
        const body = bodyInfo.body;

        const pos = body.GetPosition();
        const rot = body.GetRotation();
        const vel = body.GetLinearVelocity();
        const angVel = body.GetAngularVelocity();

        return {
            entityId: entityId,
            type: bodyInfo.type,
            position: { x: pos.GetX(), y: pos.GetY(), z: pos.GetZ() },
            rotation: { x: rot.GetX(), y: rot.GetY(), z: rot.GetZ(), w: rot.GetW() },
            velocity: { x: vel.GetX(), y: vel.GetY(), z: vel.GetZ() },
            angularVelocity: { x: angVel.GetX(), y: angVel.GetY(), z: angVel.GetZ() },
            grounded: bodyInfo.grounded || false,
            vehicleType: bodyInfo.vehicleType
        };
    }

    /**
     * Get all body states for network broadcast
     */
    getAllBodyStates() {
        const states = [];

        for (const [entityId, bodyId] of this.entityBodies) {
            const state = this.getBodyState(entityId);
            if (state) {
                states.push(state);
            }
        }

        return states;
    }

    /**
     * Set body position directly (for teleportation)
     */
    setBodyPosition(entityId, position) {
        const bodyId = this.entityBodies.get(entityId);
        if (!bodyId) return;

        const bodyInfo = this.bodies.get(bodyId);
        if (!bodyInfo) return;

        const Jolt = this.Jolt;
        this.bodyInterface.SetPosition(
            bodyInfo.body.GetID(),
            new Jolt.RVec3(position.x, position.y, position.z),
            Jolt.EActivation_Activate
        );
    }

    /**
     * Remove a body
     */
    removeBody(entityId) {
        const bodyId = this.entityBodies.get(entityId);
        if (!bodyId) return;

        const bodyInfo = this.bodies.get(bodyId);
        if (!bodyInfo) return;

        const Jolt = this.Jolt;
        this.bodyInterface.RemoveBody(bodyInfo.body.GetID());
        this.bodyInterface.DestroyBody(bodyInfo.body.GetID());

        this.bodies.delete(bodyId);
        this.entityBodies.delete(entityId);
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.joltInterface) {
            this.Jolt.destroy(this.joltInterface);
            this.joltInterface = null;
        }

        this.bodies.clear();
        this.entityBodies.clear();
    }

    /**
     * Get physics stats
     */
    getStats() {
        return {
            bodyCount: this.bodies.size,
            stepCount: this.stepCount,
            lastStepTime: this.lastStepTime.toFixed(2) + 'ms',
            accumulator: this.accumulator.toFixed(4)
        };
    }
}

export { LAYER_STATIC, LAYER_DYNAMIC, LAYER_PLAYER, LAYER_VEHICLE };
