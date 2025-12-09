import { getTerrainHeight } from './terrain.js';
import { NetworkEntityType, NetworkVehicle } from './network-manager.js';
import { CONFIG } from './config.js'; //

export class VehicleManager {
    constructor(scene, physics) {
        this.scene = scene;
        this.physics = physics;
        this.vehicles = [];
        this.projectiles = [];
        this.bombs = [];
        this.raycaster = new THREE.Raycaster();
        this.networkManager = null;
        this.vehicleSyncInterval = 0.05; 
        this.lastSyncTime = 0;
        
        // Use configured gravity
        this.GRAVITY = CONFIG.gravity || 9.81;
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
        let vehicle = this.vehicles.find(v => v.networkId === data.id);
        if (!vehicle) {
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
                if (this.networkManager.isHost && data.ownerId === 'server') {
                    vehicle.isRemote = false;
                } else {
                    vehicle.isRemote = true;
                }
            }
        }
        const networkEntity = new NetworkVehicle(data.id);
        networkEntity.vehicleRef = vehicle;
        if (data.ownerId) networkEntity.ownerId = data.ownerId;
        return networkEntity;
    }

    handleNetworkVehicleUpdate(entity, data, timestamp) {
        const vehicle = entity.vehicleRef;
        if (!vehicle || !vehicle.isRemote) return;

        if (data.position) {
            vehicle.body.position.lerp(new THREE.Vector3(data.position.x, data.position.y, data.position.z), 0.3);
        }
        if (data.velocity) {
            vehicle.body.velocity.set(data.velocity.x, data.velocity.y, data.velocity.z);
        }
        if (data.rotation) {
             vehicle.tilt.set(data.rotation.x, data.rotation.y, data.rotation.z, 'YXZ');
             vehicle.heading = data.rotation.y;
        } else if (data.heading !== undefined) {
             vehicle.heading = data.heading;
        }
        
        vehicle.mesh.position.copy(vehicle.body.position);
        vehicle.mesh.rotation.copy(vehicle.tilt);

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
        networkEntity.syncProperties.vehicleType = vehicle.type;
        vehicle.networkId = networkEntity.networkId;
        vehicle.networkEntity = networkEntity;
        vehicle.isRemote = false;
        this.networkManager.registerEntity(networkEntity);
    }

    syncVehicleState(vehicle) {
        if (!this.networkManager || !this.networkManager.isConnected) return;
        if (vehicle.isRemote) return;

        const occupants = vehicle.seats.map((seat, idx) => ({
            seatIndex: idx,
            occupantId: seat.occupant ? (seat.occupant.networkId || this.networkManager.clientId) : null
        })).filter(o => o.occupantId);

        this.networkManager.queueEntityUpdate(vehicle.networkId, {
            type: 'vehicle',
            id: vehicle.networkId,
            position: { x: vehicle.body.position.x, y: vehicle.body.position.y, z: vehicle.body.position.z },
            rotation: { x: vehicle.body.rotation.x, y: vehicle.body.rotation.y, z: vehicle.body.rotation.z },
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
        trackL.position.set(2.8, 0.75, 0); group.add(trackL);
        const trackR = trackL.clone();
        trackR.position.x = -2.8; group.add(trackR);

        group.position.copy(position);
        group.position.y = getTerrainHeight(position.x, position.z) + 2.0;

        const body = this.physics.registerBody({
            position: group.position,
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            radius: 3.0, 
            height: 2.5,
            mass: 12000,
            damping: 0.05, 
            angularDamping: 0.8, // Increased damping to prevent uncontrollable spin
            friction: 0.5,
            bounciness: 0.1,
            enableAngularPhysics: true
        });

        const vehicle = {
            type: 'tank',
            mesh: group,
            body,
            vehicleColliders: [],
            heading: 0,
            tilt: new THREE.Euler(0, 0, 0, 'YXZ'),
            inputs: { throttle: 0, steer: 0, brake: false },
            dims: new THREE.Vector3(5.6, 2.2, 8.5),
            suspension: {
                wheelOffsets: [
                    new THREE.Vector3(2.5, -0.2, 3.5), new THREE.Vector3(-2.5, -0.2, 3.5),
                    new THREE.Vector3(2.5, -0.2, -3.5), new THREE.Vector3(-2.5, -0.2, -3.5)
                ],
                restLength: 1.0,
                travel: 0.8,
                stiffness: 400000, 
                damping: 15000,
                friction: 20000, 
                engineForce: 250000 
            },
            turretYaw: 0,
            cannonPitch: 0,
            seats: [
                { role: 'driver', occupant: null, offset: new THREE.Vector3(0, 1.4, -1) },
                { role: 'top-gunner', occupant: null, offset: new THREE.Vector3(0, 3.2, -0.4) }
            ],
            weaponCooldown: 0,
            mgCooldown: 0
        };

        this.scene.add(group);
        this.registerVehicleColliders(vehicle);
        this.vehicles.push(vehicle);
        return vehicle;
    }

    spawnJeep(position) {
        const group = new THREE.Group();
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 4.5), new THREE.MeshStandardMaterial({ color: 0x4a3b2f }));
        chassis.position.y = 0.8;
        group.add(chassis);
        const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 4.6), new THREE.MeshStandardMaterial({ color: 0x554433 }));
        bodyMesh.position.y = 1.4;
        group.add(bodyMesh);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.2, 2.5), new THREE.MeshStandardMaterial({ color: 0x333333, transparent:true, opacity:0.3 }));
        cab.position.set(0, 2.4, -0.5);
        group.add(cab);
        const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12);
        wheelGeo.rotateZ(Math.PI/2);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
        [[1.2, 0.5, 1.5], [-1.2, 0.5, 1.5], [1.2, 0.5, -1.5], [-1.2, 0.5, -1.5]].forEach(p => {
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            w.position.set(...p);
            group.add(w);
        });

        group.position.copy(position);
        group.position.y = getTerrainHeight(position.x, position.z) + 2.0;

        const body = this.physics.registerBody({
            position: group.position,
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            radius: 2.0,
            height: 2.0,
            mass: 2000,
            damping: 0.02,
            angularDamping: 0.5,
            friction: 0.3,
            bounciness: 0.1,
            enableAngularPhysics: true
        });

        const vehicle = {
            type: 'jeep',
            mesh: group,
            body,
            vehicleColliders: [],
            heading: 0,
            tilt: new THREE.Euler(0, 0, 0, 'YXZ'),
            inputs: { throttle: 0, steer: 0, brake: false },
            dims: new THREE.Vector3(2.4, 1.8, 4.6),
            suspension: {
                wheelOffsets: [
                    new THREE.Vector3(1.2, -0.2, 1.6), new THREE.Vector3(-1.2, -0.2, 1.6),
                    new THREE.Vector3(1.2, -0.2, -1.6), new THREE.Vector3(-1.2, -0.2, -1.6)
                ],
                restLength: 0.8,
                travel: 0.6,
                stiffness: 80000, 
                damping: 5000,
                friction: 2500, 
                engineForce: 45000
            },
            seats: [
                { role: 'driver', occupant: null, offset: new THREE.Vector3(-0.6, 1.5, 0.5) },
                { role: 'passenger', occupant: null, offset: new THREE.Vector3(0.6, 1.5, 0.5) },
                { role: 'gunner', occupant: null, offset: new THREE.Vector3(0, 2.0, -1.0) }
            ],
            weaponCooldown: 0
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
            angularVelocity: new THREE.Vector3(),
            rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
            radius: 1.6,
            height: 3.4,
            mass: 1800,
            damping: 0.05, 
            friction: 0.1,
            bounciness: 0.1,
            enableAngularPhysics: true 
        });

        const vehicle = {
            type: 'helicopter',
            mesh: group,
            body: bodyPhysics,
            vehicleColliders: [],
            heading: 0,
            tilt: new THREE.Euler(0, 0, 0, 'YXZ'),
            inputs: { pitch: 0, roll: 0, yaw: 0, lift: 0 },
            dims: new THREE.Vector3(3, 3, 9),
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

    registerVehicleColliders(vehicle) {
        vehicle.mesh.traverse(obj => {
            obj.userData = obj.userData || {};
            obj.userData.vehicle = vehicle;
            obj.userData.type = 'vehicle';
        });
        vehicle.vehicleColliders = this.physics.registerHierarchy(vehicle.mesh);
        if (vehicle.body) {
            vehicle.body.isVehicle = true;
            vehicle.body.vehicleRef = vehicle;
            vehicle.body.noGravity = false; 
        }
    }

    applyForceAtLocalPoint(vehicle, force, localPoint, delta) {
        const body = vehicle.body;
        const acceleration = force.clone().divideScalar(body.mass);
        body.velocity.add(acceleration.multiplyScalar(delta));
        const r = localPoint.clone().applyEuler(body.rotation);
        const torque = r.clone().cross(force);
        
        // FIX: Reduced inertia for faster turning response
        const inertia = body.mass * (vehicle.type === 'tank' ? 2.0 : 0.8); 
        
        body.angularVelocity.add(torque.divideScalar(inertia).multiplyScalar(delta));
    }

    update(delta) {
        this.lastSyncTime += delta;
        const shouldSync = this.lastSyncTime >= this.vehicleSyncInterval;

        for (const vehicle of this.vehicles) {
            if (!vehicle.isRemote) {
                if (vehicle.type === 'tank' || vehicle.type === 'jeep') {
                    this.updateGroundVehicle(vehicle, delta);
                } else if (vehicle.type === 'helicopter') {
                    this.updateHelicopter(vehicle, delta);
                }
                
                // Chassis Collision (Scraping/Tumbling)
                this.updateChassisCollision(vehicle, delta);

                vehicle.mesh.position.copy(vehicle.body.position);
                vehicle.mesh.rotation.copy(vehicle.body.rotation);
                vehicle.heading = vehicle.body.rotation.y;
                vehicle.tilt.copy(vehicle.body.rotation);
            } else {
                if (vehicle.type === 'helicopter' && vehicle.rotor) {
                    vehicle.rotor.rotation.y += delta * 15;
                }
            }

            vehicle.weaponCooldown = Math.max(0, vehicle.weaponCooldown - delta);
            vehicle.mgCooldown = Math.max(0, vehicle.mgCooldown - delta);
            vehicle.bombCooldown = Math.max(0, vehicle.bombCooldown - delta);

            if (shouldSync && !vehicle.isRemote && vehicle.networkId) {
                this.syncVehicleState(vehicle);
            }
        }

        if (shouldSync) this.lastSyncTime = 0;
        this.updateProjectiles(delta);
        this.updateBombs(delta);
    }

    // MULTI-POINT CHASSIS COLLISION
    updateChassisCollision(vehicle, delta) {
        const body = vehicle.body;
        const dims = vehicle.dims || new THREE.Vector3(2, 1, 4);
        const hw = dims.x / 2;
        const hh = dims.y / 2;
        const hl = dims.z / 2;

        const corners = [
            new THREE.Vector3(hw, -hh, hl), new THREE.Vector3(-hw, -hh, hl),
            new THREE.Vector3(hw, -hh, -hl), new THREE.Vector3(-hw, -hh, -hl),
            new THREE.Vector3(hw, hh, hl), new THREE.Vector3(-hw, hh, hl),
            new THREE.Vector3(hw, hh, -hl), new THREE.Vector3(-hw, hh, -hl)
        ];

        let contact = false;
        
        corners.forEach(corner => {
            const worldPos = corner.clone().applyEuler(body.rotation).add(body.position);
            const terrainY = getTerrainHeight(worldPos.x, worldPos.z);
            
            if (worldPos.y < terrainY) {
                contact = true;
                const depth = terrainY - worldPos.y;
                
                const stiff = body.mass * 200; 
                const damp = body.mass * 20;
                
                const r = worldPos.clone().sub(body.position);
                const pointVel = body.velocity.clone().add(body.angularVelocity.clone().cross(r));
                
                const upForce = stiff * depth - damp * pointVel.y;
                const forceVec = new THREE.Vector3(0, Math.max(0, upForce), 0);
                
                const friction = pointVel.clone().multiplyScalar(-body.mass * 0.2); 
                friction.y = 0;
                
                this.applyForceAtLocalPoint(vehicle, forceVec.add(friction), corner, delta);
            }
        });
    }

    updateGroundVehicle(vehicle, delta) {
        const body = vehicle.body;
        const susp = vehicle.suspension;
        const inputs = vehicle.inputs || { throttle: 0, steer: 0, brake: false };
        const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(body.rotation);
        
        susp.wheelOffsets.forEach((offset, i) => {
            const isFront = offset.z > 0; 
            const steerAngle = isFront ? (inputs.steer * 0.5) : 0; 
            const wheelForwardLocal = new THREE.Vector3(Math.sin(steerAngle), 0, Math.cos(steerAngle));
            const wheelRightLocal = new THREE.Vector3(Math.cos(steerAngle), 0, -Math.sin(steerAngle));
            
            // FIX: Restore the world-space vector definitions that were missing
            const wheelForward = wheelForwardLocal.clone().applyMatrix4(rotationMatrix).normalize();
            const wheelRight = wheelRightLocal.clone().applyMatrix4(rotationMatrix).normalize();

            const wheelLocal = offset.clone();
            const wheelWorld = wheelLocal.clone().applyMatrix4(rotationMatrix).add(body.position);
            const terrainH = getTerrainHeight(wheelWorld.x, wheelWorld.z);
            const currentY = wheelWorld.y;
            const distToGround = currentY - terrainH;
            const maxLen = susp.restLength + susp.travel;
            
            if (distToGround < maxLen) {
                const compression = susp.restLength - distToGround;
                let forceMag = compression * susp.stiffness;
                const r = wheelWorld.clone().sub(body.position);
                const pointVel = body.velocity.clone().add(body.angularVelocity.clone().cross(r));
                const verticalVel = pointVel.y;
                forceMag -= verticalVel * susp.damping;
                forceMag = Math.max(0, forceMag);
                const suspensionForce = new THREE.Vector3(0, 1, 0).multiplyScalar(forceMag);
                this.applyForceAtLocalPoint(vehicle, suspensionForce, wheelLocal, delta);
                
                const slideSpeed = pointVel.dot(wheelRight);
                const maxFriction = forceMag * 1.5; 
                const frictionMag = THREE.MathUtils.clamp(-slideSpeed * susp.friction, -maxFriction, maxFriction);
                const slipFactor = inputs.brake ? 0.2 : 1.0; 
                const frictionForce = wheelRight.clone().multiplyScalar(frictionMag * slipFactor);
                this.applyForceAtLocalPoint(vehicle, frictionForce, wheelLocal, delta);
                
                if (inputs.throttle !== 0 && !inputs.brake) {
                    const driveForce = wheelForward.clone().multiplyScalar(inputs.throttle * susp.engineForce);
                    this.applyForceAtLocalPoint(vehicle, driveForce, wheelLocal, delta);
                }
                
                if (inputs.brake) {
                    const forwardSpeed = pointVel.dot(wheelForward);
                    const brakeForce = wheelForward.clone().multiplyScalar(-forwardSpeed * susp.friction * 0.5);
                    this.applyForceAtLocalPoint(vehicle, brakeForce, wheelLocal, delta);
                }
            }
        });
        
        body.velocity.multiplyScalar(0.998);
        body.angularVelocity.multiplyScalar(0.98); 
        body.angularVelocity.clampLength(0, 8.0);
    }

    updateHelicopter(vehicle, delta) {
        const body = vehicle.body;
        const inputs = vehicle.inputs || { pitch: 0, roll: 0, yaw: 0, lift: 0 };
        
        vehicle.rotor.rotation.y += delta * 15;
        
        const pilot = vehicle.seats.find(s => s.role === 'pilot')?.occupant;
        
        if (pilot) {
            const rotorAxis = new THREE.Vector3(0, 1, 0).applyEuler(body.rotation);
            const hoverForce = body.mass * this.GRAVITY;
            const liftInput = inputs.lift * hoverForce * 2.0; 
            const totalLift = hoverForce + liftInput;
            const liftForce = rotorAxis.clone().multiplyScalar(totalLift);
            
            this.applyForceAtLocalPoint(vehicle, liftForce, new THREE.Vector3(0, 2, 0), delta);
            
            // FIX: Keep torque in LOCAL space so controls are relative to helicopter orientation
            // Don't apply body.rotation - angular velocity is applied directly to Euler angles
            const torque = new THREE.Vector3(
                inputs.pitch * 50000, 
                inputs.yaw * 25000,   
                -inputs.roll * 50000  
            );
            
            this.applyTorque(vehicle, torque.multiplyScalar(delta)); 

            body.velocity.multiplyScalar(0.995); 
            body.angularVelocity.multiplyScalar(0.95);
        } else {
             body.velocity.multiplyScalar(0.99);
        }
    }
    
    applyTorque(vehicle, torque) {
        const body = vehicle.body;
        const inertia = body.mass * 2; 
        body.angularVelocity.add(torque.divideScalar(inertia));
    }

    // ... (Keep existing projectile, bomb, tracer methods) ...
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
    
    findAvailableSeat(position, radius = 5) {
        let best = null;
        let bestDist = radius;
        for (const vehicle of this.vehicles) {
            for (const seat of vehicle.seats) {
                if (seat.occupant) continue;
                const seatWorld = seat.offset.clone().applyEuler(vehicle.body.rotation).add(vehicle.mesh.position);
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
        const exitOffset = new THREE.Vector3(-3, 0, 0).applyEuler(vehicle.body.rotation);
        playerController.char.group.position.copy(vehicle.mesh.position).add(exitOffset);
        playerController.physicsBody.velocity.set(0, 0, 0);
        playerController.physicsBody.noCollisions = false;
        playerController.physicsBody.noGravity = false;
    }
}