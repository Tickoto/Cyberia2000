import { WorldManager } from './world-manager.js';
import { WarManager } from './war-manager.js';
import { PlayerController } from './player-controller.js';
import { PhysicsSystem } from './physics.js';
import { EnvironmentSystem } from './environment.js';
import { initCharCreator, logChat, setGender, updateMinimap } from './ui.js';
import { playerInventory, inventoryUI } from './inventory.js';
import { CONFIG } from './config.js';
import { networkManager, NetworkPlayer, NetworkEntityType, MessageType } from './network-manager.js';
import { Character } from './character.js';

let scene, camera, renderer, clock;
let playerController, worldManager, warManager, physics, environment;
let isGameActive = false;
let previewChar;
const keys = {};
const mouse = { x: 0, y: 0 };

// Remote players
const remotePlayers = new Map(); // networkId -> { character, networkEntity }
let localPlayerEntity = null;

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x445566);
    scene.fog = new THREE.Fog(0x445566, 50, 350);

    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.1,
        500
    );

    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.imageRendering = 'pixelated';
    document.body.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xaabbcc, 0x444422, 0.6);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffee, 0.8);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    clock = new THREE.Clock();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyE' && isGameActive) {
            playerController.interact();
        }
        if (e.code === 'KeyI' && isGameActive) {
            inventoryUI.toggle();
            if (inventoryUI.isOpen) {
                document.exitPointerLock();
            } else {
                document.body.requestPointerLock();
            }
        }
        if (e.code === 'Escape' && isGameActive && inventoryUI.isOpen) {
            inventoryUI.close();
            document.body.requestPointerLock();
        }
        if (e.code === 'Enter') {
            const input = document.getElementById('chat-input');
            if (document.activeElement === input) {
                if (input.value.trim()) {
                    const username = document.getElementById('cc-username').value || 'Player';
                    logChat(username, input.value);

                    // Send chat over network
                    if (CONFIG.networkEnabled && networkManager.isConnected) {
                        networkManager.sendChat(input.value, username);
                    }

                    input.value = '';
                }
                input.blur();
                document.body.requestPointerLock();
            } else {
                input.focus();
                document.exitPointerLock();
            }
        }
    });

    window.addEventListener('keyup', e => {
        keys[e.code] = false;
    });

    document.addEventListener('mousemove', e => {
        if (document.pointerLockElement === document.body) {
            mouse.x = e.movementX;
            mouse.y = e.movementY;
        }
    });

    document.getElementById('game-ui').addEventListener('click', () => {
        if (isGameActive) {
            document.body.requestPointerLock();
        }
    });

    previewChar = initCharCreator(() => isGameActive);
}

function startGame() {
    document.getElementById('char-creator').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';

    const username = document.getElementById('cc-username').value || 'Player';

    physics = new PhysicsSystem();
    environment = new EnvironmentSystem(scene);
    worldManager = new WorldManager(scene, physics);
    warManager = new WarManager(scene);

    // Connect inventory to interaction manager
    worldManager.interactionManager.setInventory(playerInventory);

    playerController = new PlayerController({ scene, camera, worldManager, logChat, keys, mouse, physics, interactionManager: worldManager.interactionManager, environment });

    playerController.char.params = { ...previewChar.params };
    playerController.char.rebuild();

    // Spawn the player inside a city hub so points of interest are immediately visible
    const spawn = worldManager.findCitySpawnPoint();
    playerController.char.group.position.set(spawn.x, spawn.y, spawn.z);
    playerController.physicsBody.velocity.set(0, 0, 0);

    isGameActive = true;
    document.body.requestPointerLock();

    logChat('System', `Welcome to Cyberia, ${username}!`);
    logChat('System', 'A war rages between three factions. Explore the world!');
    logChat('System', 'Press [I] to open inventory, [E] to interact with objects.');
    logChat('WarNet', 'ALERT: Combat detected in multiple sectors.');

    // Initialize networking if enabled
    if (CONFIG.networkEnabled) {
        initializeNetworking(username);
    }

    gameLoop();
}

function initializeNetworking(username) {
    // Set up entity handlers
    setupNetworkEntityHandlers();

    // Set up callbacks
    networkManager.onConnected = () => {
        logChat('System', 'Connected to multiplayer server!');
        // Register local player
        registerLocalPlayer(username);
    };

    networkManager.onDisconnected = () => {
        logChat('System', 'Disconnected from multiplayer server.');
        // Clean up remote players
        for (const [id, data] of remotePlayers) {
            scene.remove(data.character.group);
        }
        remotePlayers.clear();
    };

    networkManager.onPlayerJoined = (data, clientId) => {
        logChat('System', `${data.username || 'Player'} joined the game.`);
    };

    networkManager.onPlayerLeft = (data, clientId) => {
        logChat('System', `${data.username || 'Player'} left the game.`);
    };

    networkManager.onChatMessage = (data, clientId) => {
        if (clientId !== networkManager.clientId) {
            logChat(data.username || 'Player', data.message);
        }
    };

    // Handle unit sync messages from host
    networkManager.registerMessageHandler('unit_sync', (data, clientId) => {
        // Non-host clients receive and apply unit sync data
        if (!networkManager.isHost && warManager && data.units) {
            warManager.applyUnitsSyncData(data.units);
        }
    });

    // Try to connect
    networkManager.connect(CONFIG.networkServerUrl)
        .then(() => {
            logChat('System', 'Multiplayer: Attempting connection...');
        })
        .catch((error) => {
            logChat('System', 'Multiplayer: Running in offline mode.');
            console.log('Network connection failed:', error);
        });
}

