/**
 * Cyberia Game Server with Jolt Physics
 *
 * Server-authoritative physics simulation using Jolt Physics.
 * The server runs the physics simulation and broadcasts state to all clients.
 *
 * Usage: node relay-server.js [port]
 * Default port: 8080
 */

import { WebSocketServer, WebSocket } from 'ws';
import { JoltPhysicsWorld } from './jolt-physics-world.js';
import { getTerrainHeight } from './terrain.js';

const PORT = process.argv[2] || 8080;

// ============================================
// MESSAGE TYPES
// ============================================
const MessageType = {
    // Connection
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    HANDSHAKE: 'handshake',
    PING: 'ping',
    PONG: 'pong',

    // Entity sync (legacy, kept for compatibility)
    ENTITY_SPAWN: 'entity_spawn',
    ENTITY_UPDATE: 'entity_update',
    ENTITY_DESTROY: 'entity_destroy',
    WORLD_STATE: 'world_state',

    // Physics (new)
    PHYSICS_STATE: 'physics_state',
    PLAYER_INPUT: 'player_input',
    VEHICLE_INPUT: 'vehicle_input',
    SPAWN_PLAYER: 'spawn_player',
    SPAWN_VEHICLE: 'spawn_vehicle',

    // Player events
    PLAYER_JOIN: 'player_join',
    PLAYER_LEAVE: 'player_leave',

    // Chat
    CHAT_MESSAGE: 'chat_message',

    // Game events
    GAME_EVENT: 'game_event'
};

// ============================================
// SERVER STATE
// ============================================

// Room storage
const rooms = new Map();           // roomId -> RoomState
const clientRooms = new Map();     // client -> roomId
const clientInfo = new Map();      // client -> { clientId, username, entityId }

// Physics worlds per room
const physicsWorlds = new Map();   // roomId -> JoltPhysicsWorld

// Server configuration
const SERVER_CONFIG = {
    physicsTickRate: 60,           // Hz - physics simulation rate
    networkBroadcastRate: 20,      // Hz - network state broadcast rate
    maxPlayersPerRoom: 32
};

// Default vehicles to spawn in every room
const SERVER_VEHICLES = [
    { vehicleType: 'tank', position: { x: 12, y: 5, z: 8 } },
    { vehicleType: 'helicopter', position: { x: -15, y: 5, z: 12 } },
    { vehicleType: 'jeep', position: { x: 8, y: 5, z: -14 } }
];

/**
 * RoomState - State for each game room
 */
class RoomState {
    constructor(roomId) {
        this.roomId = roomId;
        this.clients = new Set();
        this.entities = new Map();      // entityId -> entity data
        this.vehicles = new Map();      // entityId -> vehicle data
        this.players = new Map();       // clientId -> player data
        this.hostClientId = null;
        this.createdAt = Date.now();
    }

    addClient(client, clientId) {
        this.clients.add(client);
        if (!this.hostClientId) {
            this.hostClientId = clientId;
        }
    }

    removeClient(client, clientId) {
        this.clients.delete(client);
        if (this.hostClientId === clientId && this.clients.size > 0) {
            // Assign new host
            const nextClient = this.clients.values().next().value;
            const nextInfo = clientInfo.get(nextClient);
            if (nextInfo) {
                this.hostClientId = nextInfo.clientId;
            }
        }
    }

    isHost(clientId) {
        return this.hostClientId === clientId;
    }
}

// ============================================
// PHYSICS MANAGEMENT
// ============================================

/**
 * Initialize physics world for a room
 */
async function initializePhysicsWorld(roomId) {
    console.log(`Initializing physics world for room: ${roomId}`);

    const world = new JoltPhysicsWorld();
    await world.initialize();

    // Create ground plane
    world.createGroundPlane(0);

    physicsWorlds.set(roomId, world);

    // Spawn default vehicles
    const room = rooms.get(roomId);
    SERVER_VEHICLES.forEach((def, index) => {
        const entityId = `server-vehicle-${roomId}-${index}`;
        const y = getTerrainHeight(def.position.x, def.position.z) + 3;

        world.createVehicle(
            entityId,
            def.vehicleType,
            { x: def.position.x, y: y, z: def.position.z },
            { x: 0, y: 0, z: 0, w: 1 }
        );

        room.vehicles.set(entityId, {
            id: entityId,
            type: 'vehicle',
            vehicleType: def.vehicleType,
            ownerId: 'server',
            position: { x: def.position.x, y: y, z: def.position.z }
        });
    });

    console.log(`Physics world initialized with ${SERVER_VEHICLES.length} vehicles`);
    return world;
}

