import { CONFIG, URBAN_BIOMES, getUrbanBiomeType } from './config.js';
import { hash, seededRandom, getTerrainHeight, biomeInfoAtPosition, getCityInfluence, getUrbanBiomeAtPosition } from './terrain.js';
import { createTexture } from './textures.js';
import { Character } from './character.js';
import { InteractionManager } from './interaction-manager.js';

export class WorldManager {
    constructor(scene, physics) {
        this.scene = scene;
        this.chunks = {};
        this.npcs = [];
        this.interiors = {};
        this.pendingChunks = new Set();
        this.physics = physics;
        this.interactionManager = new InteractionManager(scene);
        this.interactionManager.setHeightSampler((x, z) => getTerrainHeight(x, z));
    }

    meshCollider(mesh, padding = 0.01) {
        if (!mesh?.isMesh) return null;
        mesh.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(mesh);
        if (padding > 0) {
            box.expandByVector(new THREE.Vector3(padding, padding, padding));
        }
        return box;
    }

    update(playerPos, delta) {
        const cx = Math.floor(playerPos.x / CONFIG.chunkSize);
        const cz = Math.floor(playerPos.z / CONFIG.chunkSize);

        for (let x = -CONFIG.renderDistance; x <= CONFIG.renderDistance; x++) {
            for (let z = -CONFIG.renderDistance; z <= CONFIG.renderDistance; z++) {
                const key = `${cx + x},${cz + z}`;
                if (!this.chunks[key] && !this.pendingChunks.has(key)) {
                    this.pendingChunks.add(key);
                    this.generateChunkAsync(cx + x, cz + z, key);
                }
            }
        }

        const keysToRemove = [];
        Object.keys(this.chunks).forEach(key => {
            const [kx, kz] = key.split(',').map(Number);
            if (Math.abs(kx - cx) > CONFIG.renderDistance + 1 ||
                Math.abs(kz - cz) > CONFIG.renderDistance + 1) {
                keysToRemove.push(key);
            }
        });

        keysToRemove.forEach(key => {
            this.scene.remove(this.chunks[key]);
            this.physics.removeChunkColliders(key);
            this.interactionManager.clearForChunk(key);
            delete this.chunks[key];
        });

        this.npcs.forEach(npc => npc.updateNPC(delta));
        this.updateLocationHUD(playerPos, cx, cz);
    }