function setupNetworkEntityHandlers() {
    // Player entity handler
    networkManager.registerEntityHandler(NetworkEntityType.PLAYER, {
        spawn: (data, clientId) => {
            // Don't spawn ourselves
            if (clientId === networkManager.clientId) return null;

            // Create remote player character
            const character = new Character(false);
            if (data.appearance) {
                character.params = { ...character.params, ...data.appearance };
                character.rebuild();
            }

            // Set initial position
            if (data.position) {
                character.group.position.set(data.position.x, data.position.y, data.position.z);
            }
            if (data.rotationY !== undefined) {
                character.group.rotation.y = data.rotationY;
            }

            scene.add(character.group);

            // Create network entity
            const entity = new NetworkPlayer(data.id);
            entity.applySyncData(data);

            // Store reference
            remotePlayers.set(data.id, { character, networkEntity: entity });

            logChat('System', `${data.username || 'Player'} appeared nearby.`);

            return entity;
        },

        update: (entity, data, timestamp) => {
            const playerData = remotePlayers.get(entity.networkId);
            if (!playerData) return;

            // Interpolate position
            if (data.position) {
                const targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
                playerData.character.group.position.lerp(targetPos, 0.3);
            }

            // Update rotation
            if (data.rotationY !== undefined) {
                playerData.character.group.rotation.y = THREE.MathUtils.lerp(
                    playerData.character.group.rotation.y,
                    data.rotationY,
                    0.3
                );
            }

            // Update animation
            if (data.animationSpeed !== undefined) {
                playerData.character.animate(data.animationSpeed);
            }

            entity.applySyncData(data);
        },

        destroy: (entity) => {
            const playerData = remotePlayers.get(entity.networkId);
            if (playerData) {
                scene.remove(playerData.character.group);
                remotePlayers.delete(entity.networkId);
            }
        }
    });

    // Unit entity handler for war manager units
    networkManager.registerEntityHandler(NetworkEntityType.UNIT, {
        spawn: (data, clientId) => {
            // Let host control units
            if (networkManager.isHost) return null;
            // Remote clients could sync units here if needed
            return null;
        },
        update: (entity, data, timestamp) => {
            // Unit sync updates handled here
        },
        destroy: (entity) => {
            // Unit destruction handled here
        }
    });

    // Object entity handler for interactive objects
    networkManager.registerEntityHandler(NetworkEntityType.OBJECT, {
        spawn: (data, clientId) => {
            // Objects are seeded, so we don't spawn them from network
            return null;
        },
        update: (entity, data, timestamp) => {
            // Sync object state (cooldowns, etc)
            if (worldManager && worldManager.interactionManager) {
                worldManager.interactionManager.syncObjectState(data.objectId, data.state);
            }
        },
        destroy: (entity) => {
            // Object destruction
        }
    });
}

function registerLocalPlayer(username) {
    // Create and register local player entity
    localPlayerEntity = new NetworkPlayer();
    localPlayerEntity.syncProperties.username = username;
    localPlayerEntity.syncProperties.appearance = { ...playerController.char.params };

    networkManager.registerEntity(localPlayerEntity);

    // Connect war manager to network for unit syncing
    warManager.setNetworkManager(networkManager);

    // Broadcast player join
    networkManager.broadcast(MessageType.PLAYER_JOIN, {
        username: username,
        appearance: playerController.char.params
    });
}

function updateNetworkPlayerState() {
    if (!localPlayerEntity || !networkManager.isConnected) return;

    const pos = playerController.char.group.position;
    const rot = playerController.char.group.rotation.y;
    const vel = playerController.physicsBody.velocity;
    const animSpeed = vel.length();

    // Queue update for batched sending
    networkManager.queueEntityUpdate(localPlayerEntity.networkId, {
        type: NetworkEntityType.PLAYER,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotationY: rot,
        animationSpeed: animSpeed
    });
}

function gameLoop() {
    requestAnimationFrame(gameLoop);

    const delta = Math.min(clock.getDelta(), 0.1);

    if (isGameActive) {
        playerController.update(delta);
        worldManager.update(playerController.char.group.position, delta);
        warManager.update(delta, playerController.char.group.position);
        environment.update(delta, playerController.char.group.position);
        updateMinimap(playerController, worldManager, warManager);

        // Network updates
        if (CONFIG.networkEnabled && networkManager.isConnected) {
            updateNetworkPlayerState();
            networkManager.update(delta);
        }
    }

    renderer.render(scene, camera);
}

// Make functions available globally for HTML onclick handlers
window.startGame = startGame;
window.setGender = (gender) => {
    if (previewChar) {
        setGender(previewChar, gender);
    }
};

window.addEventListener('DOMContentLoaded', () => {
    init();
});
