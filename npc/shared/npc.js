const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const NPC_COUNT_LIMITS = Object.freeze({
  min: 1,
  max: 3,
});

export const NPC_DIFFICULTY_PRESETS = Object.freeze([
  {
    id: "easy",
    label: "Easy",
    multiplier: 0.6,
    reactionMs: 420,
    baseFailureRate: 0.38,
    aimSpreadMultiplier: 1.5,
    castCadenceMultiplier: 0.8,
    dashChanceMultiplier: 0.75,
    strategyNoise: 0.45,
    targetRandomness: 0.45,
  },
  {
    id: "medium",
    label: "Medium",
    multiplier: 1,
    reactionMs: 220,
    baseFailureRate: 0.18,
    aimSpreadMultiplier: 1,
    castCadenceMultiplier: 1,
    dashChanceMultiplier: 1,
    strategyNoise: 0.18,
    targetRandomness: 0.25,
  },
  {
    id: "hard",
    label: "Hard",
    multiplier: 1.4,
    reactionMs: 110,
    baseFailureRate: 0.03,
    aimSpreadMultiplier: 0.55,
    castCadenceMultiplier: 1.2,
    dashChanceMultiplier: 1.25,
    strategyNoise: 0.05,
    targetRandomness: 0.08,
  },
]);

export const NPC_ARCHETYPES = Object.freeze([
  {
    id: "duelist",
    name: "Arcane Duelist",
    description: "Balanced skirmisher with steady pressure.",
    loadout: ["magicMissile", "fireball", "boomerang"],
    preferredRange: 320,
    baseAggression: 0.62,
    basePrecision: 0.6,
    baseTempo: 0.6,
    baseMobility: 0.62,
    basePower: 0.55,
  },
  {
    id: "warden",
    name: "Frost Warden",
    description: "Controls space and keeps distance.",
    loadout: ["icebolt", "riftMine", "magicMissile"],
    preferredRange: 440,
    baseAggression: 0.42,
    basePrecision: 0.68,
    baseTempo: 0.5,
    baseMobility: 0.45,
    basePower: 0.62,
  },
  {
    id: "inferno",
    name: "Inferno Herald",
    description: "High burst damage and heavy casts.",
    loadout: ["fireball", "comet", "flamePhoenix"],
    preferredRange: 480,
    baseAggression: 0.55,
    basePrecision: 0.58,
    baseTempo: 0.4,
    baseMobility: 0.4,
    basePower: 0.82,
  },
  {
    id: "rift",
    name: "Rift Skirmisher",
    description: "Aggressive trapper that keeps moving.",
    loadout: ["boomerang", "riftMine", "magicMissile"],
    preferredRange: 300,
    baseAggression: 0.72,
    basePrecision: 0.54,
    baseTempo: 0.66,
    baseMobility: 0.7,
    basePower: 0.52,
  },
]);

export function getNpcDifficultyById(id) {
  return NPC_DIFFICULTY_PRESETS.find((difficulty) => difficulty.id === id) || NPC_DIFFICULTY_PRESETS[1];
}

export function getNpcArchetypeById(id) {
  return NPC_ARCHETYPES.find((archetype) => archetype.id === id) || NPC_ARCHETYPES[0];
}

export function sanitizeNpcName(rawName, fallbackIndex = 0) {
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";
  if (trimmed.length >= 2 && trimmed.length <= 15) {
    return trimmed;
  }
  return `NPC ${fallbackIndex + 1}`;
}

export function sanitizeNpcConfig(rawConfig = {}, fallbackIndex = 0) {
  const archetype = getNpcArchetypeById(rawConfig.archetypeId);
  const difficulty = getNpcDifficultyById(rawConfig.difficulty);
  const toPercent = (value, fallback) => {
    const numeric = Number.isFinite(value) ? value : fallback;
    return clamp(numeric, 0, 100);
  };

  return {
    playerId: typeof rawConfig.playerId === "string" ? rawConfig.playerId : null,
    name: sanitizeNpcName(rawConfig.name, fallbackIndex),
    archetypeId: archetype.id,
    difficulty: difficulty.id,
    aggression: toPercent(rawConfig.aggression, archetype.baseAggression * 100),
    precision: toPercent(rawConfig.precision, archetype.basePrecision * 100),
    tempo: toPercent(rawConfig.tempo, archetype.baseTempo * 100),
    mobility: toPercent(rawConfig.mobility, archetype.baseMobility * 100),
    power: toPercent(rawConfig.power, archetype.basePower * 100),
  };
}

export function createDefaultNpcConfigs(count = NPC_COUNT_LIMITS.min) {
  const safeCount = clamp(count, NPC_COUNT_LIMITS.min, NPC_COUNT_LIMITS.max);
  const configs = [];
  for (let index = 0; index < safeCount; index += 1) {
    const archetype = NPC_ARCHETYPES[index % NPC_ARCHETYPES.length];
    configs.push(
      sanitizeNpcConfig(
        {
          name: `NPC ${index + 1}`,
          archetypeId: archetype.id,
          difficulty: index === 0 ? "medium" : index === 1 ? "easy" : "hard",
          aggression: archetype.baseAggression * 100,
          precision: archetype.basePrecision * 100,
          tempo: archetype.baseTempo * 100,
          mobility: archetype.baseMobility * 100,
          power: archetype.basePower * 100,
        },
        index,
      ),
    );
  }
  return configs;
}

export function getNpcEffectiveStats(config) {
  const sanitized = sanitizeNpcConfig(config);
  const difficulty = getNpcDifficultyById(sanitized.difficulty);
  const multiplier = difficulty.multiplier;
  const toUnit = (percent) => clamp(percent / 100, 0, 1);
  const baseStats = {
    aggression: toUnit(sanitized.aggression),
    precision: toUnit(sanitized.precision),
    tempo: toUnit(sanitized.tempo),
    mobility: toUnit(sanitized.mobility),
    power: toUnit(sanitized.power),
  };

  const effectiveStats = Object.fromEntries(
    Object.entries(baseStats).map(([key, value]) => [key, clamp(value * multiplier, 0.18, 1.75)]),
  );

  const avg =
    (effectiveStats.aggression +
      effectiveStats.precision +
      effectiveStats.tempo +
      effectiveStats.mobility +
      effectiveStats.power) /
    5;
  const effectivenessScore = Math.round(clamp(avg * 100, 10, 160));

  return {
    baseStats,
    effectiveStats,
    difficulty,
    effectivenessScore,
  };
}
