const textureCache = {};

// Biome-specific texture generators
const biomeTextures = {
    wasteland: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Cracked earth pattern
        ctx.strokeStyle = base.clone().multiplyScalar(0.5).getStyle();
        ctx.lineWidth = 1;
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.random() * 30 - 15, y + Math.random() * 30 - 15);
            ctx.stroke();
        }
    },
    marsh: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Muddy water with algae
        for (let i = 0; i < 800; i++) {
            const r = Math.random();
            if (r > 0.7) ctx.fillStyle = base.clone().multiplyScalar(1.4).getStyle();
            else ctx.fillStyle = base.clone().multiplyScalar(0.6).getStyle();
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    },
    highlands: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Rocky patches
        for (let i = 0; i < 15; i++) {
            ctx.fillStyle = base.clone().multiplyScalar(0.4).getStyle();
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 8, 8);
        }
        for (let i = 0; i < 300; i++) {
            ctx.fillStyle = base.clone().multiplyScalar(1.2).getStyle();
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    },
    crystal: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Crystalline shards
        for (let i = 0; i < 30; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            ctx.fillStyle = base.clone().multiplyScalar(1.5).getStyle();
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 5, y + 10);
            ctx.lineTo(x - 5, y + 10);
            ctx.fill();
        }
    },
    oasis: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Sandy with palm shadows
        for (let i = 0; i < 600; i++) {
            ctx.fillStyle = base.clone().multiplyScalar(0.9 + Math.random() * 0.3).getStyle();
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    },
    volcanic: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Lava cracks (orange/red lines)
        ctx.strokeStyle = '#ff6600';
        ctx.lineWidth = 2;
        for (let i = 0; i < 12; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.random() * 40 - 20, y + Math.random() * 40 - 20);
            ctx.stroke();
        }
        // Ash particles
        ctx.fillStyle = '#666';
        for (let i = 0; i < 200; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
        }
    },
    tundra: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Snow with ice crystals
        for (let i = 0; i < 400; i++) {
            const brightness = 0.9 + Math.random() * 0.2;
            ctx.fillStyle = base.clone().multiplyScalar(brightness).getStyle();
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
        }
        // Ice sparkles
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 50; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
        }
    },
    jungle: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Dense vegetation
        for (let i = 0; i < 700; i++) {
            const variation = 0.6 + Math.random() * 0.8;
            ctx.fillStyle = base.clone().multiplyScalar(variation).getStyle();
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 4, 4);
        }
    },
    corrupted: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Corruption veins (purple/dark)
        ctx.strokeStyle = '#1a0a1a';
        ctx.lineWidth = 2;
        for (let i = 0; i < 25; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.random() * 30 - 15, y + Math.random() * 30 - 15);
            ctx.stroke();
        }
        // Dark spots
        ctx.fillStyle = '#000000';
        for (let i = 0; i < 100; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    },
    bioluminescent: (ctx, colorHex) => {
        const base = new THREE.Color(colorHex);
        ctx.fillStyle = base.getStyle();
        ctx.fillRect(0, 0, 128, 128);
        // Glowing spots
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            const glow = base.clone().multiplyScalar(2.0);
            ctx.fillStyle = glow.getStyle();
            ctx.fillRect(x, y, 3, 3);
        }
        // Darker background patches
        ctx.fillStyle = base.clone().multiplyScalar(0.5).getStyle();
        for (let i = 0; i < 200; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    }
};

export function createTexture(type, colorHex, biomeKey = null) {
    const key = type + colorHex + (biomeKey || '');
    if (textureCache[key]) return textureCache[key];

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const color = new THREE.Color(colorHex);

    ctx.fillStyle = color.getStyle();
    ctx.fillRect(0, 0, 128, 128);

    if (type === 'asphalt') {
        for (let i = 0; i < 1500; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#222' : '#050505';
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    }
    else if (type === 'concrete') {
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, 128, 128);
        ctx.fillStyle = '#050a15';
        for (let y = 10; y < 128; y += 25) {
            for (let x = 10; x < 128; x += 25) {
                if (Math.random() > 0.2) ctx.fillRect(x, y, 15, 18);
            }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 100, 128, 28);
    }
    else if (type === 'door') {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#222';
        ctx.fillRect(10, 10, 108, 108);
        ctx.fillStyle = '#111';
        ctx.fillRect(90, 60, 10, 10);
    }
    else if (type === 'denim') {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 2000; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, 5, 128);
        ctx.fillRect(123, 0, 5, 128);
    }
    else if (type === 'face') {
        ctx.fillStyle = colorHex || '#ffe0bd';
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#111';
        ctx.fillRect(25, 55, 25, 12);
        ctx.fillRect(78, 55, 25, 12);
        ctx.fillStyle = '#fff';
        ctx.fillRect(27, 57, 21, 8);
        ctx.fillRect(80, 57, 21, 8);
        ctx.fillStyle = '#000';
        ctx.fillRect(35, 59, 8, 8);
        ctx.fillRect(88, 59, 8, 8);
        ctx.fillStyle = '#222';
        ctx.fillRect(25, 48, 25, 3);
        ctx.fillRect(78, 48, 25, 3);
        ctx.fillStyle = '#aa6666';
        ctx.fillRect(54, 95, 20, 4);
    }
    else if (type === 'jacket_back') {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 500; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
        ctx.strokeStyle = '#cc0000';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(64, 64, 35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#cc0000';
        ctx.beginPath();
        ctx.moveTo(64, 40);
        ctx.lineTo(45, 75);
        ctx.lineTo(83, 75);
        ctx.fill();
    }
    else if (type === 'leather') {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 500; i++) {
            ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        }
    }
    else if (type === 'checkers') {
        ctx.fillStyle = '#555';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillRect(64, 64, 64, 64);
    }
    else if (type === 'skin') {
        ctx.fillStyle = colorHex;
        ctx.fillRect(0, 0, 128, 128);
    }
    else if (type === 'grass') {
        // Use biome-specific texture if available
        if (biomeKey && biomeTextures[biomeKey]) {
            biomeTextures[biomeKey](ctx, colorHex);
        } else {
            // Fallback to generic grass texture with biome color
            const baseColor = new THREE.Color(colorHex);
            ctx.fillStyle = baseColor.getStyle();
            ctx.fillRect(0, 0, 128, 128);

            const darkColor = baseColor.clone().multiplyScalar(0.7);
            const lightColor = baseColor.clone().multiplyScalar(1.3);

            for (let i = 0; i < 500; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? darkColor.getStyle() : lightColor.getStyle();
                ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
            }
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    textureCache[key] = tex;
    return tex;
}
