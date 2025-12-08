import { CONFIG } from './config.js';
import { getTerrainHeight } from './terrain.js';
import { Character } from './character.js';
import { showInteractionPanel, hideInteractionPanel, updateInteractionStatus, showInteractionPrompt, hideInteractionPrompt } from './ui.js';

export class PlayerController {
    constructor({ scene, camera, worldManager, logChat, keys, mouse, physics, interactionManager, environment, vehicleManager }) {
        this.scene = scene;
        this.camera = camera;
        this.worldManager = worldManager;
        this.logChat = logChat;
        this.keys = keys;
        this.mouse = mouse;
        this.physics = physics;
        this.interactionManager = interactionManager;
        this.environment = environment;
        this.vehicleManager = vehicleManager;

        this.char = new Character(true);
        this.scene.add(this.char.group);

        this.physicsBody = this.physics.registerBody({
            position: this.char.group.position,
            velocity: new THREE.Vector3(),
            radius: 0.7,
            height: 1.7,
            grounded: false
        });

        this.yaw = 0;
        this.pitch = 0;
        this.savedOutdoorPos = new THREE.Vector3();
        this.isInInterior = false;
        this.stamina = CONFIG.maxStamina;
        this.hoverTarget = null;
        this.currentVehicle = null;
        this.seatRole = null;
        this.lastKeyStates = {};
        this.hoverVehicle = null;
    }

    update(delta) {
        const pos = this.char.group.position;

        this.yaw -= this.mouse.x * 0.0025;
        this.pitch -= this.mouse.y * 0.0025;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
        this.mouse.x = 0;
        this.mouse.y = 0;

        if (this.currentVehicle) {
            this.updateVehicleControl(delta);
        } else {
            const running = this.keys['ShiftLeft'] && this.stamina > 0;
            const crouching = this.keys['ControlLeft'];
            const speed = crouching ? CONFIG.crouchSpeed : running ? CONFIG.runSpeed : CONFIG.speed;
            let dx = 0, dz = 0;

            if (this.keys['KeyW']) dz = 1;
            if (this.keys['KeyS']) dz = -1;
            if (this.keys['KeyA']) dx = -1;
            if (this.keys['KeyD']) dx = 1;

            const moveDir = new THREE.Vector3(dx, 0, dz);
            if (moveDir.lengthSq() > 0) {
                moveDir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
            }

            const targetVel = moveDir.multiplyScalar(speed);
            const accel = this.physicsBody.grounded ? CONFIG.groundAccel : CONFIG.airAccel;
            const lerpFactor = Math.min(1, accel * delta);

            this.physicsBody.velocity.x = THREE.MathUtils.lerp(this.physicsBody.velocity.x, targetVel.x, lerpFactor);
            this.physicsBody.velocity.z = THREE.MathUtils.lerp(this.physicsBody.velocity.z, targetVel.z, lerpFactor);

            if (this.keys['Space'] && this.physicsBody.grounded) {
                this.physicsBody.velocity.y = CONFIG.jumpSpeed;
                this.physicsBody.grounded = false;
            }

            this.char.group.rotation.y = this.yaw + Math.PI;
            this.char.animate(targetVel.length());

            this.updateStamina(delta, running);
        }

        if (this.isInInterior) {
            if (pos.y < 500) pos.y = 500;
        }

        const terrainSampler = (x, z) => this.isInInterior ? 500 : getTerrainHeight(x, z);
        this.physics.step(delta, terrainSampler);

        this.updateCamera();

        if (!this.currentVehicle) {
            this.scanInteractions();
        } else {
            this.hoverTarget = null;
            this.hoverVehicle = null;
            hideInteractionPrompt();
        }
    }

    updateStamina(delta, running) {
        if (running && this.physicsBody.velocity.lengthSq() > 0.01) {
            this.stamina = Math.max(0, this.stamina - CONFIG.staminaDrainRate * delta);
        } else {
            this.stamina = Math.min(CONFIG.maxStamina, this.stamina + CONFIG.staminaRecoveryRate * delta);
        }
        const bar = document.getElementById('hud-stamina-fill');
        if (bar) {
            bar.style.width = `${(this.stamina / CONFIG.maxStamina) * 100}%`;
        }
    }

