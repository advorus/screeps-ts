export const extensionStamp: Stamp = [
    {dx: 0, dy: 0, structureType: STRUCTURE_EXTENSION},
    {dx: -1, dy: 0, structureType: STRUCTURE_EXTENSION},
    {dx: 1, dy: 0, structureType: STRUCTURE_EXTENSION},
    {dx: 0, dy: -1, structureType: STRUCTURE_EXTENSION},
    {dx: 0, dy: 1, structureType: STRUCTURE_EXTENSION},
    {dx:-1,dy:1, structureType: STRUCTURE_ROAD},
    {dx:1,dy:1, structureType: STRUCTURE_ROAD},
    {dx:-1,dy:-1, structureType: STRUCTURE_ROAD},
    {dx:1,dy:-1, structureType: STRUCTURE_ROAD},
    {dx:2,dy:0, structureType: STRUCTURE_ROAD},
    {dx:0,dy:2, structureType: STRUCTURE_ROAD},
    {dx:-2,dy:0, structureType: STRUCTURE_ROAD},
    {dx:0,dy:-2, structureType: STRUCTURE_ROAD}
];

export const spawnStamp: Stamp = [
    /**
     * a central 7x7 structure which includes all three potential spawns, and leaves enough space for the
     * extensions to be fast filled - will generate a 'filler' task for each spare space which
     * gets created if there is a container adjacent to a fast filler square
     */

    {dx: 0, dy: 0, structureType: STRUCTURE_LINK},
    {dx: -1, dy: 0, structureType: STRUCTURE_EXTENSION},
    {dx:1, dy:0, structureType: STRUCTURE_EXTENSION},
    {dx:0, dy:-1, structureType: STRUCTURE_EXTENSION},
    {dx:0, dy:1, structureType: STRUCTURE_EXTENSION},
    {dx:-2, dy:0, structureType: STRUCTURE_CONTAINER},
    {dx:2, dy:0, structureType: STRUCTURE_CONTAINER},
    {dx:0, dy:2, structureType: STRUCTURE_SPAWN},
    {dx:0, dy:-2, structureType: STRUCTURE_EXTENSION},
    {dx:-2, dy:-1, structureType: STRUCTURE_SPAWN},
    {dx:2, dy:-1, structureType: STRUCTURE_SPAWN},
    {dx:-2, dy:-2, structureType: STRUCTURE_EXTENSION},
    {dx:2, dy:-2, structureType: STRUCTURE_EXTENSION},
    {dx:-1, dy:-2, structureType: STRUCTURE_EXTENSION},
    {dx:1, dy:-2, structureType: STRUCTURE_EXTENSION},
    {dx:-2, dy:1, structureType: STRUCTURE_EXTENSION},
    {dx:2, dy:1, structureType: STRUCTURE_EXTENSION},
    {dx:-2, dy:2, structureType: STRUCTURE_EXTENSION},
    {dx:2, dy:2, structureType: STRUCTURE_EXTENSION},
    {dx:-1, dy:2, structureType: STRUCTURE_EXTENSION},
    {dx:1, dy:2, structureType: STRUCTURE_EXTENSION},
    {dx:-2, dy:3, structureType: STRUCTURE_ROAD},
    {dx:-1, dy:3, structureType: STRUCTURE_ROAD},
    {dx:0, dy:3, structureType: STRUCTURE_ROAD},
    {dx:1, dy:3, structureType: STRUCTURE_ROAD},
    {dx:2, dy:3, structureType: STRUCTURE_ROAD},
    {dx:-2, dy:-3, structureType: STRUCTURE_ROAD},
    {dx:-1, dy:-3, structureType: STRUCTURE_ROAD},
    {dx:0, dy:-3, structureType: STRUCTURE_ROAD},
    {dx:1, dy:-3, structureType: STRUCTURE_ROAD},
    {dx:2, dy:-3, structureType: STRUCTURE_ROAD},
    {dx:-3, dy:2, structureType: STRUCTURE_ROAD},
    {dx:-3, dy:1, structureType: STRUCTURE_ROAD},
    {dx:-3, dy:0, structureType: STRUCTURE_ROAD},
    {dx:-3, dy:-1, structureType: STRUCTURE_ROAD},
    {dx:-3, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:3, dy:2, structureType: STRUCTURE_ROAD},
    {dx:3, dy:1, structureType: STRUCTURE_ROAD},
    {dx:3, dy:0, structureType: STRUCTURE_ROAD},
    {dx:3, dy:-1, structureType: STRUCTURE_ROAD},
    {dx:3, dy:-2, structureType: STRUCTURE_ROAD}
];

export const coreStamp: Stamp = [
    {dx:-1, dy: -1, structureType: STRUCTURE_FACTORY},
    {dx:0, dy: -1, structureType: STRUCTURE_NUKER},
    {dx:1, dy:-1, structureType: STRUCTURE_POWER_SPAWN},
    {dx: -1, dy:0, structureType: STRUCTURE_STORAGE},
    {dx: 1, dy:0, structureType: STRUCTURE_LINK},
    {dx: -1, dy:1, structureType: STRUCTURE_TERMINAL},
    {dx:0, dy:1, structureType: STRUCTURE_OBSERVER},
    {dx:-2, dy:-1, structureType: STRUCTURE_ROAD},
    {dx:-2, dy:0, structureType: STRUCTURE_ROAD},
    {dx:-2, dy:1, structureType: STRUCTURE_ROAD},
    {dx: 2, dy:-1, structureType: STRUCTURE_ROAD},
    {dx: 2, dy:0, structureType: STRUCTURE_ROAD},
    {dx: 2, dy:1, structureType: STRUCTURE_ROAD},
    {dx:-1, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:0, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:1, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:-1, dy:2, structureType: STRUCTURE_ROAD},
    {dx:0, dy:2, structureType: STRUCTURE_ROAD},
    {dx:1, dy:2, structureType: STRUCTURE_ROAD}
];

export const towerStamp: Stamp = [
    {dx:-1, dy:-1, structureType: STRUCTURE_TOWER},
    {dx:0, dy:-1, structureType: STRUCTURE_TOWER},
    {dx:1, dy:-1, structureType: STRUCTURE_TOWER},
    {dx:-1, dy:0, structureType: STRUCTURE_TOWER},
    {dx:1, dy:0, structureType: STRUCTURE_TOWER},
    {dx:0, dy:1, structureType: STRUCTURE_TOWER},
    {dx:-1, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:0, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:1, dy:-2, structureType: STRUCTURE_ROAD},
    {dx:-2, dy: -1, structureType: STRUCTURE_ROAD},
    {dx: 2, dy: -1, structureType: STRUCTURE_ROAD},
    {dx:-2, dy:0, structureType: STRUCTURE_ROAD},
    {dx:2, dy: 0, structureType: STRUCTURE_ROAD},
    {dx:-1, dy:1, structureType: STRUCTURE_ROAD},
    {dx:1, dy:1, structureType: STRUCTURE_ROAD},
    {dx:0, dy:2, structureType: STRUCTURE_ROAD}
]