/**
 * Cleanup physics world for a room
 */
function destroyPhysicsWorld(roomId) {
    const world = physicsWorlds.get(roomId);
    if (world) {
        world.destroy();
        physicsWorlds.delete(roomId);
        console.log(`Physics world destroyed for room: ${roomId}`);
    }
}

// ============================================
// PHYSICS LOOP
// ============================================

let lastPhysicsTime = Date.now();
let lastBroadcastTime = Date.now();

function physicsLoop() {
    const now = Date.now();
    const delta = (now - lastPhysicsTime) / 1000;
    lastPhysicsTime = now;

    // Step physics for each room
    for (const [roomId, world] of physicsWorlds) {
        world.step(delta);
    }

    // Broadcast state at lower rate
    const broadcastInterval = 1000 / SERVER_CONFIG.networkBroadcastRate;
    if (now - lastBroadcastTime >= broadcastInterval) {
        lastBroadcastTime = now;
        broadcastPhysicsState();
    }
}

/**
 * Broadcast physics state to all clients in each room
 */
function broadcastPhysicsState() {
    for (const [roomId, world] of physicsWorlds) {
        const room = rooms.get(roomId);
        if (!room || room.clients.size === 0) continue;

        const states = world.getAllBodyStates();
        if (states.length === 0) continue;

        const message = JSON.stringify({
            type: MessageType.PHYSICS_STATE,
            data: {
                timestamp: Date.now(),
                bodies: states
            }
        });

        for (const client of room.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
}

// Start physics loop
const physicsInterval = 1000 / SERVER_CONFIG.physicsTickRate;
setInterval(physicsLoop, physicsInterval);

// ============================================
// WEBSOCKET SERVER
// ============================================

const wss = new WebSocketServer({ port: PORT });

console.log(`Cyberia Game Server starting on port ${PORT}...`);
console.log(`Physics tick rate: ${SERVER_CONFIG.physicsTickRate} Hz`);
console.log(`Network broadcast rate: ${SERVER_CONFIG.networkBroadcastRate} Hz`);

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Failed to parse message:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        handleDisconnect(ws);
    });
});

// ============================================
// MESSAGE HANDLING
// ============================================

function handleMessage(client, message) {
    const { type, data, clientId, timestamp } = message;

    switch (type) {
        case MessageType.HANDSHAKE:
            handleHandshake(client, data, clientId);
            break;

        case MessageType.DISCONNECT:
            handleDisconnect(client);
            break;

        case MessageType.PING:
            send(client, MessageType.PONG, { pingTime: timestamp });
            break;

        case MessageType.PLAYER_INPUT:
            handlePlayerInput(client, data, clientId);
            break;

        case MessageType.VEHICLE_INPUT:
            handleVehicleInput(client, data, clientId);
            break;

        case MessageType.SPAWN_PLAYER:
            handleSpawnPlayer(client, data, clientId);
            break;

        case MessageType.SPAWN_VEHICLE:
            handleSpawnVehicle(client, data, clientId);
            break;

        case MessageType.CHAT_MESSAGE:
            if (data.message && data.message.startsWith('/')) {
                handleCommand(client, data.message, clientId);
            } else if (data.broadcast) {
                broadcastToRoom(client, message);
            }
            break;

        // Legacy entity messages - forward to room
        case MessageType.ENTITY_SPAWN:
        case MessageType.ENTITY_UPDATE:
        case MessageType.ENTITY_DESTROY:
        case MessageType.WORLD_STATE:
            if (data?.broadcast) {
                broadcastToRoom(client, message);
            }
            break;

        default:
            if (data?.broadcast) {
                broadcastToRoom(client, message);
            }
            break;
    }
}

// ============================================
// HANDLERS
// ============================================

