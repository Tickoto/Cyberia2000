import { CONFIG } from './config.js';
import { getTerrainHeight } from './terrain.js';
import { Character } from './character.js';
import { showInteractionPanel, hideInteractionPanel, updateInteractionStatus, showInteractionPrompt, hideInteractionPrompt } from './ui.js';
import { quaternionToEuler } from './physics-network-client.js';

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

        // Server physics support
        this.physicsNetworkClient = null;
        this.useServerPhysics = false;
        this.entityId = null;
        this.lastInputSendTime = 0;
        this.inputSendInterval = 50; // ms
    }

    setPhysicsNetworkClient(client) {
        this.physicsNetworkClient = client;
    }

    setServerPhysicsMode(enabled) {
        this.useServerPhysics = enabled;
        console.log('PlayerController: Server physics mode:', enabled);
    }

    setEntityId(entityId) {
        this.entityId = entityId;
        if (this.physicsNetworkClient) {
            this.physicsNetworkClient.setLocalEntity(entityId, true);
        }
    }

    // Apply physics state received from server
    applyServerPhysicsState(state) {
        if (!state || !this.useServerPhysics) return;

        // Apply position with smoothing to avoid jitter
        if (state.position) {
            const targetPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
            const currentPos = this.char.group.position;

            // Calculate distance to target
            const dist = currentPos.distanceTo(targetPos);

            // If too far off (teleport/spawn), snap directly
            // Otherwise smoothly interpolate to reduce jitter
            if (dist > 5) {
                this.char.group.position.copy(targetPos);
                this.physicsBody.position.copy(targetPos);
            } else {
                // Smooth lerp factor - higher = more responsive but more jittery
                const lerpFactor = 0.3;
                this.char.group.position.lerp(targetPos, lerpFactor);
                this.physicsBody.position.lerp(targetPos, lerpFactor);
            }
        }

        // Apply velocity for animations
        if (state.velocity) {
            this.physicsBody.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
        }

        // Update grounded state
        if (state.grounded !== undefined) {
            this.physicsBody.grounded = state.grounded;
        }
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

            // Gather input state
            const forward = !!this.keys['KeyW'];
            const backward = !!this.keys['KeyS'];
            const left = !!this.keys['KeyA'];
            const right = !!this.keys['KeyD'];
            const jump = !!this.keys['Space'];

            if (this.useServerPhysics) {
                // Server physics mode: send input to server, don't simulate locally
                const now = Date.now();
                if (now - this.lastInputSendTime >= this.inputSendInterval) {
                    this.lastInputSendTime = now;
                    if (this.physicsNetworkClient) {
                        this.physicsNetworkClient.sendPlayerInput({
                            forward,
                            backward,
                            left,
                            right,
                            jump,
                            running,
                            rotationY: this.yaw
                        });
                    }
                }

                // Update animation based on velocity from server
                const velLength = Math.sqrt(
                    this.physicsBody.velocity.x * this.physicsBody.velocity.x +
                    this.physicsBody.velocity.z * this.physicsBody.velocity.z
                );
                this.char.group.rotation.y = this.yaw + Math.PI;
                this.char.animate(velLength);

            } else {
                // Local physics mode (fallback)
                let dx = 0, dz = 0;
                if (forward) dz = 1;
                if (backward) dz = -1;
                if (left) dx = -1;
                if (right) dx = 1;

                const moveDir = new THREE.Vector3(dx, 0, dz);
                if (moveDir.lengthSq() > 0) {
                    moveDir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
                }

                const targetVel = moveDir.multiplyScalar(speed);
                const accel = this.physicsBody.grounded ? CONFIG.groundAccel : CONFIG.airAccel;
                const lerpFactor = Math.min(1, accel * delta);

                this.physicsBody.velocity.x = THREE.MathUtils.lerp(this.physicsBody.velocity.x, targetVel.x, lerpFactor);
                this.physicsBody.velocity.z = THREE.MathUtils.lerp(this.physicsBody.velocity.z, targetVel.z, lerpFactor);

                if (jump && this.physicsBody.grounded) {
                    this.physicsBody.velocity.y = CONFIG.jumpSpeed;
                    this.physicsBody.grounded = false;
                }

                this.char.group.rotation.y = this.yaw + Math.PI;
                this.char.animate(targetVel.length());
            }

            this.updateStamina(delta, running);
        }

        if (this.isInInterior) {
            if (pos.y < 500) pos.y = 500;
        }

        // Only run local physics if server physics is disabled
        if (!this.useServerPhysics) {
            const terrainSampler = (x, z) => this.isInInterior ? 500 : getTerrainHeight(x, z);
            this.physics.step(delta, terrainSampler);
        }

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

        // Disable player physics so they don't fight the car
        this.physicsBody.velocity.set(0, 0, 0);
        this.physicsBody.noCollisions = true;
        this.physicsBody.noGravity = true;

        // Initialize inputs on vehicle if missing
        if (!vehicle.inputs) {
            vehicle.inputs = { throttle: 0, steer: 0, brake: false, pitch: 0, roll: 0, yaw: 0, lift: 0 };
        }

        // Mark vehicle as player controlled for server physics mode
        if (this.vehicleManager && (this.seatRole === 'driver' || this.seatRole === 'pilot')) {
            this.vehicleManager.markVehiclePlayerControlled(vehicle, true);
        }

        // Tell physics network client we're in a vehicle
        if (this.physicsNetworkClient) {
            this.physicsNetworkClient.currentVehicleId = vehicle.networkId;
        }
    }

    exitVehicle() {
        if (this.currentVehicle) {
            // Unmark vehicle as player controlled
            if (this.vehicleManager) {
                this.vehicleManager.markVehiclePlayerControlled(this.currentVehicle, false);
            }

            // Tell physics network client we're out of vehicle
            if (this.physicsNetworkClient) {
                this.physicsNetworkClient.clearVehicleInput();
            }
        }
    }

    updateVehicleControl(delta) {
        if (!this.currentVehicle) return;
        const vehicle = this.currentVehicle;

        // Reset inputs
        vehicle.inputs = { throttle: 0, steer: 0, brake: false, pitch: 0, roll: 0, yaw: 0, lift: 0 };

        if (this.seatRole === 'driver') {
            // Ground Vehicle Control
            if (this.keys['KeyW']) vehicle.inputs.throttle = 1;
            if (this.keys['KeyS']) vehicle.inputs.throttle = -1;
            if (this.keys['KeyA']) vehicle.inputs.steer = 1; // Left
            if (this.keys['KeyD']) vehicle.inputs.steer = -1; // Right
            if (this.keys['Space']) vehicle.inputs.brake = true;

        } else if (this.seatRole === 'pilot') {
            // Helicopter Control
            // Pitch (W/S) - forward/back
            if (this.keys['KeyW']) vehicle.inputs.pitch = 1;
            if (this.keys['KeyS']) vehicle.inputs.pitch = -1;
            
            // Roll (A/D) - left/right strafe
            if (this.keys['KeyA']) vehicle.inputs.roll = -1;
            if (this.keys['KeyD']) vehicle.inputs.roll = 1;

            // Lift (Space/Shift)
            if (this.keys['Space']) vehicle.inputs.lift = 1;
            if (this.keys['ShiftLeft']) vehicle.inputs.lift = -1;
            
            // Yaw (Q/E) - Turn tail
            if (this.keys['KeyQ']) vehicle.inputs.yaw = 1;
            if (this.keys['KeyE']) vehicle.inputs.yaw = -1;
        }

        // Camera Logic follow vehicle
        // Use physics rotation (Mesh follows physics body in VehicleManager)
        const seatOffset = this.currentSeat.offset.clone().applyEuler(vehicle.mesh.rotation);
        const anchor = vehicle.mesh.position.clone().add(seatOffset);
        
        // Smooth camera follow
        const camDist = 10;
        const camHeight = 4.5;
        
        // Calculate camera position relative to vehicle's heading
        const vehicleYaw = vehicle.heading || 0;
        
        const desired = anchor.clone().add(new THREE.Vector3(
            -Math.sin(vehicleYaw + this.pitch) * camDist,
            camHeight + Math.sin(this.pitch) * 2,
            -Math.cos(vehicleYaw + this.pitch) * camDist
        ));
        
        this.camera.position.lerp(desired, 0.2); // Faster lerp for responsive feel
        this.camera.lookAt(anchor.clone().add(new THREE.Vector3(0, 1, 0))); // Look slightly above anchor
        
        // Sync player position to seat for network
        this.char.group.position.copy(anchor);
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
        }
    }

    handleFire(button) {
        if (!this.currentVehicle || !this.vehicleManager) return;
        
        // Only allow firing if we have a valid role
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