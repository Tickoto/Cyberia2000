import { seededRandom } from './terrain.js';

export const ACTION_LIBRARY = {
    inspect: {
        label: 'Inspect',
        flavor: 'Carefully read diagnostics and tags.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 1);
            const knowledge = Math.round((def.energy + rng * 3) * 2);
            return {
                log: `You document ${knowledge} telemetry readings from the ${def.name}.`,
                intel: knowledge,
                stamina: 2,
                cooldown: Math.max(4, def.cooldown * 0.25)
            };
        }
    },
    use: {
        label: 'Use',
        flavor: 'Operate the device for its intended function.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 2);
            const payout = Math.round(def.energy * 10 + rng * 25);
            const staminaCost = Math.max(4, def.energy * 2);
            return {
                log: `The ${def.name} dispenses ${payout} credits worth of utility.`,
                credits: payout,
                stamina: -staminaCost,
                cooldown: def.cooldown
            };
        }
    },
    repair: {
        label: 'Repair',
        flavor: 'Patch up damaged wiring and plates.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 3);
            const salvageUsed = 3 + Math.floor(rng * 5);
            const reward = Math.round(8 + rng * 12 + def.energy * 3);
            const repaired = rng > 0.35;
            return {
                log: repaired
                    ? `You burn ${salvageUsed} salvage to bring the ${def.name} online. It yields ${reward} credits.`
                    : `Your patches hold temporarily. You still scrape ${Math.round(reward * 0.5)} credits from its cache.`,
                credits: repaired ? reward : Math.round(reward * 0.5),
                salvage: -salvageUsed,
                stamina: -3,
                cooldown: def.cooldown * (repaired ? 0.5 : 0.8)
            };
        }
    },
    hack: {
        label: 'Hack',
        flavor: 'Brute-force past access shrouds.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 4);
            const success = rng > 0.25;
            const intel = Math.round((def.energy + 1) * (success ? 12 : 4));
            const backlash = success ? 0 : 6;
            return {
                log: success
                    ? `Backdoor established. ${intel} encrypted datagrams exfiltrated from ${def.name}.`
                    : `ICE flares! You still snag ${intel} fragments before countermeasures burn you.`,
                intel,
                stamina: -4 - backlash,
                health: success ? 0 : -6,
                cooldown: def.cooldown * (success ? 0.6 : 1)
            };
        }
    },
    overcharge: {
        label: 'Overcharge',
        flavor: 'Force the device to output beyond spec.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 5);
            const unstable = rng > 0.6;
            const payout = Math.round(def.energy * 30 + rng * 20);
            return {
                log: unstable
                    ? `The ${def.name} spits sparks. You grab ${payout} credits before it melts down!`
                    : `You channel ${payout} credits of power without a hitch.`,
                credits: payout,
                salvage: unstable ? -2 : 0,
                health: unstable ? -10 : 0,
                cooldown: def.cooldown * (unstable ? 1.5 : 0.75)
            };
        }
    },
    salvage: {
        label: 'Salvage',
        flavor: 'Strip components for future builds.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 6);
            const haul = 2 + Math.floor(rng * 6 + def.energy);
            const integrity = rng > 0.7;
            return {
                log: integrity
                    ? `You neatly pull ${haul} salvage and keep the ${def.name} operational.`
                    : `You rip ${haul} salvage out. The ${def.name} powers down with a sigh.`,
                salvage: haul,
                cooldown: def.cooldown * (integrity ? 0.5 : 2),
                disabled: !integrity
            };
        }
    },
    siphon: {
        label: 'Siphon',
        flavor: 'Drain exotic energy streams.',
        apply: (def, seed, state) => {
            const rng = seededRandom(seed + 7);
            const essence = Math.round(def.energy * 40 + rng * 20);
            return {
                log: `You bottle ${essence} units of exotic charge from the ${def.name}.`,
                credits: essence,
                intel: Math.round(essence * 0.1),
                stamina: -8,
                cooldown: def.cooldown * 1.25
            };
        }
    }
};

export function evaluateAction(def, action, seed, state) {
    const entry = ACTION_LIBRARY[action];
    if (!entry) {
        return { log: `${action} is not wired into the grid yet.`, cooldown: 2 };
    }
    return entry.apply(def, seed, state);
}