async function handleHandshake(client, data, clientId) {
    const roomId = data.roomId || 'default';

    // Store client info
    clientInfo.set(client, {
        clientId,
        username: data.username || 'Player',
        version: data.version,
        entityId: `player-${clientId}`
    });

    // Create room if needed
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new RoomState(roomId));
        // Initialize physics world for new room
        await initializePhysicsWorld(roomId);
    }

    const room = rooms.get(roomId);
    room.addClient(client, clientId);
    clientRooms.set(client, roomId);

    const isHost = room.isHost(clientId);

    // Send handshake response
    send(client, MessageType.HANDSHAKE, {
        success: true,
        roomId,
        isHost,
        clientCount: room.clients.size,
        physicsEnabled: true,
        physicsTickRate: SERVER_CONFIG.physicsTickRate,
        networkBroadcastRate: SERVER_CONFIG.networkBroadcastRate
    });

    // Send existing players to new client
    for (const [existingClientId, playerData] of room.players) {
        send(client, MessageType.ENTITY_SPAWN, {
            id: playerData.entityId,
            type: 'player',
            ownerId: existingClientId,
            ...playerData
        });
    }

    // Send existing vehicles to new client
    for (const [vehicleId, vehicleData] of room.vehicles) {
        send(client, MessageType.ENTITY_SPAWN, vehicleData);
    }

    // Notify others about new player
    broadcastToRoom(client, {
        type: MessageType.PLAYER_JOIN,
        data: { clientId, username: data.username || 'Player' },
        clientId,
        timestamp: Date.now()
    });

    console.log(`Client ${clientId} joined room ${roomId} (${room.clients.size} clients, host: ${isHost})`);
}

function handleDisconnect(client) {
    const info = clientInfo.get(client);
    const roomId = clientRooms.get(client);

    if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId);
        const world = physicsWorlds.get(roomId);

        if (info) {
            // Remove player from physics
            if (world && info.entityId) {
                world.removeBody(info.entityId);
            }

            // Remove from room state
            room.players.delete(info.clientId);
            room.removeClient(client, info.clientId);

            // Notify others
            broadcastToRoom(client, {
                type: MessageType.ENTITY_DESTROY,
                data: { id: info.entityId, type: 'player' },
                clientId: info.clientId,
                timestamp: Date.now()
            });

            broadcastToRoom(client, {
                type: MessageType.PLAYER_LEAVE,
                data: { clientId: info.clientId, username: info.username },
                clientId: info.clientId,
                timestamp: Date.now()
            });
        }

        // Clean up empty rooms
        if (room.clients.size === 0) {
            rooms.delete(roomId);
            destroyPhysicsWorld(roomId);
            console.log(`Room ${roomId} closed (empty)`);
        }
    }

    clientRooms.delete(client);
    clientInfo.delete(client);

    if (info) {
        console.log(`Client ${info.clientId} disconnected`);
    }
}

