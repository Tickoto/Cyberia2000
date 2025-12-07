import { CONFIG } from './config.js';

// ============================================
// NETWORK ENTITY TYPES
// ============================================
export const NetworkEntityType = {
    PLAYER: 'player',
    NPC: 'npc',
    UNIT: 'unit',
    OBJECT: 'object',
    PROJECTILE: 'projectile'
};

// ============================================
// MESSAGE TYPES
// ============================================
export const MessageType = {
    // Connection
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    HANDSHAKE: 'handshake',
    PING: 'ping',
    PONG: 'pong',

    // Entity sync
    ENTITY_SPAWN: 'entity_spawn',
    ENTITY_UPDATE: 'entity_update',
    ENTITY_DESTROY: 'entity_destroy',

    // Batch updates
    WORLD_STATE: 'world_state',

    // Player specific
    PLAYER_JOIN: 'player_join',
    PLAYER_LEAVE: 'player_leave',
    PLAYER_INPUT: 'player_input',

    // Chat
    CHAT_MESSAGE: 'chat_message',

    // Game events
    GAME_EVENT: 'game_event'
};

// ============================================
// NETWORK ENTITY - Base class for syncable objects
// ============================================
export class NetworkEntity {
    constructor(type, id = null) {
        this.networkId = id || NetworkEntity.generateId();
        this.entityType = type;
        this.ownerId = null; // Which client owns/controls this entity
        this.isLocal = false; // Is this entity controlled locally?
        this.lastUpdateTime = 0;
        this.interpolationBuffer = [];
        this.syncProperties = {}; // Properties to sync
    }

    static generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Override in subclasses to define what gets synced
    getSyncData() {
        return {
            id: this.networkId,
            type: this.entityType,
            ownerId: this.ownerId,
            ...this.syncProperties
        };
    }

    // Override to apply received sync data
    applySyncData(data) {
        Object.assign(this.syncProperties, data);
    }

    // Add state to interpolation buffer for smooth movement
    addInterpolationState(state, timestamp) {
        this.interpolationBuffer.push({ state, timestamp });
        // Keep only last 10 states
        if (this.interpolationBuffer.length > 10) {
            this.interpolationBuffer.shift();
        }
    }

    // Get interpolated state at given time
    getInterpolatedState(renderTime) {
        const buffer = this.interpolationBuffer;
        if (buffer.length < 2) return null;

        // Find the two states to interpolate between
        let before = null;
        let after = null;

        for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i].timestamp <= renderTime && buffer[i + 1].timestamp >= renderTime) {
                before = buffer[i];
                after = buffer[i + 1];
                break;
            }
        }

        if (!before || !after) {
            return buffer[buffer.length - 1]?.state || null;
        }

        const t = (renderTime - before.timestamp) / (after.timestamp - before.timestamp);
        return this.lerpState(before.state, after.state, Math.max(0, Math.min(1, t)));
    }

    // Override for custom interpolation
    lerpState(a, b, t) {
        const result = {};
        for (const key in a) {
            if (typeof a[key] === 'number') {
                result[key] = a[key] + (b[key] - a[key]) * t;
            } else {
                result[key] = t < 0.5 ? a[key] : b[key];
            }
        }
        return result;
    }
}

// ============================================
// NETWORK PLAYER - Player entity for networking
// ============================================
export class NetworkPlayer extends NetworkEntity {
    constructor(id = null) {
        super(NetworkEntityType.PLAYER, id);
        this.syncProperties = {
            x: 0, y: 0, z: 0,
            rotationY: 0,
            animationSpeed: 0,
            username: 'Player',
            appearance: {}
        };
    }

    getSyncData() {
        return {
            ...super.getSyncData(),
            position: { x: this.syncProperties.x, y: this.syncProperties.y, z: this.syncProperties.z },
            rotationY: this.syncProperties.rotationY,
            animationSpeed: this.syncProperties.animationSpeed,
            username: this.syncProperties.username,
            appearance: this.syncProperties.appearance
        };
    }

    applySyncData(data) {
        if (data.position) {
            this.syncProperties.x = data.position.x;
            this.syncProperties.y = data.position.y;
            this.syncProperties.z = data.position.z;
        }
        if (data.rotationY !== undefined) this.syncProperties.rotationY = data.rotationY;
        if (data.animationSpeed !== undefined) this.syncProperties.animationSpeed = data.animationSpeed;
        if (data.username) this.syncProperties.username = data.username;
        if (data.appearance) this.syncProperties.appearance = data.appearance;
    }
}

