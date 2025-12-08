import { getTerrainHeight } from './terrain.js';

export class VehicleManager {
    constructor(scene, physics) {
        this.scene = scene;
        this.physics = physics;
        this.vehicles = [];
        this.projectiles = [];
        this.bombs = [];
        this.raycaster = new THREE.Raycaster();
    }

    spawnStartingVehicles(origin) {
        const offset = new THREE.Vector3(origin.x, origin.y, origin.z);
        this.spawnTank(offset.clone().add(new THREE.Vector3(12, 0, 8)));
        this.spawnHelicopter(offset.clone().add(new THREE.Vector3(-15, 0, 12)));
        this.spawnJeep(offset.clone().add(new THREE.Vector3(8, 0, -14)));
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
            radius: 2.3,
            height: 2.4,
            mass: 8000,
            damping: 0.5,
            friction: 0.1,
            bounciness: 0.05
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
                // Define 4 corners for terrain sampling relative to center
                wheelOffsets: [
                    new THREE.Vector3(2.5, 0, 3.5),   // Front Left
                    new THREE.Vector3(-2.5, 0, 3.5),  // Front Right
                    new THREE.Vector3(2.5, 0, -3.5),  // Back Left
                    new THREE.Vector3(-2.5, 0, -3.5)  // Back Right
                ],
                stiffness: 12.0,
                damping: 8.0, // Increased damping for less wobble
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
            radius: 2.4,
            height: 2.4,
            mass: 2500,
            damping: 0.3,
            friction: 0.1,
            bounciness: 0.1
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
                stiffness: 15.0,
                damping: 7.0, // Increased damping for less wobble
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
        for (const vehicle of this.vehicles) {
            if (vehicle.type === 'tank' || vehicle.type === 'jeep') {
                this.updateGroundVehicle(vehicle, delta);
            } else if (vehicle.type === 'helicopter') {
                this.updateHelicopter(vehicle, delta);
            }

            vehicle.weaponCooldown = Math.max(0, vehicle.weaponCooldown - delta);
            vehicle.mgCooldown = Math.max(0, vehicle.mgCooldown - delta);
            vehicle.bombCooldown = Math.max(0, vehicle.bombCooldown - delta);
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
        
        // Only apply rotation/input physics if the driver is present
        if (isBeingDriven) {
            const surfaceFriction = body.grounded ? 0.99 : 0.998;
            body.velocity.x *= surfaceFriction;
            body.velocity.z *= surfaceFriction;

            // --- REALISTIC 4-POINT SUSPENSION (Keep existing logic for now) ---
            
            // 1. Calculate World Positions of Wheels
            const cosYaw = Math.cos(vehicle.heading);
            const sinYaw = Math.sin(vehicle.heading);
            
            const calcWheelHeight = (offsetX, offsetZ) => {
                // Transform local wheel offset to world space based on heading
                const wx = offsetX * cosYaw - offsetZ * sinYaw;
                const wz = offsetX * sinYaw + offsetZ * cosYaw;
                return getTerrainHeight(body.position.x + wx, body.position.z + wz);
            };

            const hFL = calcWheelHeight(susp.wheelOffsets[0].x, susp.wheelOffsets[0].z);
            const hFR = calcWheelHeight(susp.wheelOffsets[1].x, susp.wheelOffsets[1].z);
            const hBL = calcWheelHeight(susp.wheelOffsets[2].x, susp.wheelOffsets[2].z);
            const hBR = calcWheelHeight(susp.wheelOffsets[3].x, susp.wheelOffsets[3].z);

            const avgGroundHeight = (hFL + hFR + hBL + hBR) / 4;

            // 2. Calculate Slope Gradients
            const frontH = (hFL + hFR) / 2;
            const backH = (hBL + hBR) / 2;
            const leftH = (hFL + hBL) / 2;
            const rightH = (hFR + hBR) / 2;

            const length = Math.abs(susp.wheelOffsets[0].z - susp.wheelOffsets[2].z);
            const width = Math.abs(susp.wheelOffsets[0].x - susp.wheelOffsets[1].x);

            // CORRECTED PITCH: If Back is higher than Front (incline up), we want a positive X-rotation (pitch up)
            const targetPitch = Math.atan2(backH - frontH, length); 

            // Roll: If Left is higher than Right, we tilt roll towards the right (Negative Z rotation)
            const targetRoll = Math.atan2(leftH - rightH, width); 

            // 3. Spring Dynamics (Hooke's Law)
            const pitchError = targetPitch - vehicle.tilt.x;
            const rollError = targetRoll - vehicle.tilt.z;

            // Apply springs
            susp.angularVelocity.x += (pitchError * susp.stiffness - susp.angularVelocity.x * susp.damping) * delta;
            susp.angularVelocity.z += (rollError * susp.stiffness - susp.angularVelocity.z * susp.damping) * delta;

            // Apply dynamic forces (Centripetal roll, Acceleration pitch)
            if (body.grounded) {
                susp.angularVelocity.multiplyScalar(0.99); 
            } else {
                susp.angularVelocity.x *= 0.95;
                susp.angularVelocity.z *= 0.95;
            }

            vehicle.tilt.x += susp.angularVelocity.x * delta;
            vehicle.tilt.z += susp.angularVelocity.z * delta;
            
            // 4. Update Transform
            vehicle.mesh.position.copy(body.position);
            
            if (body.grounded) {
                 const targetY = avgGroundHeight + susp.restHeight;
                 vehicle.mesh.position.y = THREE.MathUtils.lerp(vehicle.mesh.position.y, targetY, delta * 15);
            }

            vehicle.mesh.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');
        } else {
            // Apply neutral rotation and high drag if unoccupied
            if (body.grounded) {
                body.velocity.x *= 0.95;
                body.velocity.z *= 0.95;
            }
            vehicle.mesh.position.copy(body.position);
            // Slowly level out the visual mesh tilt when unoccupied
            vehicle.tilt.x = THREE.MathUtils.lerp(vehicle.tilt.x, 0, delta * 2);
            vehicle.tilt.z = THREE.MathUtils.lerp(vehicle.tilt.z, 0, delta * 2);
            vehicle.mesh.rotation.set(vehicle.tilt.x, vehicle.heading, vehicle.tilt.z, 'YXZ');
        }
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
            const targetVertical = error * 2.0 + vehicle.lift * 2.0; 
            
            body.velocity.y = THREE.MathUtils.lerp(body.velocity.y, targetVertical, delta * 3);

            // 2. Horizontal Movement (Cyclic)
            
            const cosY = Math.cos(vehicle.heading);
            const sinY = Math.sin(vehicle.heading);

            // FIX: Ensure correct forward vector. If -Z is forward, use +sin/cos for X/Z
            // Three.js world default is typically +Z = Backward, -Z = Forward
            // W/Forward: vehicle.heading=0 (looking down -Z axis). sinY=0, cosY=1. Forward = (0, 0, -1). 
            // -vehicle.tiltX * speedFactor * delta applied to forward results in positive velocity down -Z axis.
            const forward = new THREE.Vector3(-sinY, 0, -cosY); // Corrected vector definition relative to heading
            const right = new THREE.Vector3(cosY, 0, -sinY);

            const speedFactor = 60.0; 
            
            // Apply thrust based on tilt (Pitch down = move forward)
            body.velocity.addScaledVector(forward, -vehicle.tiltX * speedFactor * delta);
            
            // Apply strafe thrust (Roll)
            body.velocity.addScaledVector(right, -vehicle.tiltZ * speedFactor * delta);

            // Drag (Air resistance)
            body.velocity.x *= 0.98;
            body.velocity.z *= 0.98;

            // Visual Rotation Lag - Visual tilt matches input angle
            const targetRotX = vehicle.tiltX; 
            const targetRotZ = vehicle.tiltZ;
            
            vehicle.mesh.rotation.x = THREE.MathUtils.lerp(vehicle.mesh.rotation.x, targetRotX, delta * 4);
            vehicle.mesh.rotation.z = THREE.MathUtils.lerp(vehicle.mesh.rotation.z, targetRotZ, delta * 4);
            vehicle.mesh.rotation.y = vehicle.heading;

        } else {
            // --- UNMANNED PHYSICS (Only gravity/drag applies) ---
            vehicle.lift = 0;
            vehicle.targetAltitude = body.position.y; 
            
            body.velocity.x *= 0.99;
            body.velocity.z *= 0.99;
            
            // Slowly level out visually if abandoned in air
            vehicle.mesh.rotation.x = THREE.MathUtils.lerp(vehicle.mesh.rotation.x, 0, delta);
            vehicle.mesh.rotation.z = THREE.MathUtils.lerp(vehicle.mesh.rotation.z, 0, delta);
            vehicle.mesh.rotation.y = vehicle.heading;
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