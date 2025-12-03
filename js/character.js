import { createTexture } from './textures.js';
import { getTerrainHeight } from './terrain.js';

// ============================================
// CHARACTER CLASS
// ============================================
export class Character {
    constructor(isPlayer = false) {
        this.group = new THREE.Group();
        this.meshGroup = new THREE.Group();
        this.group.add(this.meshGroup);
        
        this.isPlayer = isPlayer;
        this.params = {
            gender: 'female',
            height: 1.0,
            skin: '#ffe0bd',
            hair: 2,
            hairColor: '#aa0000',
            jacketColor: '#111111',
            shirtColor: '#990000',
            pantsColor: '#223355'
        };
        
        this.limbs = {};
        this.aiState = 'idle';
        this.aiTimer = 0;
        this.targetPos = new THREE.Vector3();
        
        this.rebuild();
    }

    rebuild() {
        while (this.meshGroup.children.length > 0) {
            this.meshGroup.remove(this.meshGroup.children[0]);
        }

        const { gender, height, skin, jacketColor, pantsColor, shirtColor } = this.params;
        const isFemale = gender === 'female';
        
        // Materials
        const tSkin = new THREE.MeshLambertMaterial({ color: skin });
        const tFace = new THREE.MeshLambertMaterial({ map: createTexture('face', skin) });
        const tJeans = new THREE.MeshLambertMaterial({ map: createTexture('denim', pantsColor) });
        const tJacket = new THREE.MeshLambertMaterial({ map: createTexture('leather', jacketColor) });
        const tJacketBack = new THREE.MeshLambertMaterial({ map: createTexture('jacket_back', jacketColor) });
        const tShirt = new THREE.MeshLambertMaterial({ color: shirtColor });
        const tHair = new THREE.MeshLambertMaterial({ color: this.params.hairColor });
        const tBoots = new THREE.MeshLambertMaterial({ color: 0x111111 });
        const tHolster = new THREE.MeshLambertMaterial({ color: 0x050505 });

        const s = height;
        
        // Gender-specific proportions
        const hipWidth = isFemale ? 0.40 : 0.36;
        const waistWidth = isFemale ? 0.28 : 0.34;
        const shoulderWidth = isFemale ? 0.34 : 0.40;

        // Hips - MODEL FACES +Z (forward)
        const hips = new THREE.Mesh(new THREE.BoxGeometry(hipWidth, 0.22, 0.26), tJeans);
        hips.position.y = 0.9 * s;
        this.meshGroup.add(hips);
        this.limbs.hips = hips;

        // Midriff (narrower for female = hourglass)
        const midriff = new THREE.Mesh(new THREE.BoxGeometry(waistWidth, 0.12, 0.20), tSkin);
        midriff.position.y = 0.17;
        hips.add(midriff);

        // Chest Group
        const chestGroup = new THREE.Group();
        chestGroup.position.y = 0.12;
        midriff.add(chestGroup);

        // Torso/Shirt
        const torsoWidth = isFemale ? 0.34 : shoulderWidth;
        const shirt = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth, 0.35, 0.22), tShirt);
        shirt.position.y = 0.1;
        chestGroup.add(shirt);

        // Female chest detail - box-based, not spheres
        if (isFemale) {
            const chestDetail = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.14, 0.08),
                tShirt
            );
            chestDetail.position.set(0, 0.08, -0.12);
            chestGroup.add(chestDetail);
            
            // Subtle shaping
            const chestLeft = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.12, 0.06),
                tShirt
            );
            chestLeft.position.set(-0.07, 0.06, -0.14);
            chestGroup.add(chestLeft);
            
            const chestRight = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.12, 0.06),
                tShirt
            );
            chestRight.position.set(0.07, 0.06, -0.14);
            chestGroup.add(chestRight);
        }

        // Jacket Back (on +Z side, the back)
        const jacketBack = new THREE.Mesh(new THREE.BoxGeometry(shoulderWidth + 0.04, 0.38, 0.05), tJacketBack);
        jacketBack.position.set(0, 0.1, 0.12);
        chestGroup.add(jacketBack);

        // Jacket Sides
        const jacketL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.28), tJacket);
        jacketL.position.set(shoulderWidth * 0.5 + 0.02, 0.1, 0);
        chestGroup.add(jacketL);
        
        const jacketR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.28), tJacket);
        jacketR.position.set(-shoulderWidth * 0.5 - 0.02, 0.1, 0);
        chestGroup.add(jacketR);

        // Collar
        const collar = new THREE.Mesh(new THREE.BoxGeometry(shoulderWidth + 0.08, 0.08, 0.26), tJacket);
        collar.position.set(0, 0.3, 0.05);
        chestGroup.add(collar);

        // Head - Face on -Z side (front)
        // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
        // Index 4 = +Z (back), Index 5 = -Z (front/face)
        const headMats = [tSkin, tSkin, tSkin, tSkin, tSkin, tFace];
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.24), headMats);
        head.position.y = 0.45;
        chestGroup.add(head);

        // Hair
        if (this.params.hair > 0) {
            const hairGroup = new THREE.Group();
            head.add(hairGroup);

            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.26), tHair);
            cap.position.y = 0.15;
            hairGroup.add(cap);

            if (this.params.hair == 1) { // Spiky
                for (let i = 0; i < 5; i++) {
                    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.15, 4), tHair);
                    spike.position.set((i - 2) * 0.06, 0.22, 0);
                    spike.rotation.z = (i - 2) * 0.2;
                    hairGroup.add(spike);
                }
            }
            if (this.params.hair == 2) { // Anime Bob
                // Back hair (+Z)
                const back = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.45, 0.08), tHair);
                back.position.set(0, -0.1, 0.13);
                hairGroup.add(back);
                // Sides
                const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.2), tHair);
                sideL.position.set(0.14, -0.1, 0.02);
                hairGroup.add(sideL);
                const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.2), tHair);
                sideR.position.set(-0.14, -0.1, 0.02);
                hairGroup.add(sideR);
                // Bangs (front, -Z)
                const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.05), tHair);
                bangs.position.set(0, 0.08, -0.13);
                hairGroup.add(bangs);
            }
        }

        // Legs
        const legWidth = isFemale ? 0.14 : 0.15;
        const legGeo = new THREE.BoxGeometry(legWidth, 0.85 * s, 0.17);

        const lLeg = new THREE.Mesh(legGeo, tJeans);
        lLeg.position.set(hipWidth * 0.3, -0.45 * s, 0);
        hips.add(lLeg);
        this.limbs.leftLeg = lLeg;

        // Holsters
        const holsterL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.25, 0.17), tHolster);
        holsterL.position.set(0.06, 0.1, 0);
        lLeg.add(holsterL);
        const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.17), tHolster);
        strapL.position.y = 0.1;
        lLeg.add(strapL);

        const rLeg = new THREE.Mesh(legGeo, tJeans);
        rLeg.position.set(-hipWidth * 0.3, -0.45 * s, 0);
        hips.add(rLeg);
        this.limbs.rightLeg = rLeg;

        const holsterR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.25, 0.17), tHolster);
        holsterR.position.set(-0.06, 0.1, 0);
        rLeg.add(holsterR);
        const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.17), tHolster);
        strapR.position.y = 0.1;
        rLeg.add(strapR);

        // Boots
        const bootGeo = new THREE.BoxGeometry(0.17, 0.25, 0.25);
        const lBoot = new THREE.Mesh(bootGeo, tBoots);
        lBoot.position.set(0, -0.35 * s, -0.04);
        lLeg.add(lBoot);

        const rBoot = new THREE.Mesh(bootGeo, tBoots);
        rBoot.position.set(0, -0.35 * s, -0.04);
        rLeg.add(rBoot);

        // Arms
        const armGeo = new THREE.BoxGeometry(0.11, 0.7 * s, 0.11);

        const lArm = new THREE.Mesh(armGeo, tJacket);
        lArm.position.set(shoulderWidth * 0.5 + 0.06, -0.05, 0);
        chestGroup.add(lArm);
        this.limbs.leftArm = lArm;
        
        const lGlove = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.12), tHolster);
        lGlove.position.y = -0.3 * s;
        lArm.add(lGlove);

        const rArm = new THREE.Mesh(armGeo, tJacket);
        rArm.position.set(-shoulderWidth * 0.5 - 0.06, -0.05, 0);
        chestGroup.add(rArm);
        this.limbs.rightArm = rArm;
        
        const rGlove = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.12), tHolster);
        rGlove.position.y = -0.3 * s;
        rArm.add(rGlove);

        // Shadow
        const shadow = new THREE.Mesh(
            new THREE.CircleGeometry(0.5, 8),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -0.9 * s + 0.02;
        hips.add(shadow);
    }

    animate(speed) {
        if (!this.limbs.leftLeg) return;
        const time = Date.now() * 0.015;
        const angle = Math.sin(time) * Math.min(speed * 0.03, 0.5);

        this.limbs.leftLeg.rotation.x = angle;
        this.limbs.rightLeg.rotation.x = -angle;
        this.limbs.leftArm.rotation.x = -angle;
        this.limbs.rightArm.rotation.x = angle;
    }

    updateNPC(delta) {
        if (this.isPlayer) return;
        this.aiTimer -= delta;

        // Get terrain height at NPC position
        const terrainY = getTerrainHeight(this.group.position.x, this.group.position.z);
        this.group.position.y = terrainY;

        if (this.aiState === 'idle') {
            this.animate(0);
            if (this.aiTimer <= 0) {
                this.aiState = 'move';
                this.aiTimer = 2 + Math.random() * 4;
                const dist = 30;
                this.targetPos.set(
                    this.group.position.x + (Math.random() - 0.5) * dist,
                    0,
                    this.group.position.z + (Math.random() - 0.5) * dist
                );
            }
        } else {
            this.animate(15.0);
            
            const dir = new THREE.Vector3()
                .subVectors(this.targetPos, this.group.position);
            dir.y = 0;
            
            if (dir.length() > 0.5) {
                dir.normalize();
                this.group.position.x += dir.x * 6 * delta;
                this.group.position.z += dir.z * 6 * delta;
                
                // Face movement direction - character model faces -Z, so add PI
                this.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
            }

            if (this.group.position.distanceTo(this.targetPos) < 1 || this.aiTimer <= 0) {
                this.aiState = 'idle';
                this.aiTimer = 1 + Math.random() * 3;
            }
        }
    }
}

// ============================================
