/**
 * Cyberia Multiplayer Relay Server
 *
 * Simple WebSocket relay server for multiplayer gameplay.
 * All clients in the same room receive broadcasts from other clients.
 *
 * Usage: node relay-server.js [port]
 * Default port: 8080
 */

const WebSocket = require('ws');

const PORT = process.argv[2] || 8080;

// Room storage
const rooms = new Map(); // roomId -> Set of clients
const clientRooms = new Map(); // client -> roomId
const clientInfo = new Map(); // client -> { clientId, username }
const playerEntities = new Map(); // clientId -> last entity spawn/update data
const vehicleEntities = new Map(); // roomId -> Map(entityId -> entity data)

// Default vehicles to spawn in every room automatically
const SERVER_VEHICLES = [
    { type: 'vehicle', vehicleType: 'tank', position: { x: 12, y: 10, z: 8 }, rotation: { x: 0, y: 0, z: 0 } },
    { type: 'vehicle', vehicleType: 'helicopter', position: { x: -15, y: 10, z: 12 }, rotation: { x: 0, y: 0, z: 0 } },
    { type: 'vehicle', vehicleType: 'jeep', position: { x: 8, y: 10, z: -14 }, rotation: { x: 0, y: 0, z: 0 } }
];

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

console.log(`Cyberia Relay Server starting on port ${PORT}...`);

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

function handleMessage(client, message) {
    const { type, data, clientId, timestamp } = message;

    switch (type) {
        case 'handshake':
            handleHandshake(client, data, clientId);
            break;

        case 'disconnect':
            handleDisconnect(client);
            break;

        case 'ping':
            // Respond with pong
            send(client, 'pong', { pingTime: timestamp });
            break;

        case 'chat_message':
            // Intercept commands starting with /
            if (data.message && data.message.startsWith('/')) {
                handleCommand(client, data.message, clientId);
            } else {
                // Otherwise broadcast normally
                if (data.broadcast) {
                    broadcastToRoom(client, message);
                }
            }
            break;

        case 'entity_spawn':
            // Store entity spawn data for syncing to new players
            if (data?.type === 'player' && clientId) {
                playerEntities.set(clientId, { ...data, clientId, timestamp });
            }
            // Store vehicle entities for syncing to new players
            if (data?.type === 'vehicle' && data?.id) {
                const roomId = clientRooms.get(client);
                if (roomId) {
                    if (!vehicleEntities.has(roomId)) {
                        vehicleEntities.set(roomId, new Map());
                    }
                    vehicleEntities.get(roomId).set(data.id, { ...data, ownerId: clientId, timestamp });
                }
            }
            // Broadcast to room
            if (data?.broadcast) {
                broadcastToRoom(client, message);
            }
            break;

        case 'entity_update':
        case 'world_state':
            // Update stored player entity data for position sync
            if (data?.type === 'player' && clientId) {
                const existing = playerEntities.get(clientId);
                if (existing) {
                    playerEntities.set(clientId, { ...existing, ...data, timestamp });
                }
            }
            // Update stored vehicle entity data
            if (data?.type === 'vehicle' && data?.id) {
                const roomId = clientRooms.get(client);
                if (roomId && vehicleEntities.has(roomId)) {
                    const existing = vehicleEntities.get(roomId).get(data.id);
                    if (existing) {
                        vehicleEntities.get(roomId).set(data.id, { ...existing, ...data, timestamp });
                    }
                }
            }
            // Handle world_state with multiple entities
            if (type === 'world_state' && data?.entities) {
                const roomId = clientRooms.get(client);
                for (const entity of data.entities) {
                    if (entity.type === 'player' && entity.ownerId) {
                        const existing = playerEntities.get(entity.ownerId);
                        if (existing) {
                            playerEntities.set(entity.ownerId, { ...existing, ...entity, timestamp });
                        }
                    }
                    // Also update vehicle entities in world_state
                    if (entity.type === 'vehicle' && entity.id && roomId && vehicleEntities.has(roomId)) {
                        const existing = vehicleEntities.get(roomId).get(entity.id);
                        if (existing) {
                            vehicleEntities.get(roomId).set(entity.id, { ...existing, ...entity, timestamp });
                        }
                    }
                }
            }
            // Broadcast to room
            if (data?.broadcast) {
                broadcastToRoom(client, message);
            }
            break;

        default:
            // Broadcast to room if it's a broadcast message
            if (data?.broadcast) {
                broadcastToRoom(client, message);
            }
            break;
    }
}