// ============================================
// NETWORK UNIT - War unit for networking
// ============================================
export class NetworkUnit extends NetworkEntity {
    constructor(id = null) {
        super(NetworkEntityType.UNIT, id);
        this.syncProperties = {
            x: 0, y: 0, z: 0,
            rotationY: 0,
            faction: 0,
            unitType: 'tank',
            health: 100
        };
    }

    getSyncData() {
        return {
            ...super.getSyncData(),
            position: { x: this.syncProperties.x, y: this.syncProperties.y, z: this.syncProperties.z },
            rotationY: this.syncProperties.rotationY,
            faction: this.syncProperties.faction,
            unitType: this.syncProperties.unitType,
            health: this.syncProperties.health
        };
    }

    applySyncData(data) {
        if (data.position) {
            this.syncProperties.x = data.position.x;
            this.syncProperties.y = data.position.y;
            this.syncProperties.z = data.position.z;
        }
        if (data.rotationY !== undefined) this.syncProperties.rotationY = data.rotationY;
        if (data.faction !== undefined) this.syncProperties.faction = data.faction;
        if (data.unitType) this.syncProperties.unitType = data.unitType;
        if (data.health !== undefined) this.syncProperties.health = data.health;
    }
}

// ============================================
// NETWORK OBJECT - Interactive object for networking
// ============================================
export class NetworkObject extends NetworkEntity {
    constructor(id = null) {
        super(NetworkEntityType.OBJECT, id);
        this.syncProperties = {
            x: 0, y: 0, z: 0,
            objectId: '',
            state: {},
            cooldown: 0
        };
    }

    getSyncData() {
        return {
            ...super.getSyncData(),
            position: { x: this.syncProperties.x, y: this.syncProperties.y, z: this.syncProperties.z },
            objectId: this.syncProperties.objectId,
            state: this.syncProperties.state,
            cooldown: this.syncProperties.cooldown
        };
    }

    applySyncData(data) {
        if (data.position) {
            this.syncProperties.x = data.position.x;
            this.syncProperties.y = data.position.y;
            this.syncProperties.z = data.position.z;
        }
        if (data.objectId) this.syncProperties.objectId = data.objectId;
        if (data.state) this.syncProperties.state = data.state;
        if (data.cooldown !== undefined) this.syncProperties.cooldown = data.cooldown;
    }
}

