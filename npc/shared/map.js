const tiles = {
  0: {
    name: "floor",
    walkable: true,
    cssClass: "floor",
  },
  1: {
    name: "wall",
    walkable: false,
    cssClass: "wall",
  },
  2: {
    name: "spawn-point",
    walkable: true,
    cssClass: "spawn-point",
  },
  3: {
    name: "lava",
    walkable: false,
    cssClass: "lava",
  },
  4: {
    name: "water",
    walkable: false,
    cssClass: "water",
  },
  5: {
    name: "grass",
    walkable: true,
    cssClass: "grass",
  },
  6: {
    name: "bridge",
    walkable: true,
    cssClass: "bridge",
  },
  7: {
    name: "spikes",
    walkable: true,
    cssClass: "spikes",
  },
  8: {
    name: "sand",
    walkable: true,
    cssClass: "sand",
  },
};

const elderswildRuinsLayout = [
  // 40 columns x 26 rows - Large arena with multiple biomes
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 2, 5, 5, 5, 5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 5, 5, 5, 5, 2, 1],
  [1, 5, 5, 5, 5, 5, 5, 0, 0, 0, 1, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 1, 0, 0, 0, 5, 5, 5, 5, 5, 5, 1],
  [1, 5, 5, 1, 1, 5, 5, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 6, 6, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 5, 5, 1, 1, 5, 5, 1],
  [1, 5, 5, 1, 1, 5, 5, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 6, 6, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 5, 5, 1, 1, 5, 5, 1],
  [1, 5, 5, 5, 5, 5, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 5, 5, 5, 5, 5, 5, 1],
  [1, 0, 5, 5, 5, 0, 0, 0, 0, 1, 1, 0, 0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 0, 0, 1, 1, 0, 0, 0, 0, 5, 5, 5, 5, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 0, 0, 1, 1, 1, 1, 0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 0, 8, 8, 8, 8, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 8, 8, 8, 8, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 1],
  [1, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 1],
  [1, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 1],
  [1, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 1],
  [1, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 0, 8, 8, 8, 8, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 8, 8, 8, 8, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 0, 0, 1, 1, 1, 1, 0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 5, 5, 5, 0, 0, 0, 0, 1, 1, 0, 0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 0, 0, 1, 1, 0, 0, 0, 0, 5, 5, 5, 5, 0, 1],
  [1, 5, 5, 5, 5, 5, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 5, 5, 5, 5, 5, 5, 1],
  [1, 2, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 2, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

function createBoxedLayout(width, height, fillTileId) {
  return Array.from({ length: height }, (_, tileY) =>
    Array.from({ length: width }, (_, tileX) => {
      const isBorder =
        tileX === 0 || tileY === 0 || tileX === width - 1 || tileY === height - 1;
      return isBorder ? 1 : fillTileId;
    }),
  );
}

function paintRect(layout, x, y, width, height, tileId) {
  for (let tileY = y; tileY < y + height; tileY++) {
    for (let tileX = x; tileX < x + width; tileX++) {
      if (layout[tileY]?.[tileX] == null) {
        continue;
      }
      layout[tileY][tileX] = tileId;
    }
  }
}

function paintTile(layout, x, y, tileId) {
  if (layout[y]?.[x] == null) {
    return;
  }
  layout[y][x] = tileId;
}

const sunkenAtollLayout = (() => {
  const layout = createBoxedLayout(28, 20, 5);

  paintRect(layout, 6, 4, 16, 12, 8);
  paintRect(layout, 9, 6, 10, 8, 4);
  paintRect(layout, 13, 6, 2, 8, 6);
  paintRect(layout, 9, 9, 10, 2, 6);

  paintRect(layout, 2, 14, 3, 3, 4);
  paintRect(layout, 23, 3, 3, 3, 4);

  paintRect(layout, 4, 9, 2, 2, 7);
  paintRect(layout, 22, 9, 2, 2, 7);

  paintRect(layout, 3, 3, 3, 1, 1);
  paintRect(layout, 22, 16, 3, 1, 1);
  paintRect(layout, 12, 2, 4, 2, 1);
  paintRect(layout, 12, 16, 4, 2, 1);

  [
    [2, 2],
    [25, 2],
    [2, 17],
    [25, 17],
  ].forEach(([tileX, tileY]) => paintTile(layout, tileX, tileY, 2));

  return layout;
})();

const ashenForgeLayout = (() => {
  const layout = createBoxedLayout(34, 18, 0);

  paintRect(layout, 5, 5, 5, 8, 8);
  paintRect(layout, 24, 5, 5, 8, 8);

  paintRect(layout, 8, 3, 3, 12, 3);
  paintRect(layout, 23, 3, 3, 12, 3);
  paintRect(layout, 12, 7, 10, 4, 3);

  paintRect(layout, 8, 8, 18, 2, 6);
  paintRect(layout, 16, 3, 2, 12, 6);

  paintRect(layout, 14, 1, 6, 2, 1);
  paintRect(layout, 14, 15, 6, 2, 1);
  paintRect(layout, 11, 5, 2, 2, 1);
  paintRect(layout, 21, 11, 2, 2, 1);

  paintRect(layout, 15, 12, 4, 2, 7);

  [
    [2, 2],
    [31, 2],
    [2, 15],
    [31, 15],
  ].forEach(([tileX, tileY]) => paintTile(layout, tileX, tileY, 2));

  return layout;
})();

const celestialArboretumLayout = (() => {
  const layout = createBoxedLayout(22, 30, 5);

  paintRect(layout, 7, 7, 8, 16, 8);
  paintRect(layout, 9, 2, 4, 26, 0);
  paintRect(layout, 2, 13, 18, 4, 0);

  paintRect(layout, 3, 4, 4, 5, 4);
  paintRect(layout, 15, 4, 4, 5, 4);
  paintRect(layout, 3, 21, 4, 5, 4);
  paintRect(layout, 15, 21, 4, 5, 4);

  paintRect(layout, 4, 6, 2, 2, 6);
  paintRect(layout, 16, 6, 2, 2, 6);
  paintRect(layout, 4, 22, 2, 2, 6);
  paintRect(layout, 16, 22, 2, 2, 6);

  paintRect(layout, 5, 10, 2, 2, 1);
  paintRect(layout, 15, 10, 2, 2, 1);
  paintRect(layout, 5, 18, 2, 2, 1);
  paintRect(layout, 15, 18, 2, 2, 1);

  [
    [10, 10],
    [11, 10],
    [9, 15],
    [12, 15],
    [10, 19],
    [11, 19],
  ].forEach(([tileX, tileY]) => paintTile(layout, tileX, tileY, 7));

  [
    [2, 2],
    [19, 2],
    [2, 27],
    [19, 27],
  ].forEach(([tileX, tileY]) => paintTile(layout, tileX, tileY, 2));

  return layout;
})();

const MAP_DEFINITIONS = [
  {
    metadata: {
      id: "elderswild-ruins",
      name: "Elderswild Ruins",
      theme: "ruins",
      size: {
        width: 40,
        height: 26,
        tileSize: 48,
      },
    },
    tiles,
    layout: elderswildRuinsLayout,
    tileEffects: [
      {
        id: "spike-pit",
        type: "damage",
        tileIds: [7],
        damagePerTick: 12,
        intervalMs: 500,
      },
      {
        id: "quicksand",
        type: "slow",
        tileIds: [8],
        moveSpeedMultiplier: 0.65,
      },
      {
        id: "west-east-bridge-teleport",
        type: "teleport",
        triggerTiles: [{ x: 1, y: 14 }],
        destinationTile: { x: 38, y: 14 },
        cooldownMs: 1500,
      },
      {
        id: "east-west-bridge-teleport",
        type: "teleport",
        triggerTiles: [{ x: 38, y: 14 }],
        destinationTile: { x: 1, y: 14 },
        cooldownMs: 1500,
      },
    ],
  },
  {
    metadata: {
      id: "sunken-atoll",
      name: "Sunken Atoll",
      theme: "tide-temple",
      size: {
        width: 28,
        height: 20,
        tileSize: 44,
      },
    },
    tiles,
    layout: sunkenAtollLayout,
    tileEffects: [
      {
        id: "reef-spikes",
        type: "damage",
        tileIds: [7],
        damagePerTick: 10,
        intervalMs: 600,
      },
      {
        id: "drifting-dunes",
        type: "slow",
        tileIds: [8],
        moveSpeedMultiplier: 0.72,
      },
      {
        id: "atoll-altar-teleport-north",
        type: "teleport",
        triggerTiles: [{ x: 14, y: 5 }],
        destinationTile: { x: 14, y: 14 },
        cooldownMs: 1800,
      },
      {
        id: "atoll-altar-teleport-south",
        type: "teleport",
        triggerTiles: [{ x: 14, y: 14 }],
        destinationTile: { x: 14, y: 5 },
        cooldownMs: 1800,
      },
    ],
  },
  {
    metadata: {
      id: "ashen-forge",
      name: "Ashen Forge",
      theme: "volcanic-foundry",
      size: {
        width: 34,
        height: 18,
        tileSize: 40,
      },
    },
    tiles,
    layout: ashenForgeLayout,
    tileEffects: [
      {
        id: "molten-rivers",
        type: "damage",
        tileIds: [3],
        damagePerTick: 14,
        intervalMs: 500,
      },
      {
        id: "slag-mires",
        type: "slow",
        tileIds: [8],
        moveSpeedMultiplier: 0.68,
      },
      {
        id: "forge-gate-north-south",
        type: "teleport",
        triggerTiles: [{ x: 16, y: 3 }, { x: 17, y: 3 }],
        destinationTile: { x: 16, y: 14 },
        cooldownMs: 1400,
      },
      {
        id: "forge-gate-south-north",
        type: "teleport",
        triggerTiles: [{ x: 16, y: 14 }, { x: 17, y: 14 }],
        destinationTile: { x: 16, y: 3 },
        cooldownMs: 1400,
      },
    ],
  },
  {
    metadata: {
      id: "celestial-arboretum",
      name: "Celestial Arboretum",
      theme: "astral-garden",
      size: {
        width: 22,
        height: 30,
        tileSize: 42,
      },
    },
    tiles,
    layout: celestialArboretumLayout,
    tileEffects: [
      {
        id: "star-thorns",
        type: "damage",
        tileIds: [7],
        damagePerTick: 9,
        intervalMs: 650,
      },
      {
        id: "moonwater-drag",
        type: "slow",
        tileIds: [4],
        moveSpeedMultiplier: 0.7,
      },
      {
        id: "north-south-obelisk-jump",
        type: "teleport",
        triggerTiles: [{ x: 10, y: 2 }, { x: 11, y: 2 }],
        destinationTile: { x: 10, y: 27 },
        cooldownMs: 2000,
      },
      {
        id: "south-north-obelisk-jump",
        type: "teleport",
        triggerTiles: [{ x: 10, y: 27 }, { x: 11, y: 27 }],
        destinationTile: { x: 10, y: 2 },
        cooldownMs: 2000,
      },
    ],
  },
];

export const DEFAULT_MAP_ID = "elderswild-ruins";

function createWalkable(map) {
  return function walkable(xPos, yPos) {
    if (xPos < 0 || yPos < 0) {
      return false;
    }

    const { tileSize, width, height } = map.config;
    if (xPos >= width * tileSize || yPos >= height * tileSize) {
      return false;
    }

    const tileX = Math.floor(xPos / tileSize);
    const tileY = Math.floor(yPos / tileSize);
    const tileId = map.layout[tileY]?.[tileX];

    if (tileId == null) {
      return false;
    }

    return Boolean(map.tiles[tileId]?.walkable);
  };
}

function tileToWorld(tileX, tileY, tileSize) {
  return {
    x: tileX * tileSize + tileSize / 2,
    y: tileY * tileSize + tileSize / 2,
  };
}

function extractSpawnPoints(layout, mapTiles, tileSize) {
  const spawnTileIds = new Set(
    Object.entries(mapTiles)
      .filter(([, tile]) => tile?.name === "spawn-point")
      .map(([tileId]) => Number(tileId)),
  );

  const spawnPoints = [];
  for (let tileY = 0; tileY < layout.length; tileY++) {
    const row = layout[tileY];
    for (let tileX = 0; tileX < row.length; tileX++) {
      if (!spawnTileIds.has(row[tileX])) {
        continue;
      }
      const world = tileToWorld(tileX, tileY, tileSize);
      spawnPoints.push({
        id: `spawn-${spawnPoints.length + 1}`,
        tileX,
        tileY,
        x: world.x,
        y: world.y,
      });
    }
  }
  return spawnPoints;
}

function createMap(definition) {
  const metadata = definition.metadata || {};
  const size = metadata.size || {};
  const config = {
    tileSize: Number(size.tileSize) || 48,
    width: Number(size.width) || 0,
    height: Number(size.height) || 0,
  };

  const runtimeMap = {
    id: metadata.id,
    metadata: {
      id: metadata.id,
      name: metadata.name,
      theme: metadata.theme,
      size: {
        width: config.width,
        height: config.height,
        tileSize: config.tileSize,
      },
    },
    config,
    tiles: definition.tiles,
    layout: definition.layout,
    spawnPoints: extractSpawnPoints(definition.layout, definition.tiles, config.tileSize),
    tileEffects: Array.isArray(definition.tileEffects)
      ? definition.tileEffects.map((effect) => ({ ...effect }))
      : [],
  };

  runtimeMap.walkable = createWalkable(runtimeMap);
  return runtimeMap;
}

const mapRegistry = new Map(
  MAP_DEFINITIONS.map((definition) => {
    const runtimeMap = createMap(definition);
    return [runtimeMap.id, runtimeMap];
  }),
);

export function getMapById(mapId) {
  if (typeof mapId !== "string") {
    return null;
  }
  return mapRegistry.get(mapId) || null;
}

export function getDefaultMap() {
  return getMapById(DEFAULT_MAP_ID);
}

export function getMapMetadataList() {
  return Array.from(mapRegistry.values(), (map) => map.metadata);
}

export function getMapRegistry() {
  return mapRegistry;
}

export default getDefaultMap();