function handleCommand(client, message, clientId) {
    const args = message.split(' ');
    const command = args[0].toLowerCase();

    if (command === '/spawnvehicle') {
        const type = args[1] ? args[1].toLowerCase() : 'jeep';
        const validTypes = ['tank', 'helicopter', 'jeep'];
        
        if (validTypes.includes(type)) {
            spawnVehicleForPlayer(client, clientId, type);
        } else {
            send(client, 'chat_message', {
                username: 'System',
                message: 'Invalid vehicle type. Use: tank, helicopter, or jeep.'
            });
        }
    }
}

function spawnVehicleForPlayer(client, clientId, type) {
    const player = playerEntities.get(clientId);
    if (!player || !player.position) {
        send(client, 'chat_message', { username: 'System', message: 'Error: Could not determine your position.' });
        return;
    }

    const roomId = clientRooms.get(client);
    if (!roomId) return;

    // Calculate spawn position approx 10 units in front of player
    // Assuming rotationY 0 is -Z (Forward)
    const dist = 10;
    const rot = player.rotationY || 0;
    // Standard Three.js: forward is -Z. 
    // rotated vector (0,0,-1) by rot Y: x = -sin(rot), z = -cos(rot)
    const x = player.position.x - Math.sin(rot) * dist;
    const z = player.position.z - Math.cos(rot) * dist;
    const y = player.position.y + 5; // Drop from air to avoid getting stuck in ground

    const id = `cmd-vehicle-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    
    const vehicleData = {
        id,
        type: 'vehicle',
        ownerId: 'server', // Server owned
        vehicleType: type,
        position: { x, y, z },
        rotation: { x: 0, y: rot, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        heading: rot,
        tiltX: 0,
        tiltZ: 0
    };

    // Store in server memory
    if (!vehicleEntities.has(roomId)) vehicleEntities.set(roomId, new Map());
    vehicleEntities.get(roomId).set(id, vehicleData);

    // Broadcast to ALL clients in room (including spawner)
    const spawnMsg = JSON.stringify({
        type: 'entity_spawn',
        data: vehicleData,
        clientId: 'server',
        timestamp: Date.now()
    });

    const room = rooms.get(roomId);
    if (room) {
        for (const c of room) {
            if (c.readyState === WebSocket.OPEN) c.send(spawnMsg);
        }
    }

    // Confirmation
    send(client, 'chat_message', {
        username: 'System',
        message: `Spawned ${type} at ${Math.round(x)}, ${Math.round(z)}`
    });
}

function initializeRoomVehicles(roomId) {
    if (!vehicleEntities.has(roomId)) {
        vehicleEntities.set(roomId, new Map());
    }
    const roomVehicles = vehicleEntities.get(roomId);
    
    SERVER_VEHICLES.forEach((def, index) => {
        const id = `server-vehicle-${Date.now()}-${index}`;
        const vehicleData = {
            id,
            type: 'vehicle',
            ownerId: 'server',
            vehicleType: def.vehicleType,
            position: def.position,
            rotation: def.rotation,
            velocity: { x: 0, y: 0, z: 0 },
            heading: 0,
            tiltX: 0, 
            tiltZ: 0
        };
        roomVehicles.set(id, vehicleData);
    });
    
    console.log(`Initialized ${SERVER_VEHICLES.length} server vehicles for room ${roomId}`);
}

function handleHandshake(client, data, clientId) {
    const roomId = data.roomId || 'default';

    // Store client info
    clientInfo.set(client, {
        clientId,
        username: data.username || 'Player',
        version: data.version
    });

    // Add to room
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
        // Initialize default server vehicles when room is created
        initializeRoomVehicles(roomId);
    }
    rooms.get(roomId).add(client);
    clientRooms.set(client, roomId);

    // Determine if this client is the host (first in room)
    const isHost = rooms.get(roomId).size === 1;

    // Send handshake response
    send(client, 'handshake', {
        success: true,
        roomId,
        isHost,
        clientCount: rooms.get(roomId).size
    });

    // Send existing players to the new client
    const room = rooms.get(roomId);
    for (const otherClient of room) {
        if (otherClient !== client && otherClient.readyState === WebSocket.OPEN) {
            const otherInfo = clientInfo.get(otherClient);
            if (otherInfo) {
                // Send existing player's entity data if available
                const entityData = playerEntities.get(otherInfo.clientId);
                if (entityData) {
                    const spawnMessage = JSON.stringify({
                        type: 'entity_spawn',
                        data: entityData,
                        clientId: otherInfo.clientId,
                        timestamp: Date.now()
                    });
                    client.send(spawnMessage);
                } else {
                    const joinMessage = JSON.stringify({
                        type: 'player_join',
                        data: {
                            clientId: otherInfo.clientId,
                            username: otherInfo.username
                        },
                        clientId: otherInfo.clientId,
                        timestamp: Date.now()
                    });
                    client.send(joinMessage);
                }
            }
        }
    }

    // Send existing vehicles to the new client (including server vehicles)
    if (vehicleEntities.has(roomId)) {
        const roomVehicles = vehicleEntities.get(roomId);
        for (const [entityId, entityData] of roomVehicles) {
            const spawnMessage = JSON.stringify({
                type: 'entity_spawn',
                data: entityData,
                clientId: entityData.ownerId, 
                timestamp: Date.now()
            });
            client.send(spawnMessage);
        }
    }

    // Notify others in room about the new player
    broadcastToRoom(client, {
        type: 'player_join',
        data: {
            clientId,
            username: data.username || 'Player'
        },
        clientId,
        timestamp: Date.now()
    });

    console.log(`Client ${clientId} joined room ${roomId} (${rooms.get(roomId).size} clients)`);
}

function handleDisconnect(client) {
    const info = clientInfo.get(client);
    const roomId = clientRooms.get(client);

    if (roomId && rooms.has(roomId)) {
        rooms.get(roomId).delete(client);

        // Notify others in room
        if (info) {
            broadcastToRoom(client, {
                type: 'entity_destroy',
                data: {
                    id: playerEntities.get(info.clientId)?.id,
                    type: 'player'
                },
                clientId: info.clientId,
                timestamp: Date.now()
            });

            broadcastToRoom(client, {
                type: 'player_leave',
                data: {
                    clientId: info.clientId,
                    username: info.username
                },
                clientId: info.clientId,
                timestamp: Date.now()
            });

            playerEntities.delete(info.clientId);
        }

        // Clean up empty rooms
        if (rooms.get(roomId).size === 0) {
            rooms.delete(roomId);
            vehicleEntities.delete(roomId);
            console.log(`Room ${roomId} closed (empty)`);
        }
    }

    clientRooms.delete(client);
    clientInfo.delete(client);

    if (info) {
        console.log(`Client ${info.clientId} disconnected`);
    }
}

function broadcastToRoom(sender, message) {
    const roomId = clientRooms.get(sender);
    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    const messageStr = JSON.stringify(message);

    for (const client of room) {
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

// Server status logging
setInterval(() => {
    let totalClients = 0;
    for (const room of rooms.values()) {
        totalClients += room.size;
    }
    if (totalClients > 0) {
        console.log(`Status: ${rooms.size} rooms, ${totalClients} clients`);
    }
}, 30000);

console.log(`Cyberia Relay Server running on ws://localhost:${PORT}`);
console.log('Press Ctrl+C to stop');