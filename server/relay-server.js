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

        default:
            // Broadcast to room if it's a broadcast message
            if (data?.broadcast) {
                broadcastToRoom(client, message);
            }
            break;
    }
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

    // Notify others in room
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
                type: 'player_leave',
                data: {
                    clientId: info.clientId,
                    username: info.username
                },
                clientId: info.clientId,
                timestamp: Date.now()
            });
        }

        // Clean up empty rooms
        if (rooms.get(roomId).size === 0) {
            rooms.delete(roomId);
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