// ============================================
// NETWORK MANAGER - Core networking class
// ============================================
export class NetworkManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.isHost = false;
        this.clientId = NetworkEntity.generateId();
        this.roomId = null;

        // Entity registry
        this.entities = new Map(); // networkId -> NetworkEntity
        this.entityHandlers = new Map(); // entityType -> { spawn, update, destroy }

        // Message handlers
        this.messageHandlers = new Map();

        // Callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onChatMessage = null;
        this.onGameEvent = null;

        // Network stats
        this.ping = 0;
        this.lastPingTime = 0;
        this.packetsReceived = 0;
        this.packetsSent = 0;

        // Update throttling
        this.updateInterval = CONFIG.networkUpdateRate || 50; // ms
        this.lastUpdateTime = 0;
        this.pendingUpdates = new Map();

        // Interpolation settings
        this.interpolationDelay = CONFIG.networkInterpolationDelay || 100; // ms

        this.setupDefaultHandlers();
    }

    // ============================================
    // CONNECTION
    // ============================================

    connect(serverUrl, roomId = 'default') {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.warn('Already connected');
            return Promise.resolve();
        }

        this.roomId = roomId;

        return new Promise((resolve, reject) => {
            try {
                this.socket = new WebSocket(serverUrl);

                this.socket.onopen = () => {
                    console.log('Network: Connected to server');
                    this.isConnected = true;
                    this.sendHandshake();
                    if (this.onConnected) this.onConnected();
                    resolve();
                };

                this.socket.onclose = (event) => {
                    console.log('Network: Disconnected', event.code, event.reason);
                    this.isConnected = false;
                    if (this.onDisconnected) this.onDisconnected(event);
                };

                this.socket.onerror = (error) => {
                    console.error('Network: Error', error);
                    reject(error);
                };

                this.socket.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    disconnect() {
        if (this.socket) {
            this.send(MessageType.DISCONNECT, { clientId: this.clientId });
            this.socket.close();
            this.socket = null;
        }
        this.isConnected = false;
        this.entities.clear();
    }

    sendHandshake() {
        this.send(MessageType.HANDSHAKE, {
            clientId: this.clientId,
            roomId: this.roomId,
            version: '1.0.0'
        });
    }

    // ============================================
    // MESSAGE SENDING
    // ============================================

    send(type, data) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        const message = JSON.stringify({
            type,
            data,
            clientId: this.clientId,
            timestamp: Date.now()
        });

        this.socket.send(message);
        this.packetsSent++;
        return true;
    }

    broadcast(type, data) {
        return this.send(type, { ...data, broadcast: true });
    }

    // ============================================
    // MESSAGE HANDLING
    // ============================================

    handleMessage(rawData) {
        this.packetsReceived++;

        try {
            const message = JSON.parse(rawData);
            const { type, data, clientId, timestamp } = message;

            // Don't process our own messages
            if (clientId === this.clientId && type !== MessageType.PONG) {
                return;
            }

            // Check for registered handler
            const handler = this.messageHandlers.get(type);
            if (handler) {
                handler(data, clientId, timestamp);
            } else {
                console.warn('Network: Unknown message type:', type);
            }

        } catch (error) {
            console.error('Network: Failed to parse message:', error);
        }
    }

    registerMessageHandler(type, handler) {
        this.messageHandlers.set(type, handler);
    }

    setupDefaultHandlers() {
        // Handshake response
        this.registerMessageHandler(MessageType.HANDSHAKE, (data) => {
            if (data.isHost !== undefined) {
                this.isHost = data.isHost;
            }
            console.log('Network: Handshake complete, isHost:', this.isHost);
        });

        // Ping/Pong
        this.registerMessageHandler(MessageType.PING, (data, clientId) => {
            this.send(MessageType.PONG, { pingTime: data.timestamp });
        });

        this.registerMessageHandler(MessageType.PONG, (data) => {
            this.ping = Date.now() - data.pingTime;
        });

        // Entity spawn
        this.registerMessageHandler(MessageType.ENTITY_SPAWN, (data, clientId) => {
            this.handleEntitySpawn(data, clientId);
        });

        // Entity update
        this.registerMessageHandler(MessageType.ENTITY_UPDATE, (data, clientId, timestamp) => {
            this.handleEntityUpdate(data, clientId, timestamp);
        });

        // Entity destroy
        this.registerMessageHandler(MessageType.ENTITY_DESTROY, (data) => {
            this.handleEntityDestroy(data);
        });

        // World state (bulk sync)
        this.registerMessageHandler(MessageType.WORLD_STATE, (data, clientId, timestamp) => {
            this.handleWorldState(data, timestamp);
        });

        // Player events
        this.registerMessageHandler(MessageType.PLAYER_JOIN, (data, clientId) => {
            if (this.onPlayerJoined) this.onPlayerJoined(data, clientId);
        });

        this.registerMessageHandler(MessageType.PLAYER_LEAVE, (data, clientId) => {
            if (this.onPlayerLeft) this.onPlayerLeft(data, clientId);
        });

        // Chat
        this.registerMessageHandler(MessageType.CHAT_MESSAGE, (data, clientId) => {
            if (this.onChatMessage) this.onChatMessage(data, clientId);
        });

        // Game events
        this.registerMessageHandler(MessageType.GAME_EVENT, (data, clientId) => {
            if (this.onGameEvent) this.onGameEvent(data, clientId);
        });
    }

    // ============================================
    // ENTITY MANAGEMENT
    // ============================================

    registerEntityHandler(entityType, handlers) {
        this.entityHandlers.set(entityType, handlers);
    }

    registerEntity(entity) {
        if (!entity.networkId) {
            entity.networkId = NetworkEntity.generateId();
        }
        entity.ownerId = this.clientId;
        entity.isLocal = true;
        this.entities.set(entity.networkId, entity);

        // Broadcast spawn
        this.broadcast(MessageType.ENTITY_SPAWN, entity.getSyncData());

        return entity.networkId;
    }

    unregisterEntity(networkId) {
        const entity = this.entities.get(networkId);
        if (entity) {
            this.entities.delete(networkId);
            this.broadcast(MessageType.ENTITY_DESTROY, { id: networkId, type: entity.entityType });
        }
    }

    getEntity(networkId) {
        return this.entities.get(networkId);
    }

    getEntitiesByType(type) {
        const result = [];
        for (const entity of this.entities.values()) {
            if (entity.entityType === type) {
                result.push(entity);
            }
        }
        return result;
    }

    handleEntitySpawn(data, clientId) {
        // Don't spawn our own entities from network
        if (data.ownerId === this.clientId) return;

        // Check if entity already exists
        if (this.entities.has(data.id)) return;

        const handler = this.entityHandlers.get(data.type);
        if (handler && handler.spawn) {
            const entity = handler.spawn(data, clientId);
            if (entity) {
                entity.networkId = data.id;
                entity.ownerId = data.ownerId || clientId;
                entity.isLocal = false;
                this.entities.set(data.id, entity);
            }
        }
    }

    handleEntityUpdate(data, clientId, timestamp) {
        const entity = this.entities.get(data.id);
        if (!entity) return;

        // Don't update our own entities from network
        if (entity.isLocal) return;

        // Add to interpolation buffer
        entity.addInterpolationState(data, timestamp);

        const handler = this.entityHandlers.get(entity.entityType);
        if (handler && handler.update) {
            handler.update(entity, data, timestamp);
        } else {
            entity.applySyncData(data);
        }
    }

    handleEntityDestroy(data) {
        const entity = this.entities.get(data.id);
        if (!entity || entity.isLocal) return;

        const handler = this.entityHandlers.get(data.type);
        if (handler && handler.destroy) {
            handler.destroy(entity);
        }

        this.entities.delete(data.id);
    }

    handleWorldState(data, timestamp) {
        if (!data.entities) return;

        for (const entityData of data.entities) {
            if (this.entities.has(entityData.id)) {
                this.handleEntityUpdate(entityData, entityData.ownerId, timestamp);
            } else {
                this.handleEntitySpawn(entityData, entityData.ownerId);
            }
        }
    }

    // ============================================
    // UPDATE LOOP
    // ============================================

    update(delta) {
        if (!this.isConnected) return;

        const now = Date.now();

        // Send pending updates at throttled rate
        if (now - this.lastUpdateTime >= this.updateInterval) {
            this.lastUpdateTime = now;
            this.sendPendingUpdates();
        }

        // Update interpolation for remote entities
        const renderTime = now - this.interpolationDelay;
        for (const entity of this.entities.values()) {
            if (!entity.isLocal) {
                const state = entity.getInterpolatedState(renderTime);
                if (state) {
                    entity.applySyncData(state);
                }
            }
        }

        // Periodic ping
        if (now - this.lastPingTime > 5000) {
            this.lastPingTime = now;
            this.send(MessageType.PING, { timestamp: now });
        }
    }

    queueEntityUpdate(networkId, data) {
        this.pendingUpdates.set(networkId, {
            id: networkId,
            ...data
        });
    }

    sendPendingUpdates() {
        if (this.pendingUpdates.size === 0) return;

        // Batch updates into world state
        const updates = Array.from(this.pendingUpdates.values());
        this.pendingUpdates.clear();

        if (updates.length === 1) {
            this.broadcast(MessageType.ENTITY_UPDATE, updates[0]);
        } else {
            this.broadcast(MessageType.WORLD_STATE, { entities: updates });
        }
    }

    // ============================================
    // UTILITY
    // ============================================

    sendChat(message, username) {
        this.broadcast(MessageType.CHAT_MESSAGE, {
            message,
            username,
            timestamp: Date.now()
        });
    }

    sendGameEvent(eventType, eventData) {
        this.broadcast(MessageType.GAME_EVENT, {
            eventType,
            eventData,
            timestamp: Date.now()
        });
    }

    getStats() {
        return {
            connected: this.isConnected,
            ping: this.ping,
            entityCount: this.entities.size,
            packetsSent: this.packetsSent,
            packetsReceived: this.packetsReceived
        };
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================
export const networkManager = new NetworkManager();