    scanInteractions() {
        this.hoverVehicle = this.vehicleManager?.findVehicleTarget(this.camera, 9) || null;
        if (this.hoverVehicle) {
            showInteractionPrompt(`E - ${this.hoverVehicle.vehicle.type} (${this.hoverVehicle.available.length} seats open)`);
            this.hoverTarget = null;
            return;
        }

        const data = this.interactionManager.findClosest(this.char, this.camera);
        this.hoverTarget = data;
        if (data) {
            showInteractionPrompt(`E - ${data.def.name} (${data.def.rarity})`);
        } else {
            hideInteractionPrompt();
        }
    }

    interact() {
        if (this.vehicleManager) {
            if (this.currentVehicle) {
                const seatList = this.vehicleManager.listSeats(this.currentVehicle).map(seat => ({
                    ...seat,
                    role: seat.seat === this.currentSeat ? `${seat.role} (YOU)` : seat.role
                })).concat([{ index: 'exit', role: 'Exit vehicle', occupied: false }]);

                showInteractionPanel(
                    {
                        def: { name: `${this.currentVehicle.type} seats`, rarity: 'common' },
                        readings: null,
                        locked: false
                    },
                    (action) => {
                        if (action === 'exit') {
                            this.vehicleManager.exitSeat(this.currentVehicle, this.currentSeat, this);
                            hideInteractionPanel();
                            return;
                        }

                        const seatIndex = parseInt(action, 10);
                        const seatInfo = this.vehicleManager.listSeats(this.currentVehicle).find(s => s.index === seatIndex);
                        if (!seatInfo) {
                            updateInteractionStatus('Seat unavailable.');
                            return;
                        }
                        if (seatInfo.seat === this.currentSeat) {
                            updateInteractionStatus('Already in that seat.');
                            return;
                        }
                        if (seatInfo.occupied) {
                            updateInteractionStatus('Seat occupied.');
                            return;
                        }

                        this.vehicleManager.vacateSeat(this.currentVehicle, this.currentSeat);
                        this.enterVehicle(this.currentVehicle, seatInfo.seat);
                        hideInteractionPanel();
                    },
                    () => hideInteractionPanel(),
                    seatList
                );
                return;
            }

            if (this.hoverVehicle) {
                const seatList = this.vehicleManager.listSeats(this.hoverVehicle.vehicle);
                showInteractionPanel(
                    {
                        def: { name: `${this.hoverVehicle.vehicle.type} seats`, rarity: 'common' },
                        readings: null,
                        locked: false
                    },
                    (action) => {
                        const seatIndex = parseInt(action, 10);
                        const seatInfo = this.vehicleManager.listSeats(this.hoverVehicle.vehicle).find(s => s.index === seatIndex);
                        if (!seatInfo || seatInfo.occupied) {
                            updateInteractionStatus('Seat unavailable.');
                            return;
                        }
                        this.enterVehicle(this.hoverVehicle.vehicle, seatInfo.seat);
                        hideInteractionPanel();
                    },
                    () => hideInteractionPanel(),
                    seatList
                );
                return;
            }
        }

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = raycaster.intersectObjects(this.scene.children, true);
        for (const hit of intersects) {
            if (hit.distance > 15) continue;
            let data = hit.object.userData;
            if (!data?.type && hit.object.parent) {
                data = hit.object.parent.userData;
            }
            if (data?.type === 'door') {
                this.enterInterior(data.seed);
                return;
            }
            if (data?.type === 'exit') {
                this.exitInterior();
                return;
            }
        }

        if (this.hoverTarget) {
            const targetState = this.interactionManager.beginInteraction(this.hoverTarget);
            if (!targetState) return;
            showInteractionPanel(targetState, (action, target) => this.performAction(action, target), () => hideInteractionPanel());
            if (targetState.locked) {
                updateInteractionStatus(`Cooling for ${targetState.remaining}s`);
                this.logChat('System', `${targetState.def.name} is cooling down (${targetState.remaining}s).`);
            }
            return;
        }

        this.logChat('System', 'Nothing to interact with.');
    }