function handleSpawnPlayer(client, data, clientId) {
    const roomId = clientRooms.get(client);
    if (!roomId) return;

    const room = rooms.get(roomId);
    const world = physicsWorlds.get(roomId);
    const info = clientInfo.get(client);
    if (!room || !world || !info) return;

    const entityId = info.entityId;
    const position = data.position || { x: 0, y: 5, z: 0 };

    // Adjust Y to terrain height
    const terrainY = getTerrainHeight(position.x, position.z);
    position.y = Math.max(position.y, terrainY + 1);

    // Create player physics body
    world.createCapsuleBody(
        entityId,
        position,
        1.6,   // height
        0.4,   // radius
        80,    // mass (kg)
        { isPlayer: true }
    );

    // Store player data
    const playerData = {
        entityId,
        position,
        username: data.username || info.username,
        appearance: data.appearance || {}
    };
    room.players.set(clientId, playerData);

    // Broadcast spawn to all clients (including sender for confirmation)
    const spawnMessage = {
        type: MessageType.ENTITY_SPAWN,
        data: {
            id: entityId,
            type: 'player',
            ownerId: clientId,
            ...playerData
        },
        clientId,
        timestamp: Date.now()
    };

    for (const c of room.clients) {
        if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(spawnMessage));
        }
    }

    console.log(`Spawned player ${entityId} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
}

function handlePlayerInput(client, data, clientId) {
    const roomId = clientRooms.get(client);
    if (!roomId) return;

    const world = physicsWorlds.get(roomId);
    const info = clientInfo.get(client);
    if (!world || !info) return;

    // Apply input to player's physics body
    world.applyPlayerInput(info.entityId, {
        forward: data.forward || false,
        backward: data.backward || false,
        left: data.left || false,
        right: data.right || false,
        jump: data.jump || false,
        running: data.running || false,
        rotationY: data.rotationY || 0
    });
}

function handleVehicleInput(client, data, clientId) {
    const roomId = clientRooms.get(client);
    if (!roomId) return;

    const world = physicsWorlds.get(roomId);
    if (!world) return;

    const entityId = data.vehicleId;
    if (!entityId) return;

    // Apply input to vehicle's physics body
    world.applyVehicleInput(entityId, {
        throttle: data.throttle || 0,
        steer: data.steer || 0,
        brake: data.brake || false,
        lift: data.lift || 0,
        pitch: data.pitch || 0,
        roll: data.roll || 0,
        yaw: data.yaw || 0
    });
}

function handleSpawnVehicle(client, data, clientId) {
    const roomId = clientRooms.get(client);
    if (!roomId) return;

    const room = rooms.get(roomId);
    const world = physicsWorlds.get(roomId);
    if (!room || !world) return;

    const vehicleType = data.vehicleType || 'jeep';
    const position = data.position || { x: 0, y: 5, z: 0 };

    // Adjust Y to terrain height
    const terrainY = getTerrainHeight(position.x, position.z);
    position.y = Math.max(position.y, terrainY + 3);

    const entityId = `vehicle-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    world.createVehicle(
        entityId,
        vehicleType,
        position,
        { x: 0, y: 0, z: 0, w: 1 }
    );

    const vehicleData = {
        id: entityId,
        type: 'vehicle',
        vehicleType,
        ownerId: clientId,
        position
    };

    room.vehicles.set(entityId, vehicleData);

    // Broadcast spawn
    const spawnMessage = JSON.stringify({
        type: MessageType.ENTITY_SPAWN,
        data: vehicleData,
        clientId,
        timestamp: Date.now()
    });

    for (const c of room.clients) {
        if (c.readyState === WebSocket.OPEN) {
            c.send(spawnMessage);
        }
    }

    console.log(`Spawned ${vehicleType} ${entityId} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
}

function handleCommand(client, message, clientId) {
    const args = message.split(' ');
    const command = args[0].toLowerCase();

    if (command === '/spawnvehicle') {
        const type = args[1] ? args[1].toLowerCase() : 'jeep';
        const validTypes = ['tank', 'helicopter', 'jeep'];

        if (validTypes.includes(type)) {
            const info = clientInfo.get(client);
            const roomId = clientRooms.get(client);
            const room = rooms.get(roomId);

            if (!room || !info) {
                console.log(`/spawnvehicle failed: room=${!!room}, info=${!!info}`);
                send(client, MessageType.CHAT_MESSAGE, {
                    username: 'System',
                    message: 'Unable to spawn vehicle - not in a room.'
                });
                return;
            }

            // Use info.clientId (authoritative) to look up player data
            const playerData = room.players.get(info.clientId);
            if (!playerData) {
                console.log(`/spawnvehicle failed: player ${info.clientId} not found in room.players (size=${room.players.size})`);
                send(client, MessageType.CHAT_MESSAGE, {
                    username: 'System',
                    message: 'Unable to spawn vehicle - player not spawned. Try reconnecting.'
                });
                return;
            }

            // Get player position from physics
            const world = physicsWorlds.get(roomId);
            const state = world?.getBodyState(info.entityId);

            const spawnPos = state?.position || playerData.position || { x: 0, y: 5, z: 0 };

            handleSpawnVehicle(client, {
                vehicleType: type,
                position: {
                    x: spawnPos.x + 10,
                    y: spawnPos.y + 5,
                    z: spawnPos.z
                }
            }, info.clientId);

            send(client, MessageType.CHAT_MESSAGE, {
                username: 'System',
                message: `Spawning ${type}...`
            });
        } else {
            send(client, MessageType.CHAT_MESSAGE, {
                username: 'System',
                message: 'Invalid vehicle type. Use: tank, helicopter, or jeep.'
            });
        }
    } else if (command === '/physics') {
        const roomId = clientRooms.get(client);
        const world = physicsWorlds.get(roomId);
        if (world) {
            const stats = world.getStats();
            send(client, MessageType.CHAT_MESSAGE, {
                username: 'System',
                message: `Physics: ${stats.bodyCount} bodies, step time: ${stats.lastStepTime}`
            });
        }
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function broadcastToRoom(sender, message) {
    const roomId = clientRooms.get(sender);
    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    const messageStr = JSON.stringify(message);

    for (const client of room.clients) {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    }
}

function send(client, type, data) {
    if (client.readyState !== WebSocket.OPEN) return;

    const message = JSON.stringify({
        type,
        data,
        timestamp: Date.now()
    });

    client.send(message);
}

// ============================================
// SERVER STATUS
// ============================================

setInterval(() => {
    let totalClients = 0;
    for (const room of rooms.values()) {
        totalClients += room.clients.size;
    }
    if (totalClients > 0 || rooms.size > 0) {
        console.log(`Status: ${rooms.size} rooms, ${totalClients} clients, ${physicsWorlds.size} physics worlds`);
    }
}, 30000);

console.log(`Cyberia Game Server running on ws://localhost:${PORT}`);
console.log('Press Ctrl+C to stop');
