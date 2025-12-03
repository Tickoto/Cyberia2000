import { CONFIG } from './config.js';
import { biomeInfoAtPosition } from './terrain.js';

export class EnvironmentSystem {
    constructor(scene) {
        this.scene = scene;
        this.timeOfDay = 9; // Start morningside to align visuals with HUD at boot
        this.weather = 'clear';
        this.wind = CONFIG.ambientWindBase;
        this.tick = 0;
        this.skyColor = new THREE.Color('#445566');
        this.fog = new THREE.Fog(this.skyColor, 50, 350);
        this.scene.fog = this.fog;
    }

    update(delta, playerPosition) {
        this.timeOfDay = (this.timeOfDay + delta * (24 / CONFIG.dayLength)) % 24;
        this.tick += delta;

        if (this.tick > CONFIG.weatherChangeInterval) {
            this.rollWeather();
            this.tick = 0;
        }

        this.wind = THREE.MathUtils.lerp(
            this.wind,
            CONFIG.ambientWindBase + (Math.random() - 0.5) * CONFIG.ambientWindVariance,
            0.15
        );

        const biome = biomeInfoAtPosition(playerPosition.x, playerPosition.z);
        this.applyLighting(biome);
        this.updateHUD(biome);
    }

    formatTimeOfDay() {
        const hours = Math.floor(this.timeOfDay);
        const minutes = Math.floor((this.timeOfDay - hours) * 60);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    rollWeather() {
        const states = ['clear', 'rain', 'dust', 'storm', 'fog', 'aurora'];
        const next = states[Math.floor(Math.random() * states.length)];
        this.weather = next;
    }

    applyLighting(biome) {
        const t = Math.abs((this.timeOfDay - 12) / 12);
        const intensity = THREE.MathUtils.clamp(1 - t * 0.7, 0.2, 1);
        const color = new THREE.Color(biome.primaryColor);
        const lerped = color.lerp(new THREE.Color('#223344'), 1 - intensity);

        this.skyColor.copy(lerped);
        this.scene.background = this.skyColor;
        this.fog.color.copy(this.skyColor);

        this.fog.near = 40 + intensity * 20;
        this.fog.far = 220 + intensity * 100;
    }

    updateHUD(biome) {
        const env = document.getElementById('hud-environment');
        const clock = document.getElementById('hud-clock');
        if (!env) return;
        const daySegment = this.timeOfDay >= 18 || this.timeOfDay < 6 ? 'Night' : 'Day';
        const timeLabel = this.formatTimeOfDay();
        env.textContent = `${this.weather.toUpperCase()} · Local ${daySegment}`;
        if (clock) {
            clock.textContent = `${timeLabel}`;
        }
    }
}