    performAction(action, target) {
        const result = this.interactionManager.performAction(target, action);
        updateInteractionStatus(result.message);
        this.logChat('System', `${target.def.name}: ${result.message}`);
    }

    enterInterior(seed) {
        this.savedOutdoorPos.copy(this.char.group.position);
        const ix = seed * 5000;
        const iy = 500;

        this.worldManager.createInterior(ix, iy, ix, seed);
        this.char.group.position.set(ix, iy + 1, ix);
        this.physicsBody.velocity.set(0, 0, 0);
        this.isInInterior = true;

        this.logChat('System', 'Entering building...');
    }

    exitInterior() {
        if (this.savedOutdoorPos.lengthSq() > 0) {
            this.char.group.position.copy(this.savedOutdoorPos);
            this.char.group.position.z += 5;
        } else {
            this.char.group.position.set(0, 0, 0);
        }
        this.physicsBody.velocity.set(0, 0, 0);
        this.isInInterior = false;

        this.logChat('System', 'Exiting building...');
        hideInteractionPanel();
    }

    toggleVehicleSeat() {
        if (!this.vehicleManager) return;
        if (this.currentVehicle) {
            this.vehicleManager.exitSeat(this.currentVehicle, this.currentSeat, this);
            this.currentSeat = null;
            return;
        }

        const seatData = this.vehicleManager.findAvailableSeat(this.char.group.position, 5.5);
        if (seatData) {
            this.enterVehicle(seatData.vehicle, seatData.seat);
        } else {
            this.logChat('System', 'No vehicle nearby.');
        }
    }

    enterVehicle(vehicle, seat) {
        seat.occupant = this;
        this.currentVehicle = vehicle;
        this.currentSeat = seat;
        this.seatRole = seat.role;
        this.char.group.visible = false;
        this.physicsBody.velocity.set(0, 0, 0);
        this.physicsBody.noCollisions = true;
        this.physicsBody.noGravity = true;
    }