    findCitySpawnPoint() {
        // Spiral search outward for a strong city influence to ensure players start in a hub
        const maxRadius = CONFIG.chunkSize * 10;
        const step = CONFIG.chunkSize / 2;
        let best = { influence: -1, x: 0, z: 0 };

        for (let radius = step; radius <= maxRadius; radius += step) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
                const x = Math.cos(angle) * radius;
                const z = Math.sin(angle) * radius;
                const influence = getCityInfluence(x, z);

                if (influence > best.influence) {
                    best = { influence, x, z };
                }

                if (influence >= CONFIG.cityInfluenceThreshold) {
                    const y = getTerrainHeight(x, z) + 2;
                    return { x, y, z };
                }
            }
        }

        const fallbackY = getTerrainHeight(best.x, best.z) + 2;
        return { x: best.x, y: fallbackY, z: best.z };
    }

    generateChunkAsync(cx, cz, key) {
        setTimeout(() => {
            if (this.chunks[key]) {
                this.pendingChunks.delete(key);
                return;
            }

            const chunk = this.generateChunk(cx, cz);
            this.chunks[key] = chunk;
            this.scene.add(chunk);
            this.pendingChunks.delete(key);
        }, 0);
    }

    sampleCityInfluenceForChunk(ox, oz) {
        const half = CONFIG.chunkSize / 2;
        const samples = [
            getCityInfluence(ox + half, oz + half),
            getCityInfluence(ox, oz),
            getCityInfluence(ox + CONFIG.chunkSize, oz),
            getCityInfluence(ox, oz + CONFIG.chunkSize),
            getCityInfluence(ox + CONFIG.chunkSize, oz + CONFIG.chunkSize)
        ];
        return Math.max(...samples);
    }

    getRoadPositions(ox, oz, isCity) {
        const roadPositions = [];
        if (!isCity) return roadPositions;

        const blockSize = 65;
        const roadWidth = 20;
        const startX = ox - ((ox % blockSize + blockSize) % blockSize);
        const startZ = oz - ((oz % blockSize + blockSize) % blockSize);

        // Collect all road positions in this chunk
        for (let x = -roadWidth; x <= CONFIG.chunkSize + roadWidth; x += blockSize) {
            const roadCenterX = ox + x + roadWidth / 2;
            const roadCenterZ = oz + CONFIG.chunkSize / 2;

            const roadInfluence = getCityInfluence(roadCenterX, roadCenterZ);
            if (roadInfluence >= CONFIG.cityInfluenceThreshold * 0.9) {
                roadPositions.push({
                    type: 'vertical',
                    centerX: roadCenterX,
                    centerZ: roadCenterZ,
                    width: roadWidth,
                    length: CONFIG.chunkSize + blockSize
                });
            }
        }

        for (let z = -roadWidth; z <= CONFIG.chunkSize + roadWidth; z += blockSize) {
            const roadCenterX = ox + CONFIG.chunkSize / 2;
            const roadCenterZ = oz + z + roadWidth / 2;

            const roadInfluence = getCityInfluence(roadCenterX, roadCenterZ);
            if (roadInfluence >= CONFIG.cityInfluenceThreshold * 0.9) {
                roadPositions.push({
                    type: 'horizontal',
                    centerX: roadCenterX,
                    centerZ: roadCenterZ,
                    width: CONFIG.chunkSize + blockSize,
                    length: roadWidth
                });
            }
        }

        return roadPositions;
    }

    isOnRoad(wx, wz, roadPositions) {
        for (const road of roadPositions) {
            if (road.type === 'vertical') {
                // Road runs along Z axis, check X distance from center
                const distX = Math.abs(wx - road.centerX);
                const distZ = Math.abs(wz - road.centerZ);
                if (distX <= road.width / 2 && distZ <= road.length / 2) {
                    return true;
                }
            } else {
                // Road runs along X axis, check Z distance from center
                const distX = Math.abs(wx - road.centerX);
                const distZ = Math.abs(wz - road.centerZ);
                if (distX <= road.width / 2 && distZ <= road.length / 2) {
                    return true;
                }
            }
        }
        return false;
    }

    generateChunk(cx, cz) {
        const group = new THREE.Group();
        const offsetX = cx * CONFIG.chunkSize;
        const offsetZ = cz * CONFIG.chunkSize;
        const centerX = offsetX + CONFIG.chunkSize / 2;
        const centerZ = offsetZ + CONFIG.chunkSize / 2;

        // Use CENTER influence to determine consistent urban biome for entire chunk
        // This prevents morphing between settlement types within the same area
        const centerInfluence = getCityInfluence(centerX, centerZ);
        const urbanBiome = getUrbanBiomeType(centerInfluence);
        const isUrban = urbanBiome !== null;

        // Determine if this chunk should generate city content based on center influence only
        const isCity = isUrban;
        const colliders = [];

        const segments = 40;
        const groundGeo = new THREE.PlaneGeometry(CONFIG.chunkSize, CONFIG.chunkSize, segments, segments);
        const vertices = groundGeo.attributes.position.array;

        const biome = biomeInfoAtPosition(offsetX, offsetZ);

        // Determine the influence threshold for terrain flattening based on urban biome type
        const flattenThreshold = urbanBiome ? urbanBiome.influenceThreshold : CONFIG.cityInfluenceThreshold;

        for (let i = 0; i < vertices.length; i += 3) {
            const localX = vertices[i];
            const localY = vertices[i + 1];
            const worldX = offsetX + localX + CONFIG.chunkSize / 2;
            // Account for -90° rotation around X axis: Y becomes -Z
            const worldZ = offsetZ - localY + CONFIG.chunkSize / 2;

            // If this is an urban chunk, flatten terrain consistently
            if (isUrban) {
                // For urban areas, use consistent flat terrain
                vertices[i + 2] = CONFIG.cityPlateauHeight;
            } else {
                // For non-urban areas, use natural terrain
                vertices[i + 2] = getTerrainHeight(worldX, worldZ);
            }
        }

        groundGeo.computeVertexNormals();
        this.addSkirt(groundGeo);

        const groundMat = isCity
            ? new THREE.MeshLambertMaterial({ map: createTexture('asphalt', '#111') })
            : centerInfluence >= 0.25
                ? new THREE.MeshLambertMaterial({ map: createTexture('asphalt', '#111') })
                : new THREE.MeshLambertMaterial({ map: createTexture('grass', biome.primaryColor, biome.key) });

        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(offsetX + CONFIG.chunkSize / 2, 0, offsetZ + CONFIG.chunkSize / 2);
        ground.receiveShadow = true;
        // Mark as terrain - used for raycasting but NOT Box3 collision
        // Terrain height is handled by terrainSampler in physics integration
        ground.userData.isGround = true;
        group.add(ground);

        const chunkKey = `${cx},${cz}`;

        if (isCity) {
            this.generateCity(group, offsetX, offsetZ, cx, cz, colliders, urbanBiome);
        } else {
            this.generateWilderness(group, offsetX, offsetZ, cx, cz, biome, colliders);
        }

        this.physics.addChunkColliders(chunkKey, colliders);
        this.physics.addChunkGroup(chunkKey, group);
        this.interactionManager.generateForChunk(cx, cz);
        return group;
    }

    generateCity(group, ox, oz, cx, cz, colliders, urbanBiome = null) {
        // Use urban biome settings - if no biome provided, this shouldn't be called
        // but fall back to village (smallest) for safety rather than city
        const biomeConfig = urbanBiome || URBAN_BIOMES.village;
        const blockSize = biomeConfig.blockSize;
        const roadWidth = biomeConfig.roadWidth;
        const buildingMinHeight = biomeConfig.buildingMinHeight;
        const buildingMaxHeight = biomeConfig.buildingMaxHeight;
        const buildingDensity = biomeConfig.buildingDensity;
        const parkChance = biomeConfig.parkChance;
        const sidewalkHeight = 0.15; // Curb height - small enough to step on
        const baseHeight = CONFIG.cityPlateauHeight;

        const startX = ox - ((ox % blockSize + blockSize) % blockSize);
        const startZ = oz - ((oz % blockSize + blockSize) % blockSize);

        for (let gx = startX; gx < ox + CONFIG.chunkSize + blockSize; gx += blockSize) {
            for (let gz = startZ; gz < oz + CONFIG.chunkSize + blockSize; gz += blockSize) {
                const buildable = blockSize - roadWidth - 8;
                const centerX = gx + buildable / 2 + 4;
                const centerZ = gz + buildable / 2 + 4;

                // Check if this block position is actually in a city area
                const blockCityInfluence = getCityInfluence(centerX, centerZ);
                if (blockCityInfluence < CONFIG.cityInfluenceThreshold * 0.85) {
                    continue; // Skip this block if it's not in a strong city area
                }

                const blockRandom = (offset = 0) => seededRandom((gx + offset * 17.13) * 0.1337 + (gz - offset * 11.41) * 0.7331);
                const blockRoll = blockRandom(1);

                // Adjust roll thresholds based on urban biome type
                const isVillage = biomeConfig.key === 'village';
                const isTown = biomeConfig.key === 'town';
                const isMegacity = biomeConfig.key === 'megacity';

                const sidewalk = new THREE.Mesh(
                    new THREE.BoxGeometry(buildable + 8, sidewalkHeight, buildable + 8),
                    new THREE.MeshLambertMaterial({ color: 0x2f3033 })
                );
                sidewalk.position.set(centerX, baseHeight + sidewalkHeight / 2, centerZ);
                group.add(sidewalk);

                // Add sidewalk collider so players can walk on it
                const sidewalkCollider = this.meshCollider(sidewalk, 0.01);
                if (sidewalkCollider) colliders.push(sidewalkCollider);

                // Use biome-specific park chance for block type selection
                const adjustedParkChance = parkChance;
                const adjustedBuildingThreshold = 1.0 - buildingDensity;

                if (blockRoll < adjustedParkChance) {
                    // Park with trees and pond (more common in villages)
                    const parkBase = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable, 0.6, buildable),
                        new THREE.MeshLambertMaterial({ map: createTexture('grass', '#203320', 'city') })
                    );
                    parkBase.position.set(centerX, baseHeight + sidewalkHeight + 0.3, centerZ);
                    group.add(parkBase);

                    for (let i = 0; i < 6; i++) {
                        const localSeed = blockRandom(i + 5);
                        const px = centerX + (localSeed - 0.5) * (buildable * 0.7);
                        const pz = centerZ + (blockRandom(i + 8) - 0.5) * (buildable * 0.7);
                        const treeHeight = 6 + blockRandom(i + 12) * 4;
                        const trunk = new THREE.Mesh(
                            new THREE.CylinderGeometry(0.35, 0.6, treeHeight * 0.4, 6),
                            new THREE.MeshLambertMaterial({ color: 0x4a3322 })
                        );
                        const crown = new THREE.Mesh(
                            new THREE.ConeGeometry(2.6, treeHeight * 0.6, 6),
                            new THREE.MeshLambertMaterial({ color: 0x2d5c2d })
                        );
                        const tree = new THREE.Group();
                        trunk.position.y = treeHeight * 0.2;
                        crown.position.y = treeHeight * 0.65;
                        tree.add(trunk);
                        tree.add(crown);
                        tree.position.set(px, baseHeight + sidewalkHeight + 0.3, pz);
                        group.add(tree);
                    }

                    for (let i = 0; i < 4; i++) {
                        const bench = new THREE.Mesh(
                            new THREE.BoxGeometry(6, 1, 2),
                            new THREE.MeshLambertMaterial({ color: 0x4a4a4a })
                        );
                        bench.position.set(
                            centerX + Math.cos(i * Math.PI / 2) * (buildable * 0.35),
                            baseHeight + sidewalkHeight + 1,
                            centerZ + Math.sin(i * Math.PI / 2) * (buildable * 0.35)
                        );
                        group.add(bench);
                        const benchCollider = this.meshCollider(bench, 0.01);
                        if (benchCollider) colliders.push(benchCollider);
                    }

                    const pond = new THREE.Mesh(
                        new THREE.CylinderGeometry(8, 8, 0.4, 12),
                        new THREE.MeshStandardMaterial({ color: 0x224477, metalness: 0.2, roughness: 0.35 })
                    );
                    pond.position.set(centerX, baseHeight + sidewalkHeight + 0.3, centerZ);
                    group.add(pond);
                } else if (blockRoll < 0.25) {
                    // Rooftop garden / green space
                    const gardenBase = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable, 0.4, buildable),
                        new THREE.MeshLambertMaterial({ map: createTexture('grass', '#1a4a1a', 'city') })
                    );
                    gardenBase.position.set(centerX, baseHeight + sidewalkHeight + 0.2, centerZ);
                    group.add(gardenBase);

                    // Add flower beds
                    for (let i = 0; i < 4; i++) {
                        const flowerBed = new THREE.Mesh(
                            new THREE.BoxGeometry(8, 0.8, 8),
                            new THREE.MeshLambertMaterial({ color: 0x8a4a2a })
                        );
                        flowerBed.position.set(
                            centerX + (i % 2 === 0 ? -1 : 1) * buildable * 0.25,
                            baseHeight + sidewalkHeight + 0.6,
                            centerZ + (i < 2 ? -1 : 1) * buildable * 0.25
                        );
                        group.add(flowerBed);

                        // Flowers
                        for (let j = 0; j < 5; j++) {
                            const flower = new THREE.Mesh(
                                new THREE.SphereGeometry(0.5, 6, 6),
                                new THREE.MeshLambertMaterial({ color: [0xff3366, 0xffaa33, 0x6633ff][j % 3] })
                            );
                            flower.position.set(
                                flowerBed.position.x + (blockRandom(i * 10 + j) - 0.5) * 6,
                                baseHeight + sidewalkHeight + 1.2,
                                flowerBed.position.z + (blockRandom(i * 10 + j + 5) - 0.5) * 6
                            );
                            group.add(flower);
                        }
                    }

                    // Garden path
                    const path = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable * 0.3, 0.1, buildable),
                        new THREE.MeshLambertMaterial({ color: 0x5a5a5a })
                    );
                    path.position.set(centerX, baseHeight + sidewalkHeight + 0.25, centerZ);
                    group.add(path);
                } else if (blockRoll < 0.33) {
                    // Amphitheater / performance space
                    const stage = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable * 0.4, 2, buildable * 0.3),
                        new THREE.MeshLambertMaterial({ color: 0x3a3a4a })
                    );
                    stage.position.set(centerX, baseHeight + sidewalkHeight + 1, centerZ - buildable * 0.3);
                    group.add(stage);

                    // Seating tiers
                    for (let tier = 0; tier < 4; tier++) {
                        const seats = new THREE.Mesh(
                            new THREE.BoxGeometry(buildable * 0.7, 0.6, buildable * 0.15),
                            new THREE.MeshLambertMaterial({ color: 0x4a4a5a })
                        );
                        seats.position.set(
                            centerX,
                            baseHeight + sidewalkHeight + 0.3 + tier * 0.7,
                            centerZ + buildable * 0.1 + tier * buildable * 0.12
                        );
                        group.add(seats);
                    }

                    // Stage lights
                    for (let i = 0; i < 3; i++) {
                        const light = new THREE.Mesh(
                            new THREE.CylinderGeometry(0.4, 0.4, 1, 8),
                            new THREE.MeshBasicMaterial({ color: 0xffffaa })
                        );
                        light.position.set(
                            centerX + (i - 1) * buildable * 0.15,
                            baseHeight + sidewalkHeight + 4,
                            centerZ - buildable * 0.3
                        );
                        light.rotation.x = Math.PI / 4;
                        group.add(light);
                    }
                } else if (blockRoll < 0.40) {
                    // Parking lot
                    const parking = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable, 0.2, buildable),
                        new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
                    );
                    parking.position.set(centerX, baseHeight + sidewalkHeight + 0.1, centerZ);
                    group.add(parking);

                    // Parking lines
                    for (let i = 0; i < 8; i++) {
                        const line = new THREE.Mesh(
                            new THREE.BoxGeometry(buildable * 0.9, 0.05, 0.3),
                            new THREE.MeshLambertMaterial({ color: 0xeeee00 })
                        );
                        line.position.set(
                            centerX,
                            baseHeight + sidewalkHeight + 0.21,
                            centerZ - buildable * 0.4 + i * (buildable * 0.1)
                        );
                        group.add(line);
                    }

                    // Parked vehicles
                    for (let i = 0; i < 6; i++) {
                        if (blockRandom(200 + i) > 0.3) {
                            const car = new THREE.Mesh(
                                new THREE.BoxGeometry(4, 2.5, 7),
                                new THREE.MeshLambertMaterial({
                                    color: [0x3344aa, 0xaa3344, 0x44aa33, 0xaaaaaa, 0x2a2a2a][Math.floor(blockRandom(210 + i) * 5)]
                                })
                            );
                            car.position.set(
                                centerX + (i % 2 === 0 ? -buildable * 0.2 : buildable * 0.2),
                                baseHeight + sidewalkHeight + 1.5,
                                centerZ - buildable * 0.35 + Math.floor(i / 2) * (buildable * 0.15)
                            );
                            group.add(car);
                            colliders.push(new THREE.Box3().setFromCenterAndSize(
                                car.position.clone(),
                                new THREE.Vector3(4, 2.5, 7)
                            ));
                        }
                    }
                } else if (blockRoll < 0.48) {
                    // Sculpture plaza
                    const plaza = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable, 0.4, buildable),
                        new THREE.MeshLambertMaterial({ color: 0x2f363f })
                    );
                    plaza.position.set(centerX, baseHeight + sidewalkHeight, centerZ);
                    group.add(plaza);

                    for (let i = 0; i < 3; i++) {
                        const sculpture = new THREE.Mesh(
                            new THREE.DodecahedronGeometry(4 + blockRandom(i + 30) * 2),
                            new THREE.MeshStandardMaterial({ color: 0x7aa0ff, metalness: 0.6, roughness: 0.35 })
                        );
                        sculpture.position.set(
                            plaza.position.x + (blockRandom(i + 40) - 0.5) * (buildable * 0.55),
                            baseHeight + sidewalkHeight + 2.5,
                            plaza.position.z + (blockRandom(i + 50) - 0.5) * (buildable * 0.55)
                        );
                        group.add(sculpture);
                        colliders.push(new THREE.Box3().setFromCenterAndSize(
                            sculpture.position.clone(),
                            new THREE.Vector3(6, 6, 6)
                        ));
                    }

                    const fountain = new THREE.Mesh(
                        new THREE.CylinderGeometry(6, 6, 1.2, 16),
                        new THREE.MeshStandardMaterial({ color: 0x3a5266, metalness: 0.3, roughness: 0.4 })
                    );
                    fountain.position.set(centerX, baseHeight + sidewalkHeight + 0.6, centerZ);
                    group.add(fountain);
                } else if (blockRoll < 0.56) {
                    // Market square
                    const plaza = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable, 0.3, buildable),
                        new THREE.MeshLambertMaterial({ color: 0x2d2d32 })
                    );
                    plaza.position.set(centerX, baseHeight + sidewalkHeight, centerZ);
                    group.add(plaza);

                    const stallCount = 6;
                    for (let i = 0; i < stallCount; i++) {
                        const angle = (Math.PI * 2 / stallCount) * i;
                        const radius = buildable * 0.32;
                        const sx = centerX + Math.cos(angle) * radius;
                        const sz = centerZ + Math.sin(angle) * radius;
                        const stall = new THREE.Mesh(
                            new THREE.BoxGeometry(8, 5, 6),
                            new THREE.MeshLambertMaterial({ color: 0x30393f })
                        );
                        stall.position.set(sx, baseHeight + sidewalkHeight + 2.5, sz);
                        group.add(stall);
                        colliders.push(new THREE.Box3().setFromCenterAndSize(
                            stall.position.clone(),
                            new THREE.Vector3(8, 5, 6)
                        ));

                        const canopy = new THREE.Mesh(
                            new THREE.BoxGeometry(8.5, 1.2, 6.5),
                            new THREE.MeshLambertMaterial({ color: 0x446688 })
                        );
                        canopy.position.set(0, 3.4, 0);
                        stall.add(canopy);
                    }

                    const infoTower = new THREE.Mesh(
                        new THREE.CylinderGeometry(2.5, 2.5, 14, 8),
                        new THREE.MeshStandardMaterial({ color: 0x556677, metalness: 0.5, roughness: 0.25 })
                    );
                    infoTower.position.set(centerX, baseHeight + sidewalkHeight + 7, centerZ);
                    group.add(infoTower);
                    colliders.push(new THREE.Box3().setFromCenterAndSize(
                        infoTower.position.clone(),
                        new THREE.Vector3(5, 14, 5)
                    ));
                } else if (blockRoll < 0.62) {
                    // Subway/Metro entrance
                    const subwayBase = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable * 0.6, 0.3, buildable * 0.6),
                        new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
                    );
                    subwayBase.position.set(centerX, baseHeight + sidewalkHeight + 0.15, centerZ);
                    group.add(subwayBase);

                    // Entrance structure
                    const entrance = new THREE.Mesh(
                        new THREE.BoxGeometry(12, 8, 12),
                        new THREE.MeshLambertMaterial({ color: 0x2a3a4a })
                    );
                    entrance.position.set(centerX, baseHeight + sidewalkHeight + 4, centerZ);
                    group.add(entrance);
                    colliders.push(new THREE.Box3().setFromCenterAndSize(
                        entrance.position.clone(),
                        new THREE.Vector3(12, 8, 12)
                    ));

                    // Glass canopy
                    const canopy = new THREE.Mesh(
                        new THREE.BoxGeometry(15, 0.4, 15),
                        new THREE.MeshStandardMaterial({ color: 0x4488aa, transparent: true, opacity: 0.6, metalness: 0.8 })
                    );
                    canopy.position.set(0, 5, 0);
                    entrance.add(canopy);

                    // Stairs down
                    for (let i = 0; i < 3; i++) {
                        const step = new THREE.Mesh(
                            new THREE.BoxGeometry(10, 0.4, 3),
                            new THREE.MeshLambertMaterial({ color: 0x4a4a4a })
                        );
                        step.position.set(centerX, baseHeight + sidewalkHeight - i * 0.5, centerZ - 6 - i * 2);
                        group.add(step);
                    }

                    // Metro sign
                    const sign = new THREE.Mesh(
                        new THREE.BoxGeometry(8, 3, 0.5),
                        new THREE.MeshBasicMaterial({ color: 0xff6600 })
                    );
                    sign.position.set(0, 4, 6.5);
                    entrance.add(sign);

                    const signText = new THREE.Mesh(
                        new THREE.BoxGeometry(6, 1.5, 0.3),
                        new THREE.MeshBasicMaterial({ color: 0xffffff })
                    );
                    signText.position.set(0, 0, 0.3);
                    sign.add(signText);
                } else if (blockRoll < 0.65) {
                    // Memorial / monument plaza
                    const plaza = new THREE.Mesh(
                        new THREE.BoxGeometry(buildable, 0.3, buildable),
                        new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
                    );
                    plaza.position.set(centerX, baseHeight + sidewalkHeight + 0.15, centerZ);
                    group.add(plaza);

                    // Central monument
                    const monument = new THREE.Mesh(
                        new THREE.CylinderGeometry(4, 5, 20, 8),
                        new THREE.MeshStandardMaterial({ color: 0x7a7a8a, metalness: 0.4, roughness: 0.3 })
                    );
                    monument.position.set(centerX, baseHeight + sidewalkHeight + 10, centerZ);
                    group.add(monument);
                    colliders.push(new THREE.Box3().setFromCenterAndSize(
                        monument.position.clone(),
                        new THREE.Vector3(10, 20, 10)
                    ));

                    // Monument top
                    const top = new THREE.Mesh(
                        new THREE.ConeGeometry(5, 8, 8),
                        new THREE.MeshStandardMaterial({ color: 0x8a8a9a, metalness: 0.5, roughness: 0.2 })
                    );
                    top.position.set(0, 14, 0);
                    monument.add(top);

                    // Surrounding plaques
                    for (let i = 0; i < 4; i++) {
                        const plaque = new THREE.Mesh(
                            new THREE.BoxGeometry(6, 4, 0.5),
                            new THREE.MeshLambertMaterial({ color: 0x4a4a5a })
                        );
                        plaque.position.set(
                            centerX + Math.cos(i * Math.PI / 2) * buildable * 0.3,
                            baseHeight + sidewalkHeight + 2,
                            centerZ + Math.sin(i * Math.PI / 2) * buildable * 0.3
                        );
                        plaque.rotation.y = i * Math.PI / 2;
                        group.add(plaque);
                    }
                } else {
                    // Buildings - height varies by urban biome type
                    const towerCount = isMegacity ? 1 + Math.floor(blockRandom(60) * 3) :
                                       isVillage ? 1 : 1 + Math.floor(blockRandom(60) * 2);
                    for (let i = 0; i < towerCount; i++) {
                        const footprint = buildable * (towerCount === 1 ? 1 : 0.55);
                        // Use biome-specific building heights
                        const heightRange = buildingMaxHeight - buildingMinHeight;
                        const h = buildingMinHeight + Math.abs(hash(gx * 0.75 + i, gz * 0.5 - i)) * heightRange;
                        const mat = new THREE.MeshLambertMaterial({
                            map: createTexture('concrete', '#3c3c3c')
                        });
                        const building = new THREE.Mesh(
                            new THREE.BoxGeometry(footprint, h, footprint),
                            mat
                        );

                        const offset = (towerCount === 1) ? 0 : (i === 0 ? -buildable * 0.22 : buildable * 0.22);
                        building.position.set(centerX + offset, baseHeight + sidewalkHeight + h / 2, centerZ + offset);
                        building.castShadow = true;
                        group.add(building);

                        const buildingCollider = this.meshCollider(building, 0.02);
                        if (buildingCollider) colliders.push(buildingCollider);

                        const doorMat = new THREE.MeshLambertMaterial({
                            map: createTexture('door', '#555')
                        });
                        const door = new THREE.Mesh(
                            new THREE.PlaneGeometry(8, 12),
                            doorMat
                        );
                        door.position.set(0, -h / 2 + 8, -footprint / 2 - 0.5);
                        door.rotation.y = Math.PI;
                        door.userData = { type: 'door', seed: cx * 1000 + cz * 100 + gx + gz + i };
                        building.add(door);

                        // Rooftop features - varied types
                        const roofType = blockRandom(70 + i);
                        if (roofType < 0.3) {
                            // Standard rooftop structure
                            const rooftop = new THREE.Mesh(
                                new THREE.BoxGeometry(footprint * 0.6, 6, footprint * 0.6),
                                new THREE.MeshLambertMaterial({ color: 0x2a2d32 })
                            );
                            rooftop.position.set(0, h / 2 - 3, 0);
                            building.add(rooftop);
                        } else if (roofType < 0.5) {
                            // Antenna array
                            for (let a = 0; a < 3; a++) {
                                const antenna = new THREE.Mesh(
                                    new THREE.CylinderGeometry(0.3, 0.4, 15, 6),
                                    new THREE.MeshLambertMaterial({ color: 0xff3333 })
                                );
                                antenna.position.set(
                                    (a - 1) * footprint * 0.2,
                                    h / 2 + 7.5,
                                    0
                                );
                                building.add(antenna);

                                // Red light on top
                                const light = new THREE.Mesh(
                                    new THREE.SphereGeometry(0.5, 8, 8),
                                    new THREE.MeshBasicMaterial({ color: 0xff0000 })
                                );
                                light.position.set(0, 7.5, 0);
                                antenna.add(light);
                            }
                        } else if (roofType < 0.7) {
                            // AC units and utilities
                            for (let u = 0; u < 4; u++) {
                                const acUnit = new THREE.Mesh(
                                    new THREE.BoxGeometry(4, 2, 3),
                                    new THREE.MeshLambertMaterial({ color: 0x4a4a4a })
                                );
                                acUnit.position.set(
                                    (u % 2 === 0 ? -1 : 1) * footprint * 0.25,
                                    h / 2 + 1,
                                    (u < 2 ? -1 : 1) * footprint * 0.25
                                );
                                building.add(acUnit);
                            }
                        } else {
                            // Helipad
                            const helipad = new THREE.Mesh(
                                new THREE.CylinderGeometry(footprint * 0.4, footprint * 0.4, 1, 16),
                                new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
                            );
                            helipad.position.set(0, h / 2 + 0.5, 0);
                            building.add(helipad);

                            // Helipad markings
                            const marking = new THREE.Mesh(
                                new THREE.CylinderGeometry(footprint * 0.35, footprint * 0.35, 0.2, 16),
                                new THREE.MeshBasicMaterial({ color: 0xffff00 })
                            );
                            marking.position.set(0, 0.6, 0);
                            helipad.add(marking);

                            // H marking
                            const hMark = new THREE.Mesh(
                                new THREE.BoxGeometry(footprint * 0.2, 0.1, footprint * 0.05),
                                new THREE.MeshBasicMaterial({ color: 0xffffff })
                            );
                            hMark.position.set(0, 0.7, 0);
                            helipad.add(hMark);
                        }
                    }
                }

                // Street lamp
                const lamp = new THREE.Group();
                const pole = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.4, 0.6, 16),
                    new THREE.MeshLambertMaterial({ color: 0x101010 })
                );
                pole.position.y = 8;
                lamp.add(pole);

                const bulb = new THREE.Mesh(
                    new THREE.BoxGeometry(3.5, 1.2, 2.5),
                    new THREE.MeshBasicMaterial({ color: 0xffeeaa })
                );
                bulb.position.set(1.5, 16.2, 0);
                lamp.add(bulb);
                lamp.position.set(centerX + buildable / 2 + 2, baseHeight + sidewalkHeight / 2, centerZ + buildable / 2 + 2);
                group.add(lamp);

                // Add street furniture with some randomization
                const furnitureRoll = blockRandom(100);

                // Traffic light at intersection (15% chance)
                if (furnitureRoll < 0.15) {
                    const trafficLight = new THREE.Group();
                    const tlPole = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.3, 0.35, 10),
                        new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
                    );
                    tlPole.position.y = 5;
                    trafficLight.add(tlPole);

                    const signalBox = new THREE.Mesh(
                        new THREE.BoxGeometry(1.5, 4, 1),
                        new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
                    );
                    signalBox.position.y = 10;
                    trafficLight.add(signalBox);

                    const redLight = new THREE.Mesh(
                        new THREE.SphereGeometry(0.4, 8, 8),
                        new THREE.MeshBasicMaterial({ color: 0xff0000 })
                    );
                    redLight.position.set(0, 11, 0.6);
                    trafficLight.add(redLight);

                    trafficLight.position.set(
                        centerX + buildable / 2 + 6,
                        baseHeight + sidewalkHeight,
                        centerZ + buildable / 2 + 6
                    );
                    group.add(trafficLight);
                    colliders.push(new THREE.Box3().setFromCenterAndSize(
                        new THREE.Vector3(trafficLight.position.x, baseHeight + sidewalkHeight + 5, trafficLight.position.z),
                        new THREE.Vector3(0.7, 10, 0.7)
                    ));
                }

                // Street vendor kiosk (12% chance)
                else if (furnitureRoll < 0.27) {
                    const kiosk = new THREE.Mesh(
                        new THREE.BoxGeometry(5, 6, 4),
                        new THREE.MeshLambertMaterial({ color: 0x3a5a7a })
                    );
                    kiosk.position.set(
                        centerX - buildable / 2 + 3,
                        baseHeight + sidewalkHeight + 3,
                        centerZ - buildable / 2 + 2
                    );
                    group.add(kiosk);
                    colliders.push(new THREE.Box3().setFromCenterAndSize(
                        kiosk.position.clone(),
                        new THREE.Vector3(5, 6, 4)
                    ));

                    const awning = new THREE.Mesh(
                        new THREE.BoxGeometry(5.5, 0.3, 5),
                        new THREE.MeshLambertMaterial({ color: 0xff6600 })
                    );
                    awning.position.set(0, 3.5, 0.5);
                    kiosk.add(awning);
                }

                // Billboard (10% chance)
                else if (furnitureRoll < 0.37) {
                    const billboardPole = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.5, 0.6, 18),
                        new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
                    );
                    billboardPole.position.set(
                        centerX + buildable / 2 - 2,
                        baseHeight + sidewalkHeight + 9,
                        centerZ - buildable / 2 + 2
                    );
                    group.add(billboardPole);

                    const billboard = new THREE.Mesh(
                        new THREE.BoxGeometry(12, 8, 0.5),
                        new THREE.MeshLambertMaterial({ color: 0x4a7a9a })
                    );
                    billboard.position.set(0, 9, 0);
                    billboardPole.add(billboard);
                }

                // Trash can and fire hydrant (always spawn)
                const trashCan = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.8, 0.9, 2.5, 8),
                    new THREE.MeshLambertMaterial({ color: 0x2a4a2a })
                );
                trashCan.position.set(
                    centerX - buildable / 2 + 1.5,
                    baseHeight + sidewalkHeight + 1.25,
                    centerZ + buildable / 2 - 1.5
                );
                group.add(trashCan);
                const trashCollider = this.meshCollider(trashCan, 0.01);
                if (trashCollider) colliders.push(trashCollider);

                const hydrant = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.6, 0.7, 2, 6),
                    new THREE.MeshLambertMaterial({ color: 0xcc3333 })
                );
                hydrant.position.set(
                    centerX + buildable / 2 - 1.5,
                    baseHeight + sidewalkHeight + 1,
                    centerZ - buildable / 2 + 1.5
                );
                group.add(hydrant);
                const hydrantCollider = this.meshCollider(hydrant, 0.01);
                if (hydrantCollider) colliders.push(hydrantCollider);
            }
        }

        // Generate roads - positioned flush with terrain
        // Generate vertical roads (along Z axis)
        for (let x = -roadWidth; x <= CONFIG.chunkSize + roadWidth; x += blockSize) {
            const roadCenterX = ox + x + roadWidth / 2;
            const roadCenterZ = oz + CONFIG.chunkSize / 2;

            // Only generate road if it's in a city area
            const roadInfluence = getCityInfluence(roadCenterX, roadCenterZ);
            if (roadInfluence >= CONFIG.cityInfluenceThreshold * 0.9) {
                // Create main road surface - positioned flush with base terrain
                const roadGeo = new THREE.PlaneGeometry(roadWidth, CONFIG.chunkSize + blockSize);
                const roadMat = new THREE.MeshLambertMaterial({
                    map: createTexture('asphalt', '#0a0a0a'),
                    side: THREE.FrontSide
                });
                const road = new THREE.Mesh(roadGeo, roadMat);
                road.rotation.x = -Math.PI / 2;
                road.position.set(roadCenterX, baseHeight + 0.005, roadCenterZ);
                road.receiveShadow = true;
                group.add(road);

                const roadCollider = this.meshCollider(road, 0.01);
                if (roadCollider) colliders.push(roadCollider);

                // Add center lane marking
                const centerLine = new THREE.Mesh(
                    new THREE.PlaneGeometry(0.3, CONFIG.chunkSize + blockSize),
                    new THREE.MeshBasicMaterial({ color: 0xffff00 })
                );
                centerLine.rotation.x = -Math.PI / 2;
                centerLine.position.set(roadCenterX, baseHeight + 0.01, roadCenterZ);
                group.add(centerLine);

                // Add edge lines
                const edgeLine1 = new THREE.Mesh(
                    new THREE.PlaneGeometry(0.2, CONFIG.chunkSize + blockSize),
                    new THREE.MeshBasicMaterial({ color: 0xffffff })
                );
                edgeLine1.rotation.x = -Math.PI / 2;
                edgeLine1.position.set(roadCenterX - roadWidth / 2 + 0.5, baseHeight + 0.01, roadCenterZ);
                group.add(edgeLine1);

                const edgeLine2 = new THREE.Mesh(
                    new THREE.PlaneGeometry(0.2, CONFIG.chunkSize + blockSize),
                    new THREE.MeshBasicMaterial({ color: 0xffffff })
                );
                edgeLine2.rotation.x = -Math.PI / 2;
                edgeLine2.position.set(roadCenterX + roadWidth / 2 - 0.5, baseHeight + 0.01, roadCenterZ);
                group.add(edgeLine2);
            }
        }

        // Generate horizontal roads (along X axis)
        for (let z = -roadWidth; z <= CONFIG.chunkSize + roadWidth; z += blockSize) {
            const roadCenterX = ox + CONFIG.chunkSize / 2;
            const roadCenterZ = oz + z + roadWidth / 2;

            // Only generate road if it's in a city area
            const roadInfluence = getCityInfluence(roadCenterX, roadCenterZ);
            if (roadInfluence >= CONFIG.cityInfluenceThreshold * 0.9) {
                // Create main road surface - positioned flush with base terrain
                const roadGeo = new THREE.PlaneGeometry(CONFIG.chunkSize + blockSize, roadWidth);
                const roadMat = new THREE.MeshLambertMaterial({
                    map: createTexture('asphalt', '#0a0a0a'),
                    side: THREE.FrontSide
                });
                const road = new THREE.Mesh(roadGeo, roadMat);
                road.rotation.x = -Math.PI / 2;
                road.position.set(roadCenterX, baseHeight + 0.005, roadCenterZ);
                road.receiveShadow = true;
                group.add(road);

                const roadCollider = this.meshCollider(road, 0.01);
                if (roadCollider) colliders.push(roadCollider);

                // Add center lane marking
                const centerLine = new THREE.Mesh(
                    new THREE.PlaneGeometry(CONFIG.chunkSize + blockSize, 0.3),
                    new THREE.MeshBasicMaterial({ color: 0xffff00 })
                );
                centerLine.rotation.x = -Math.PI / 2;
                centerLine.position.set(roadCenterX, baseHeight + 0.01, roadCenterZ);
                group.add(centerLine);

                // Add edge lines
                const edgeLine1 = new THREE.Mesh(
                    new THREE.PlaneGeometry(CONFIG.chunkSize + blockSize, 0.2),
                    new THREE.MeshBasicMaterial({ color: 0xffffff })
                );
                edgeLine1.rotation.x = -Math.PI / 2;
                edgeLine1.position.set(roadCenterX, baseHeight + 0.01, roadCenterZ - roadWidth / 2 + 0.5);
                group.add(edgeLine1);

                const edgeLine2 = new THREE.Mesh(
                    new THREE.PlaneGeometry(CONFIG.chunkSize + blockSize, 0.2),
                    new THREE.MeshBasicMaterial({ color: 0xffffff })
                );
                edgeLine2.rotation.x = -Math.PI / 2;
                edgeLine2.position.set(roadCenterX, baseHeight + 0.01, roadCenterZ + roadWidth / 2 - 0.5);
                group.add(edgeLine2);
            }
        }

        // Use seeded random for deterministic NPC spawning (same NPCs on all clients)
        const npcSeed = cx * 10000 + cz * 100;
        const npcRandom = (offset) => seededRandom(npcSeed + offset);

        if (npcRandom(0) > 0.45) {
            const npc = new Character(false);
            // Use seeded colors so all clients see the same NPCs
            const hairHue = Math.floor(npcRandom(1) * 16777215);
            const jacketHue = Math.floor(npcRandom(2) * 8388607);
            npc.params.hairColor = '#' + hairHue.toString(16).padStart(6, '0');
            npc.params.jacketColor = '#' + jacketHue.toString(16).padStart(6, '0');
            npc.rebuild();
            npc.group.position.set(
                ox + CONFIG.chunkSize / 2 + (npcRandom(3) - 0.5) * 40,
                baseHeight + sidewalkHeight,
                oz + CONFIG.chunkSize / 2 + (npcRandom(4) - 0.5) * 40
            );
            group.add(npc.group);
            this.npcs.push(npc);
        }
    }

    generateWilderness(group, ox, oz, cx, cz, biome, colliders) {
        const seed = cx * 10000 + cz;

        const treeCount = 6 + Math.floor(seededRandom(seed) * 12);
        for (let i = 0; i < treeCount; i++) {
            const tx = ox + seededRandom(seed + i * 3) * CONFIG.chunkSize;
            const tz = oz + seededRandom(seed + i * 3 + 1) * CONFIG.chunkSize;
            const ty = getTerrainHeight(tx, tz);

            const tree = new THREE.Group();
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.5, 4, 6),
                new THREE.MeshLambertMaterial({ color: 0x4a3020 })
            );
            trunk.position.y = 2;
            tree.add(trunk);

            const leaves = new THREE.Mesh(
                new THREE.ConeGeometry(2.5, 5, 6),
                new THREE.MeshLambertMaterial({ color: 0x2a5a2a })
            );
            leaves.position.y = 6;
            tree.add(leaves);

            tree.position.set(tx, ty, tz);
            group.add(tree);
            colliders.push(new THREE.Box3().setFromCenterAndSize(
                new THREE.Vector3(tx, ty + 2, tz),
                new THREE.Vector3(1.2, 4, 1.2)
            ));
        }

        const rockCount = 3 + Math.floor(seededRandom(seed + 100) * 5);
        for (let i = 0; i < rockCount; i++) {
            const rx = ox + seededRandom(seed + i * 5 + 200) * CONFIG.chunkSize;
            const rz = oz + seededRandom(seed + i * 5 + 201) * CONFIG.chunkSize;
            const ry = getTerrainHeight(rx, rz);

            const rock = new THREE.Mesh(
                new THREE.DodecahedronGeometry(0.8 + Math.random() * 0.5, 0),
                new THREE.MeshLambertMaterial({ color: 0x666666 })
            );
            rock.position.set(rx, ry + 0.4, rz);
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            group.add(rock);
            colliders.push(new THREE.Box3().setFromCenterAndSize(
                rock.position.clone(),
                new THREE.Vector3(1.2, 1.2, 1.2)
            ));
        }

        const biomeColor = new THREE.Color(biome.primaryColor);
        const shardCount = 4 + Math.floor(seededRandom(seed + 2000) * 6);
        for (let i = 0; i < shardCount; i++) {
            const px = ox + seededRandom(seed + i * 11 + 3000) * CONFIG.chunkSize;
            const pz = oz + seededRandom(seed + i * 11 + 3001) * CONFIG.chunkSize;
            const py = getTerrainHeight(px, pz);
            const shard = new THREE.Mesh(
                new THREE.ConeGeometry(1, 4 + seededRandom(seed + i) * 6, 5),
                new THREE.MeshStandardMaterial({ color: biomeColor.offsetHSL(0.1, 0.2, 0), metalness: 0.35 })
            );
            shard.position.set(px, py + 1, pz);
            shard.rotation.y = Math.random() * Math.PI;
            group.add(shard);
        }
    }

    addSkirt(geometry) {
        const skirtDepth = 20;
        const widthSegments = geometry.parameters.widthSegments;
        const heightSegments = geometry.parameters.heightSegments;

        const basePositions = geometry.attributes.position.array;
        const baseIndices = geometry.index.array;

        const positions = Array.from(basePositions);
        const indices = Array.from(baseIndices);

        const vertexCount = basePositions.length / 3;
        let nextIndex = vertexCount;

        const appendVertex = (idx) => {
            const i = idx * 3;
            const x = basePositions[i];
            const y = basePositions[i + 1];
            const z = basePositions[i + 2] - skirtDepth;
            positions.push(x, y, z);
            return nextIndex++;
        };

        const stitchEdge = (getIndexForSegment) => {
            for (let i = 0; i < getIndexForSegment.count; i++) {
                const topA = getIndexForSegment.from(i);
                const topB = getIndexForSegment.to(i);
                const bottomA = appendVertex(topA);
                const bottomB = appendVertex(topB);

                indices.push(topA, topB, bottomB);
                indices.push(topA, bottomB, bottomA);
            }
        };

        stitchEdge({
            count: widthSegments,
            from: (i) => i,
            to:   (i) => i + 1
        });

        stitchEdge({
            count: widthSegments,
            from: (i) => (heightSegments * (widthSegments + 1)) + i,
            to:   (i) => (heightSegments * (widthSegments + 1)) + i + 1
        });

        stitchEdge({
            count: heightSegments,
            from: (i) => (i * (widthSegments + 1)),
            to:   (i) => ((i + 1) * (widthSegments + 1))
        });

        stitchEdge({
            count: heightSegments,
            from: (i) => (i * (widthSegments + 1)) + widthSegments,
            to:   (i) => ((i + 1) * (widthSegments + 1)) + widthSegments
        });

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    createInterior(x, y, z, seed) {
        const key = `int_${seed}`;
        if (this.interiors[key]) return;

        const group = new THREE.Group();
        group.position.set(x, y, z);

        const w = 40, h = 15, d = 40;

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(w, d),
            new THREE.MeshLambertMaterial({ map: createTexture('checkers', '#444') })
        );
        floor.rotation.x = -Math.PI / 2;
        group.add(floor);

        const ceiling = new THREE.Mesh(
            new THREE.PlaneGeometry(w, d),
            new THREE.MeshLambertMaterial({ color: 0x111111 })
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = h;
        group.add(ceiling);

        const wallMat = new THREE.MeshLambertMaterial({ color: 0x444455, side: THREE.DoubleSide });
        const walls = [
            { pos: [0, h / 2, -d / 2], dim: [w, h, 1] },
            { pos: [0, h / 2, d / 2], dim: [w, h, 1] },
            { pos: [-w / 2, h / 2, 0], dim: [1, h, d] },
            { pos: [w / 2, h / 2, 0], dim: [1, h, d] }
        ];
        walls.forEach(cfg => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...cfg.dim), wallMat);
            mesh.position.set(...cfg.pos);
            group.add(mesh);
        });

        const exitDoor = new THREE.Mesh(
            new THREE.BoxGeometry(4, 8, 1),
            new THREE.MeshLambertMaterial({ color: 0xff0000 })
        );
        exitDoor.position.set(0, 4, d / 2 - 2);
        exitDoor.userData = { type: 'exit' };
        group.add(exitDoor);

        const light = new THREE.PointLight(0xffaa00, 1, 40);
        light.position.set(0, h - 2, 0);
        group.add(light);

        const colliders = [];
        const chunkKey = `${Math.floor(x / CONFIG.chunkSize)},${Math.floor(z / CONFIG.chunkSize)}`;

        colliders.push(new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(x, y - 0.25, z),
            new THREE.Vector3(w, 0.5, d)
        ));

        colliders.push(new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(x, y + h + 0.25, z),
            new THREE.Vector3(w, 0.5, d)
        ));

        walls.forEach(cfg => {
            const worldPos = new THREE.Vector3(cfg.pos[0] + x, cfg.pos[1] + y, cfg.pos[2] + z);
            const size = new THREE.Vector3(cfg.dim[0], cfg.dim[1], cfg.dim[2]);
            colliders.push(new THREE.Box3().setFromCenterAndSize(worldPos, size));
        });

        this.physics.addChunkColliders(chunkKey, colliders);
        this.physics.addChunkGroup(chunkKey, group);

        this.scene.add(group);
        this.interiors[key] = group;
    }

    generateAreaName(cx, cz, isCity) {
        const descriptors = ['Neon', 'Silent', 'Chrome', 'Iron', 'Luminous', 'Amber', 'Eclipse', 'Vanta', 'Nova', 'Gilded'];
        const locales = ['Crossing', 'Sprawl', 'Relay', 'Harbor', 'Approach', 'Run', 'Exchange', 'Parallax', 'Arc', 'Front'];
        const sanctuaries = ['Ward', 'Promenade', 'Quarter', 'Commons', 'Anchor', 'Breach', 'Circuit', 'Bastion', 'Ridge', 'Trace'];

        const seedA = Math.floor(Math.abs(hash(cx * 7.13, cz * 9.97)) * descriptors.length);
        const seedB = Math.floor(Math.abs(hash(cx * 5.71, cz * 11.31)) * locales.length);
        const seedC = Math.floor(Math.abs(hash(cx * 13.37, cz * 3.17)) * sanctuaries.length);

        const first = descriptors[seedA % descriptors.length];
        const second = isCity ? locales[seedB % locales.length] : sanctuaries[seedC % sanctuaries.length];
        return `${first} ${second}`;
    }

    updateLocationHUD(pos, cx, cz) {
        const centerX = cx * CONFIG.chunkSize + CONFIG.chunkSize / 2;
        const centerZ = cz * CONFIG.chunkSize + CONFIG.chunkSize / 2;
        const isCity = getCityInfluence(centerX, centerZ) >= CONFIG.cityInfluenceThreshold;
        const biome = biomeInfoAtPosition(centerX, centerZ);

        const areaName = this.generateAreaName(cx, cz, isCity);

        const blockLetter = String.fromCharCode(65 + Math.abs(cx % 26));
        const blockNum = Math.abs(cz % 100);

        document.getElementById('hud-location').textContent = areaName;
        document.getElementById('hud-coords').textContent = `Block ${blockLetter}-${blockNum} · ${biome.label}`;
    }
}
