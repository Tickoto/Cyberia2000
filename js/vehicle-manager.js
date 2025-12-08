import { getTerrainHeight } from './terrain.js';

export class VehicleManager {
    constructor(scene, physics) {
        this.scene = scene;
        this.physics = physics;
        this.vehicles = [];
        this.projectiles = [];
        this.bombs = [];
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
            mass: 6000,
            damping: 0.92,
            friction: 0.25,
            bounciness: 0.02
        });

        const vehicle = {
            type: 'tank',
            mesh: group,
            body,
            heading: 0,
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
        group.position.y = Math.max(position.y + 6, getTerrainHeight(position.x, position.z) + 6);

        const bodyPhysics = this.physics.registerBody({
            position: group.position,
            velocity: new THREE.Vector3(),
            radius: 1.6,
            height: 3.4,
            mass: 1800,
            damping: 0.4,
            friction: 0.02,
            bounciness: 0.01
        });

        const vehicle = {
            type: 'helicopter',
            mesh: group,
            body: bodyPhysics,
            heading: 0,
            tiltX: 0,
            tiltZ: 0,
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
            mass: 2400,
            damping: 0.8,
            friction: 0.35,
            bounciness: 0.02
        });

        const vehicle = {
            type: 'jeep',
            mesh: group,
            body,
            heading: 0,
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
        this.vehicles.push(vehicle);
        return vehicle;
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

    exitSeat(vehicle, seat, playerController) {
        seat.occupant = null;
        playerController.currentVehicle = null;
        playerController.seatRole = null;
        playerController.char.group.visible = true;
        playerController.char.group.position.copy(vehicle.mesh.position).add(new THREE.Vector3(0, 0, -3).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading));
        playerController.physicsBody.velocity.set(0, 0, 0);
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
        const terrainY = getTerrainHeight(body.position.x, body.position.z);
        const desiredY = terrainY + (vehicle.type === 'tank' ? 1.25 : 1.1);
        body.position.y = THREE.MathUtils.lerp(body.position.y, desiredY, 0.4);

        vehicle.mesh.position.copy(body.position);
        vehicle.mesh.rotation.y = vehicle.heading;
    }

    updateHelicopter(vehicle, delta) {
        const body = vehicle.body;
        vehicle.rotor.rotation.y += delta * 15;
        vehicle.targetAltitude = Math.max(vehicle.targetAltitude, getTerrainHeight(body.position.x, body.position.z) + 5.5);

        const climb = (vehicle.targetAltitude - body.position.y) * 0.6;
        body.velocity.y = THREE.MathUtils.lerp(body.velocity.y, climb + vehicle.lift, 0.3);

        body.position.addScaledVector(body.velocity, delta);
        vehicle.mesh.position.copy(body.position);
        vehicle.mesh.rotation.y = vehicle.heading;
        vehicle.mesh.rotation.x = THREE.MathUtils.lerp(vehicle.mesh.rotation.x, vehicle.tiltX, 0.2);
        vehicle.mesh.rotation.z = THREE.MathUtils.lerp(vehicle.mesh.rotation.z, vehicle.tiltZ, 0.2);
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