    updateVehicleControl(delta) {
        if (!this.currentVehicle) return;
        const vehicle = this.currentVehicle;
        if (vehicle.type === 'tank' || vehicle.type === 'jeep') {
            const accel = vehicle.type === 'tank' ? 26 : 32;
            const turnRate = vehicle.type === 'tank' ? 0.9 : 1.3;
            if (this.keys['KeyW']) {
                vehicle.body.velocity.x += Math.sin(vehicle.heading) * accel * delta;
                vehicle.body.velocity.z += Math.cos(vehicle.heading) * accel * delta;
            }
            if (this.keys['KeyS']) {
                vehicle.body.velocity.x -= Math.sin(vehicle.heading) * accel * delta;
                vehicle.body.velocity.z -= Math.cos(vehicle.heading) * accel * delta;
            }
            if (this.keys['KeyA']) vehicle.heading += turnRate * delta;
            if (this.keys['KeyD']) vehicle.heading -= turnRate * delta;

            vehicle.body.velocity.x *= 0.992;
            vehicle.body.velocity.z *= 0.992;

            const maxSpeed = vehicle.type === 'tank' ? 22 : 28;
            const planarSpeed = Math.hypot(vehicle.body.velocity.x, vehicle.body.velocity.z);
            if (planarSpeed > maxSpeed) {
                const scale = maxSpeed / planarSpeed;
                vehicle.body.velocity.x *= scale;
                vehicle.body.velocity.z *= scale;
            }
            if (vehicle.body.grounded && Math.abs(vehicle.body.velocity.y) < 0.2) {
                vehicle.body.velocity.y = 0;
            }
        } else if (vehicle.type === 'helicopter') {
            const thrust = 22;
            if (this.keys['Space']) vehicle.targetAltitude += 8 * delta;
            if (this.keys['ShiftLeft']) vehicle.targetAltitude -= 8 * delta;
            vehicle.targetAltitude = Math.max(vehicle.targetAltitude, getTerrainHeight(vehicle.body.position.x, vehicle.body.position.z) + 1.6);

            const forward = this.keys['KeyW'] ? thrust : this.keys['KeyS'] ? -thrust * 0.6 : 0;
            const side = this.keys['KeyA'] ? thrust * 0.35 : this.keys['KeyD'] ? -thrust * 0.35 : 0;
            const headingChange = side * 0.03;
            vehicle.heading += headingChange * delta;
            const dir = new THREE.Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading)).multiplyScalar(forward * delta);
            vehicle.body.velocity.x = THREE.MathUtils.lerp(vehicle.body.velocity.x, dir.x, 0.6);
            vehicle.body.velocity.z = THREE.MathUtils.lerp(vehicle.body.velocity.z, dir.z, 0.6);
            vehicle.tiltX = THREE.MathUtils.clamp(-forward * 0.02, -0.25, 0.25);
            vehicle.tiltZ = THREE.MathUtils.clamp(side * 0.04, -0.35, 0.35);
        }

        this.char.group.position.copy(this.currentSeat.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading).add(vehicle.mesh.position));
    }

    updateCamera() {
        if (!this.currentVehicle) {
            const crouching = this.keys['ControlLeft'];
            const camDist = 7;
            const camHeight = crouching ? 2.5 : 3.5;
            const pos = this.char.group.position;

            const desiredPos = new THREE.Vector3(
                pos.x - Math.sin(this.yaw) * camDist * Math.cos(this.pitch),
                pos.y + camHeight + Math.sin(this.pitch) * camDist,
                pos.z - Math.cos(this.yaw) * camDist * Math.cos(this.pitch)
            );
            this.camera.position.lerp(desiredPos, CONFIG.cameraLag);
            this.camera.lookAt(pos.x, pos.y + 1.5, pos.z);
            return;
        }

        const vehicle = this.currentVehicle;
        const seatOffset = this.currentSeat.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.heading);
        const anchor = vehicle.mesh.position.clone().add(seatOffset);
        const camDist = 10;
        const camHeight = 4.5;
        const desired = anchor.clone().add(new THREE.Vector3(
            -Math.sin(vehicle.heading + this.pitch) * camDist,
            camHeight,
            -Math.cos(vehicle.heading + this.pitch) * camDist
        ));
        this.camera.position.lerp(desired, 0.15);
        this.camera.lookAt(anchor);
    }

    handleFire(button) {
        if (!this.currentVehicle || !this.vehicleManager) return;
        if (this.currentVehicle.type === 'tank') {
            if (button === 0 && this.seatRole === 'driver') {
                this.vehicleManager.fireWeapon(this.currentVehicle, 'driver');
            } else if (button === 2 && (this.seatRole === 'top-gunner' || this.seatRole === 'driver')) {
                const dir = new THREE.Vector3(Math.sin(this.currentVehicle.heading), 0, Math.cos(this.currentVehicle.heading));
                this.vehicleManager.fireWeapon(this.currentVehicle, 'top-gunner', dir);
            }
        } else if (this.currentVehicle.type === 'helicopter') {
            if (button === 0 && this.seatRole === 'pilot') {
                this.vehicleManager.fireWeapon(this.currentVehicle, 'pilot');
            } else if (button === 0 && this.seatRole === 'turret') {
                const dir = new THREE.Vector3(Math.sin(this.currentVehicle.heading + this.pitch), 0, Math.cos(this.currentVehicle.heading + this.pitch));
                this.vehicleManager.fireWeapon(this.currentVehicle, 'turret', dir);
            }
        } else if (this.currentVehicle.type === 'jeep') {
            if (button === 0 && this.seatRole === 'gunner') {
                const dir = new THREE.Vector3(Math.sin(this.currentVehicle.heading), 0, Math.cos(this.currentVehicle.heading));
                this.vehicleManager.fireWeapon(this.currentVehicle, 'gunner', dir);
            }
        }
    }
}
