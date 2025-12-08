import { getTerrainHeight } from './terrain.js';
import { NetworkEntityType, NetworkVehicle } from './network-manager.js';

export class VehicleManager {
    constructor(scene, physics) {
        this.scene = scene;
        this.physics = physics;
        this.vehicles = [];
        this.projectiles = [];
        this.bombs = [];
        this.raycaster = new THREE.Raycaster();
        this.networkManager = null;
        this.vehicleSyncInterval = 0.05; // 50ms = 20 updates/sec
        this.lastSyncTime = 0;
    }

    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
        if (networkManager) {
            this.setupNetworkHandlers();
        }
    }

    setupNetworkHandlers() {
        this.networkManager.registerEntityHandler(NetworkEntityType.VEHICLE, {
            spawn: (data, clientId) => this.handleNetworkVehicleSpawn(data, clientId),
            update: (entity, data, timestamp) => this.handleNetworkVehicleUpdate(entity, data, timestamp),
            destroy: (entity) => this.handleNetworkVehicleDestroy(entity)
        });
    }

    handleNetworkVehicleSpawn(data, clientId) {
        // Find matching local vehicle by networkId or spawn position
        let vehicle = this.vehicles.find(v => v.networkId === data.id);
        if (!vehicle && data.position && data.vehicleType) {
            // Spawn new vehicle from network
            const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
            if (data.vehicleType === 'tank') {
                vehicle = this.spawnTank(pos);
            } else if (data.vehicleType === 'helicopter') {
                vehicle = this.spawnHelicopter(pos);
            } else if (data.vehicleType === 'jeep') {
                vehicle = this.spawnJeep(pos);
            }
            if (vehicle) {
                vehicle.networkId = data.id;
                vehicle.isRemote = true;
                // Apply initial heading and tilt
                if (data.heading !== undefined) {
                    vehicle.heading = data.heading;
                }
                if (data.tiltX !== undefined) vehicle.tiltX = data.tiltX;
                if (data.tiltZ !== undefined) vehicle.tiltZ = data.tiltZ;
                if (data.targetAltitude !== undefined) vehicle.targetAltitude = data.targetAltitude;
                console.log(`Spawned remote ${data.vehicleType} at`, pos);
            }
        }
        if (!vehicle) {
            console.warn('Failed to spawn vehicle from network:', data);
            return null;
        }
        const networkEntity = new NetworkVehicle(data.id);
        networkEntity.vehicleRef = vehicle;
        return networkEntity;
    }

    handleNetworkVehicleUpdate(entity, data, timestamp) {
        const vehicle = entity.vehicleRef;
        if (!vehicle || !vehicle.isRemote) return;

        // Apply interpolated position
        if (data.position) {
            vehicle.body.position.x = THREE.MathUtils.lerp(vehicle.body.position.x, data.position.x, 0.3);
            vehicle.body.position.y = THREE.MathUtils.lerp(vehicle.body.position.y, data.position.y, 0.3);
            vehicle.body.position.z = THREE.MathUtils.lerp(vehicle.body.position.z, data.position.z, 0.3);
        }
        if (data.velocity) {
            vehicle.body.velocity.set(data.velocity.x, data.velocity.y, data.velocity.z);
        }
        if (data.heading !== undefined) {
            vehicle.heading = THREE.MathUtils.lerp(vehicle.heading, data.heading, 0.4);
        }
        // Apply tilt for visual rotation
        if (data.tiltX !== undefined) {
            vehicle.tiltX = data.tiltX;
            vehicle.tilt.x = THREE.MathUtils.lerp(vehicle.tilt.x, data.rotation?.x || 0, 0.3);
        }
        if (data.tiltZ !== undefined) {
            vehicle.tiltZ = data.tiltZ;
            vehicle.tilt.z = THREE.MathUtils.lerp(vehicle.tilt.z, data.rotation?.z || 0, 0.3);
        }
        if (data.targetAltitude !== undefined) vehicle.targetAltitude = data.targetAltitude;
    }

    handleNetworkVehicleDestroy(entity) {
        const vehicle = entity.vehicleRef;
        if (!vehicle) return;
        const idx = this.vehicles.indexOf(vehicle);
        if (idx >= 0) {
            this.scene.remove(vehicle.mesh);
            this.vehicles.splice(idx, 1);
        }
    }

    registerVehicleNetwork(vehicle) {
        if (!this.networkManager || !this.networkManager.isConnected) return;

        const networkEntity = new NetworkVehicle();
        networkEntity.vehicleRef = vehicle;

        // Set all sync properties from the actual vehicle state
        networkEntity.syncProperties.vehicleType = vehicle.type;
        networkEntity.syncProperties.x = vehicle.body.position.x;
        networkEntity.syncProperties.y = vehicle.body.position.y;
        networkEntity.syncProperties.z = vehicle.body.position.z;
        networkEntity.syncProperties.heading = vehicle.heading;
        networkEntity.syncProperties.rotationX = vehicle.tilt.x;
        networkEntity.syncProperties.rotationY = vehicle.heading;
        networkEntity.syncProperties.rotationZ = vehicle.tilt.z;
        networkEntity.syncProperties.tiltX = vehicle.tiltX || 0;
        networkEntity.syncProperties.tiltZ = vehicle.tiltZ || 0;
        networkEntity.syncProperties.targetAltitude = vehicle.targetAltitude || 0;

        vehicle.networkId = networkEntity.networkId;
        vehicle.networkEntity = networkEntity;
        vehicle.isRemote = false;

        this.networkManager.registerEntity(networkEntity);
    }

    syncVehicleState(vehicle) {
        if (!this.networkManager || !this.networkManager.isConnected) return;
        if (vehicle.isRemote) return; // Don't sync remote vehicles

        const occupants = vehicle.seats.map((seat, idx) => ({
            seatIndex: idx,
            occupantId: seat.occupant ? (seat.occupant.networkId || this.networkManager.clientId) : null
        })).filter(o => o.occupantId);

        this.networkManager.queueEntityUpdate(vehicle.networkId, {
            type: 'vehicle', // Include entity type for relay server tracking
            position: { x: vehicle.body.position.x, y: vehicle.body.position.y, z: vehicle.body.position.z },
            rotation: { x: vehicle.tilt.x, y: vehicle.heading, z: vehicle.tilt.z },
            velocity: { x: vehicle.body.velocity.x, y: vehicle.body.velocity.y, z: vehicle.body.velocity.z },
            vehicleType: vehicle.type,
            heading: vehicle.heading,
            tiltX: vehicle.tiltX || 0,
            tiltZ: vehicle.tiltZ || 0,
            targetAltitude: vehicle.targetAltitude || 0,
            occupants
        });
    }

    spawnStartingVehicles(origin, registerNetwork = true) {
        const offset = new THREE.Vector3(origin.x, origin.y, origin.z);
        const tank = this.spawnTank(offset.clone().add(new THREE.Vector3(12, 0, 8)));
        const heli = this.spawnHelicopter(offset.clone().add(new THREE.Vector3(-15, 0, 12)));
        const jeep = this.spawnJeep(offset.clone().add(new THREE.Vector3(8, 0, -14)));

        // Register vehicles with network if connected
        if (registerNetwork && this.networkManager && this.networkManager.isHost) {
            this.registerVehicleNetwork(tank);
            this.registerVehicleNetwork(heli);
            this.registerVehicleNetwork(jeep);
        }
    }

    spawnTank(position) {
        const group = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.2, 8.5), new THREE.MeshStandardMaterial({ color: 0x36423c }));
        hull.position.y = 1.2;
        group.add(hull);

        const turret = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 3.2), new THREE.MeshStandardMaterial({ color: 0x3f4d45 }));
        turret.position.y = 2.6;
        group.add(turret);

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5.5, 12), new THREE.MeshStandardMaterial({ color: 0x1f1f1f }));
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 2.6, 4.2);
        group.add(barrel);

        const topGunMount = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x252525 }));
        topGunMount.position.set(0, 3.2, -0.4);
        group.add(topGunMount);

        const trackMat = new THREE.MeshStandardMaterial({ color: 0x202020 });
        const trackL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 9), trackMat);
        trackL.position.set(2.8, 0.75, 0); 
        group.add(trackL);
        const trackR = trackL.clone();
        trackR.position.x = -2.8;
        group.add(trackR);

        group.position.copy(position);
        group.position.y = getTerrainHeight(position.x, position.z) + 1.25;

        const body = this.physics.registerBody({
            position: group.position,
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            radius: 2.3,
            height: 2.4,
            mass: 8000,
            damping: 0.3,
            angularDamping: 0.92,
            friction: 0.2,
            bounciness: 0.15,
            enableAngularPhysics: true
        });

        const vehicle = {
            type: 'tank',
            mesh: group,
            body,
            vehicleColliders: [],
            heading: 0,
            tilt: new THREE.Euler(0, 0, 0, 'YXZ'),
            suspension: {
                angularVelocity: new THREE.Vector3(),
                wheelOffsets: [
                    new THREE.Vector3(2.5, 0, 3.5),   // Front Left
                    new THREE.Vector3(-2.5, 0, 3.5),  // Front Right
                    new THREE.Vector3(2.5, 0, -3.5),  // Back Left
                    new THREE.Vector3(-2.5, 0, -3.5)  // Back Right
                ],
                stiffness: 15.0,
                damping: 6.0,
                restHeight: 1.25
            },
            turretYaw: 0,
            cannonPitch: 0,
            seats: [
                { role: 'driver', occupant: null, offset: new THREE.Vector3(0, 1.4, -1) },
                { role: 'top-gunner', occupant: null, offset: new THREE.Vector3(0, 3.2, -0.4) }
            ],
            weaponCooldown: 0,
            mgCooldown: 0,
            machineGunYaw: 0,
            machineGunPitch: 0
        };

        this.scene.add(group);
        this.registerVehicleColliders(vehicle);
        this.vehicles.push(vehicle);
        return vehicle;
    }

    spawnHelicopter(position) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 9), new THREE.MeshStandardMaterial({ color: 0x2d3d4f }));
        group.add(body);

        const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 6), new THREE.MeshStandardMaterial({ color: 0x253242 }));
        tail.position.z = -6;
        group.add(tail);

        const rotor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x151515 }));
        rotor.position.y = 2.2;
        group.add(rotor);

        const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x151515 }));
        tailRotor.position.set(0, 0.6, -8.5);
        group.add(tailRotor);

        group.position.copy(position);
        const groundHeight = getTerrainHeight(position.x, position.z);
        group.position.y = groundHeight + 1.6;

        const bodyPhysics = this.physics.registerBody({
            position: group.position,
            velocity: new THREE.Vector3(),
            radius: 1.6,
            height: 3.4,
            mass: 1800,
            damping: 0.2, // Low damping for flight
            friction: 0.1,
            bounciness: 0.1
        });

        const vehicle = {
            type: 'helicopter',
            mesh: group,
            body: bodyPhysics,
            vehicleColliders: [],
            heading: 0,
            tilt: new THREE.Euler(0, 0, 0, 'YXZ'),
            tiltX: 0, // Pitch input (-1 to 1)
            tiltZ: 0, // Roll input (-1 to 1)
            rotor,
            seats: [
                { role: 'pilot', occupant: null, offset: new THREE.Vector3(0, 1.5, 1.5) },
                { role: 'turret', occupant: null, offset: new THREE.Vector3(0, 1.6, -1.5) }
            ],
            lift: 0,
            targetAltitude: group.position.y,
            weaponCooldown: 0,
            bombCooldown: 0
        };

        this.scene.add(group);
        this.registerVehicleColliders(vehicle);
        this.vehicles.push(vehicle);
        return vehicle;
    }

    spawnJeep(position) {
        const group = new THREE.Group();
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2, 10), new THREE.MeshStandardMaterial({ color: 0x4a3b2f }));
        chassis.position.y = 1.2;
        group.add(chassis);

        const cab = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.8, 4.5), new THREE.MeshStandardMaterial({ color: 0x554433 }));
        cab.position.set(0, 2.2, -1.2);
        group.add(cab);

        const gunMount = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        gunMount.position.set(0, 2.6, 1.8);
        group.add(gunMount);

        group.position.copy(position);
        group.position.y = getTerrainHeight(position.x, position.z) + 1.1;

        const body = this.physics.registerBody({
            position: group.position,
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            radius: 2.4,
            height: 2.4,
            mass: 2500,
            damping: 0.25,
            angularDamping: 0.90,
            friction: 0.25,
            bounciness: 0.2,
            enableAngularPhysics: true
        });

        const vehicle = {
            type: 'jeep',
            mesh: group,
            body,
            vehicleColliders: [],
            heading: 0,
            tilt: new THREE.Euler(0, 0, 0, 'YXZ'),
            suspension: {
                angularVelocity: new THREE.Vector3(),
                wheelOffsets: [
                    new THREE.Vector3(2.5, 0, 3.5),   // FL
                    new THREE.Vector3(-2.5, 0, 3.5),  // FR
                    new THREE.Vector3(2.5, 0, -3.5),  // BL
                    new THREE.Vector3(-2.5, 0, -3.5)  // BR
                ],
                stiffness: 18.0,
                damping: 5.0,
                restHeight: 1.1
            },
            seats: [
                { role: 'driver', occupant: null, offset: new THREE.Vector3(-1.4, 1.6, -1.6) },
                { role: 'passenger', occupant: null, offset: new THREE.Vector3(1.4, 1.6, -1.6) },
                { role: 'passenger', occupant: null, offset: new THREE.Vector3(-1.4, 1.6, 0.6) },
                { role: 'passenger', occupant: null, offset: new THREE.Vector3(1.4, 1.6, 0.6) },
                { role: 'passenger', occupant: null, offset: new THREE.Vector3(0, 1.6, -3.2) },
                { role: 'gunner', occupant: null, offset: new THREE.Vector3(0, 2.6, 1.8) }
            ],
            weaponCooldown: 0
        };

        this.scene.add(group);
        this.registerVehicleColliders(vehicle);
        this.vehicles.push(vehicle);
        return vehicle;
    }

    registerVehicleColliders(vehicle) {
        vehicle.mesh.traverse(obj => {
            obj.userData = obj.userData || {};
            obj.userData.vehicle = vehicle;
            obj.userData.type = 'vehicle';
            // IMPORTANT: Tag mesh as no collision for its own physics body to avoid self-launch
            // But we need raycasts to hit it for bullets, so physics.js handles the filtering
        });
        vehicle.vehicleColliders = this.physics.registerHierarchy(vehicle.mesh);
        if (vehicle.body) {
            vehicle.body.isVehicle = true;
            vehicle.body.vehicleRef = vehicle;
        }
    }

    findAvailableSeat(position, radius = 5) {
        let best = null;
        let bestDist = radius;
        for (const vehicle of this.vehicles) {
            for (const seat of vehicle.seats) {
                if (seat.occupant) continue;
                const seatWorld = seat.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading).add(vehicle.mesh.position);
                const dist = seatWorld.distanceTo(position);
                if (dist < bestDist) {
                    best = { vehicle, seat };
                    bestDist = dist;
                }
            }
        }
        return best;
    }

    findVehicleTarget(camera, maxDistance = 8) {
        if (!this.vehicles.length) return null;
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        this.raycaster.far = maxDistance;
        const hits = this.raycaster.intersectObjects(this.vehicles.map(v => v.mesh), true);
        if (!hits.length) return null;

        for (const hit of hits) {
            let obj = hit.object;
            while (obj && !obj.userData?.vehicle && obj.parent) obj = obj.parent;
            if (obj?.userData?.vehicle) {
                const vehicle = obj.userData.vehicle;
                const available = vehicle.seats.filter(s => !s.occupant);
                if (available.length === 0) return null;
                return { vehicle, available };
            }
        }
        return null;
    }

    listSeats(vehicle) {
        return vehicle.seats.map((seat, index) => ({
            index,
            role: seat.role,
            occupied: !!seat.occupant,
            seat
        }));
    }

    vacateSeat(vehicle, seat) {
        if (!vehicle || !seat) return;
        seat.occupant = null;
    }

    exitSeat(vehicle, seat, playerController) {
        seat.occupant = null;
        playerController.currentVehicle = null;
        playerController.seatRole = null;
        playerController.currentSeat = null;
        playerController.char.group.visible = true;
        playerController.char.group.position.copy(vehicle.mesh.position).add(new THREE.Vector3(0, 0, -3).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading));
        playerController.physicsBody.velocity.set(0, 0, 0);
        playerController.physicsBody.noCollisions = false;
        playerController.physicsBody.noGravity = false;
    }

    update(delta) {
        this.lastSyncTime += delta;
        const shouldSync = this.lastSyncTime >= this.vehicleSyncInterval;

        for (const vehicle of this.vehicles) {
            // Skip physics for remote vehicles (they're controlled by network)
            if (!vehicle.isRemote) {
                if (vehicle.type === 'tank' || vehicle.type === 'jeep') {
                    this.updateGroundVehicle(vehicle, delta);
                } else if (vehicle.type === 'helicopter') {
                    this.updateHelicopter(vehicle, delta);
                }
            } else {
                // For remote vehicles, update mesh from network state
                vehicle.mesh.position.copy(vehicle.body.position);
                // Apply full rotation with YXZ order for proper tilt display
                vehicle.mesh.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');
                // Spin rotor for helicopters
                if (vehicle.type === 'helicopter' && vehicle.rotor) {
                    vehicle.rotor.rotation.y += delta * 15;
                }
            }

            vehicle.weaponCooldown = Math.max(0, vehicle.weaponCooldown - delta);
            vehicle.mgCooldown = Math.max(0, vehicle.mgCooldown - delta);
            vehicle.bombCooldown = Math.max(0, vehicle.bombCooldown - delta);

            // Sync vehicle state over network
            if (shouldSync && !vehicle.isRemote && vehicle.networkId) {
                this.syncVehicleState(vehicle);
            }
        }

        if (shouldSync) {
            this.lastSyncTime = 0;
        }

        this.updateProjectiles(delta);
        this.updateBombs(delta);
    }

    updateGroundVehicle(vehicle, delta) {
        const body = vehicle.body;
        const susp = vehicle.suspension;

        // --- Networked Control Check ---
        const driverSeat = vehicle.seats.find(s => s.role === 'driver');
        const isBeingDriven = driverSeat && driverSeat.occupant;

        // Calculate wheel contact points
        const cosYaw = Math.cos(vehicle.heading);
        const sinYaw = Math.sin(vehicle.heading);

        const calcWheelWorldPos = (offsetX, offsetZ) => {
            const wx = offsetX * cosYaw - offsetZ * sinYaw;
            const wz = offsetX * sinYaw + offsetZ * cosYaw;
            return new THREE.Vector3(
                body.position.x + wx,
                body.position.y,
                body.position.z + wz
            );
        };

        const calcWheelHeight = (offsetX, offsetZ) => {
            const wx = offsetX * cosYaw - offsetZ * sinYaw;
            const wz = offsetX * sinYaw + offsetZ * cosYaw;
            return getTerrainHeight(body.position.x + wx, body.position.z + wz);
        };

        const hFL = calcWheelHeight(susp.wheelOffsets[0].x, susp.wheelOffsets[0].z);
        const hFR = calcWheelHeight(susp.wheelOffsets[1].x, susp.wheelOffsets[1].z);
        const hBL = calcWheelHeight(susp.wheelOffsets[2].x, susp.wheelOffsets[2].z);
        const hBR = calcWheelHeight(susp.wheelOffsets[3].x, susp.wheelOffsets[3].z);

        const avgGroundHeight = (hFL + hFR + hBL + hBR) / 4;
        const heightAboveGround = body.position.y - avgGroundHeight;

        // Determine if vehicle is airborne
        const isAirborne = heightAboveGround > susp.restHeight + 0.5;

        // Calculate terrain slope
        const frontH = (hFL + hFR) / 2;
        const backH = (hBL + hBR) / 2;
        const leftH = (hFL + hBL) / 2;
        const rightH = (hFR + hBR) / 2;

        const length = Math.abs(susp.wheelOffsets[0].z - susp.wheelOffsets[2].z);
        const width = Math.abs(susp.wheelOffsets[0].x - susp.wheelOffsets[1].x);

        const terrainPitch = Math.atan2(backH - frontH, length);
        const terrainRoll = Math.atan2(leftH - rightH, width);

        if (isAirborne) {
            // --- AIRBORNE PHYSICS (Tumbling) ---
            // Apply angular momentum from body's angular velocity
            vehicle.tilt.x += body.angularVelocity.x * delta;
            vehicle.tilt.z += body.angularVelocity.z * delta;

            // Slow air rotation slightly
            body.angularVelocity.multiplyScalar(0.995);

            // Apply slight self-righting tendency (like GTA vehicles)
            const rightingForce = 0.5;
            body.angularVelocity.x -= vehicle.tilt.x * rightingForce * delta;
            body.angularVelocity.z -= vehicle.tilt.z * rightingForce * delta;
        } else {
            // --- GROUNDED PHYSICS ---

            // Check if vehicle is flipped (upside down)
            const isFlipped = Math.abs(vehicle.tilt.x) > Math.PI / 2 || Math.abs(vehicle.tilt.z) > Math.PI / 2;

            if (isFlipped) {
                // Flipped vehicle - apply torque to try to right itself slowly
                const flipRecoveryRate = 0.3;
                body.angularVelocity.x -= Math.sign(vehicle.tilt.x) * flipRecoveryRate * delta;
                body.angularVelocity.z -= Math.sign(vehicle.tilt.z) * flipRecoveryRate * delta;

                vehicle.tilt.x += body.angularVelocity.x * delta;
                vehicle.tilt.z += body.angularVelocity.z * delta;

                // High friction when flipped
                body.velocity.x *= 0.95;
                body.velocity.z *= 0.95;
            } else {
                // Normal grounded physics
                const surfaceFriction = body.grounded ? 0.98 : 0.995;
                body.velocity.x *= surfaceFriction;
                body.velocity.z *= surfaceFriction;

                // Calculate target tilt based on terrain
                const targetPitch = terrainPitch;
                const targetRoll = terrainRoll;

                // Spring dynamics for suspension
                const pitchError = targetPitch - vehicle.tilt.x;
                const rollError = targetRoll - vehicle.tilt.z;

                // Transfer some momentum to angular velocity when hitting bumps
                const speed = Math.hypot(body.velocity.x, body.velocity.z);
                const bumpTransfer = speed * 0.02;

                if (Math.abs(pitchError) > 0.1) {
                    body.angularVelocity.x += pitchError * bumpTransfer * delta;
                }
                if (Math.abs(rollError) > 0.1) {
                    body.angularVelocity.z += rollError * bumpTransfer * delta;
                }

                // Apply suspension spring forces
                susp.angularVelocity.x += (pitchError * susp.stiffness - susp.angularVelocity.x * susp.damping) * delta;
                susp.angularVelocity.z += (rollError * susp.stiffness - susp.angularVelocity.z * susp.damping) * delta;

                // Combine suspension and rigid body angular velocity
                const combinedAngularX = susp.angularVelocity.x + body.angularVelocity.x * 0.3;
                const combinedAngularZ = susp.angularVelocity.z + body.angularVelocity.z * 0.3;

                vehicle.tilt.x += combinedAngularX * delta;
                vehicle.tilt.z += combinedAngularZ * delta;

                // Dampen rigid body angular velocity when grounded
                body.angularVelocity.x *= 0.92;
                body.angularVelocity.z *= 0.92;

                // Clamp tilt angles when grounded (can still flip if going fast)
                const maxGroundTilt = 0.6; // ~35 degrees
                if (Math.abs(vehicle.tilt.x) > maxGroundTilt && Math.abs(body.angularVelocity.x) < 2) {
                    vehicle.tilt.x = THREE.MathUtils.clamp(vehicle.tilt.x, -maxGroundTilt, maxGroundTilt);
                }
                if (Math.abs(vehicle.tilt.z) > maxGroundTilt && Math.abs(body.angularVelocity.z) < 2) {
                    vehicle.tilt.z = THREE.MathUtils.clamp(vehicle.tilt.z, -maxGroundTilt, maxGroundTilt);
                }

                // Apply ground height
                if (body.grounded) {
                    const targetY = avgGroundHeight + susp.restHeight;
                    const heightDiff = targetY - body.position.y;
                    if (heightDiff > 0) {
                        body.position.y = THREE.MathUtils.lerp(body.position.y, targetY, delta * 12);
                    }
                }
            }
        }

        // If driven, update heading based on angular Y velocity
        if (isBeingDriven) {
            vehicle.heading += body.angularVelocity.y * delta;
        } else {
            // Unoccupied vehicle - apply higher friction
            body.velocity.x *= 0.96;
            body.velocity.z *= 0.96;
            body.angularVelocity.y *= 0.95;
        }

        // Update mesh transform
        vehicle.mesh.position.copy(body.position);
        vehicle.mesh.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');

        // Sync body rotation for network
        body.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');
    }

    updateHelicopter(vehicle, delta) {
        const body = vehicle.body;
        vehicle.rotor.rotation.y += delta * 15;

        // --- Networked Control Check ---
        const pilotSeat = vehicle.seats.find(s => s.role === 'pilot');
        const occupied = pilotSeat && pilotSeat.occupant;

        // --- THRUST VECTORING PHYSICS ---

        if (occupied) {
            // 1. Altitude Control (Collective)
            const ground = getTerrainHeight(body.position.x, body.position.z);
            const minAltitude = ground + 1.6;

            const desiredAltitude = Math.max(vehicle.targetAltitude, minAltitude);
            vehicle.targetAltitude = THREE.MathUtils.lerp(vehicle.targetAltitude, desiredAltitude, delta * 2);

            const error = vehicle.targetAltitude - body.position.y;
            const targetVertical = error * 3.0 + vehicle.lift * 4.0;

            body.velocity.y = THREE.MathUtils.lerp(body.velocity.y, targetVertical, delta * 4);

            // 2. Horizontal Movement (Cyclic) - PITCH CONTROLS FORWARD MOVEMENT
            const cosY = Math.cos(vehicle.heading);
            const sinY = Math.sin(vehicle.heading);

            // Forward vector based on heading
            const forward = new THREE.Vector3(sinY, 0, cosY);
            const right = new THREE.Vector3(cosY, 0, -sinY);

            // Much higher thrust for responsive movement
            const thrustPower = 120.0;
            const strafepower = 80.0;

            // tiltX > 0 = pitched forward = move forward
            // Apply thrust directly proportional to tilt angle
            const forwardThrust = vehicle.tiltX * thrustPower;
            const strafeThrust = vehicle.tiltZ * strafepower;

            // Apply acceleration (not just velocity)
            body.velocity.x += forward.x * forwardThrust * delta;
            body.velocity.z += forward.z * forwardThrust * delta;
            body.velocity.x += right.x * strafeThrust * delta;
            body.velocity.z += right.z * strafeThrust * delta;

            // Air drag - slows down when not thrusting
            const dragFactor = 0.96;
            body.velocity.x *= dragFactor;
            body.velocity.z *= dragFactor;

            // Max speed limit
            const maxSpeed = 45;
            const speed = Math.hypot(body.velocity.x, body.velocity.z);
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                body.velocity.x *= scale;
                body.velocity.z *= scale;
            }

            // Visual tilt - use YXZ Euler order so pitch/roll are relative to helicopter's heading
            // tiltX > 0 = moving forward = nose pitches DOWN (positive X rotation)
            // tiltZ > 0 = strafing right = roll right (positive Z rotation)
            const targetPitch = vehicle.tiltX;  // Positive tiltX = forward = nose down
            const targetRoll = vehicle.tiltZ;
            vehicle.tilt.x = THREE.MathUtils.lerp(vehicle.tilt.x, targetPitch, delta * 6);
            vehicle.tilt.z = THREE.MathUtils.lerp(vehicle.tilt.z, targetRoll, delta * 6);
            vehicle.mesh.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');

        } else {
            // --- UNMANNED PHYSICS (falling/crashing) ---
            vehicle.lift = 0;
            vehicle.targetAltitude = body.position.y - 5; // Fall

            // Decay tilt values
            vehicle.tiltX *= 0.95;
            vehicle.tiltZ *= 0.95;

            body.velocity.x *= 0.995;
            body.velocity.z *= 0.995;

            // Auto-level slowly using YXZ order
            vehicle.tilt.x = THREE.MathUtils.lerp(vehicle.tilt.x, 0, delta * 0.5);
            vehicle.tilt.z = THREE.MathUtils.lerp(vehicle.tilt.z, 0, delta * 0.5);
            vehicle.mesh.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');
        }

        vehicle.mesh.position.copy(body.position);
    }

    updateProjectiles(delta) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            proj.mesh.position.addScaledVector(proj.velocity, delta);
            proj.life -= delta;
            if (proj.life <= 0) {
                this.scene.remove(proj.mesh);
                this.projectiles.splice(i, 1);
            }
        }
    }

    updateBombs(delta) {
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const bomb = this.bombs[i];
            bomb.velocity.y -= 9.8 * delta;
            bomb.mesh.position.addScaledVector(bomb.velocity, delta);
            const ground = getTerrainHeight(bomb.mesh.position.x, bomb.mesh.position.z);
            if (bomb.mesh.position.y <= ground + 0.5) {
                this.createExplosion(bomb.mesh.position, 6);
                this.scene.remove(bomb.mesh);
                this.bombs.splice(i, 1);
            }
        }
    }

    createTracer(position, direction, color = 0xffaa55, life = 0.8, speed = 120) {
        const geo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
        const mat = new THREE.MeshBasicMaterial({ color });
        const tracer = new THREE.Mesh(geo, mat);
        tracer.position.copy(position);
        tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
        this.scene.add(tracer);
        this.projectiles.push({ mesh: tracer, velocity: direction.clone().setLength(speed), life });
    }

    createExplosion(position, radius = 4) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7 }));
        mesh.position.copy(position);
        this.scene.add(mesh);
        setTimeout(() => this.scene.remove(mesh), 300);
    }

    dropBomb(vehicle) {
        if (vehicle.bombCooldown > 0) return;
        const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        const start = vehicle.mesh.position.clone().add(new THREE.Vector3(0, -1.5, 0));
        bomb.position.copy(start);
        this.scene.add(bomb);
        this.bombs.push({ mesh: bomb, velocity: vehicle.body.velocity.clone().add(new THREE.Vector3(0, -4, 0)) });
        vehicle.bombCooldown = 2.5;
    }

    fireWeapon(vehicle, seatRole, direction) {
        if (vehicle.type === 'tank') {
            if (seatRole === 'driver' && vehicle.weaponCooldown <= 0) {
                const muzzle = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 2.6, 4.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.turretYaw + vehicle.heading));
                const dir = new THREE.Vector3(Math.sin(vehicle.turretYaw + vehicle.heading), Math.sin(vehicle.cannonPitch), Math.cos(vehicle.turretYaw + vehicle.heading)).normalize();
                this.createTracer(muzzle, dir, 0xffd18f, 1.4, 160);
                vehicle.weaponCooldown = 2.2;
                this.createExplosion(muzzle.clone().add(dir.clone().multiplyScalar(2)), 1.2);
            }
            if ((seatRole === 'top-gunner' || seatRole === 'driver') && vehicle.mgCooldown <= 0) {
                const gun = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 3.2, -0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading));
                const dir = direction || new THREE.Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
                this.createTracer(gun, dir.normalize(), 0xffaa55, 0.6, 90);
                vehicle.mgCooldown = 0.08;
            }
        } else if (vehicle.type === 'helicopter') {
            // Only Pilot can drop bombs
            if (seatRole === 'turret' && vehicle.weaponCooldown <= 0) {
                const nose = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 3.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading));
                const dir = direction || new THREE.Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
                this.createTracer(nose, dir.normalize(), 0xffee88, 0.6, 120);
                vehicle.weaponCooldown = 0.12;
            }
            if (seatRole === 'pilot') {
                this.dropBomb(vehicle);
            }
        } else if (vehicle.type === 'jeep') {
            if (seatRole === 'gunner' && vehicle.weaponCooldown <= 0) {
                const mount = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 2.6, 1.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading));
                const dir = direction || new THREE.Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
                this.createTracer(mount, dir.normalize(), 0xffaa55, 0.5, 100);
                vehicle.weaponCooldown = 0.1;
            }
        }
    }
}