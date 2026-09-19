export function getEmpireMemory(): EmpireMemory {
    if(!Memory.empire){
        Memory.empire = {};
    }
    return Memory.empire as EmpireMemory;
}

export function getColonyMemory(roomName:string): ColonyMemory {
    if(!Memory.colonies){
        Memory.colonies = {};
    }
    if(!Memory.colonies[roomName]){
        Memory.colonies[roomName] = {
            taskQueue: [],
            wallRepairThreshold: 100000
        };
    }
    return Memory.colonies[roomName] as ColonyMemory;
}

export function getHostileRooms(): {roomName:string, lastSeen:number}[] {
    if(!Memory.hostileRooms){
        Memory.hostileRooms = [];
    }
    return Memory.hostileRooms;
}

export function checkIfHostileRoom(roomName: string): boolean {
    const hostileRooms = getHostileRooms();
    return hostileRooms.some(room => room.roomName === roomName);
}

export function addHostileRoom(roomName: string): void {
    // check if the room is already in hostile rooms - if it is then update the most recent tick
    const hostileRooms = getHostileRooms();
    const existingRoom = hostileRooms.find(room => room.roomName === roomName);
    if (existingRoom) {
        existingRoom.lastSeen = Game.time;
    } else {
        hostileRooms.push({ roomName, lastSeen: Game.time });
    }
}

export function removeHostileRoom(roomName: string): void {
    const hostileRooms = getHostileRooms();
    const roomIndex = hostileRooms.findIndex(room => room.roomName === roomName);
    if (roomIndex !== -1) {
        hostileRooms.splice(roomIndex, 1);
    }
}

export function getTaskMemory(taskId:string): AnyTaskMemory {
    if(!Memory.tasks){
        Memory.tasks = {};
    }
    if(!Memory.tasks[taskId]==undefined){
        Memory.tasks[taskId] = {}
    }
    return Memory.tasks[taskId] as TaskMemory;
}

export function getCreepMemory(creepName:string): CreepMemory {
    if(!Memory.creeps){
        Memory.creeps = {};
    }
    if(!Memory.creeps[creepName]){
        Memory.creeps[creepName] = {};
    }
    return Memory.creeps[creepName] as CreepMemory;
}

export function getAllTaskMemory(): AnyTaskMemory[] {
    if (!Memory.tasks) {
        Memory.tasks = {};
    }
    return Object.values(Memory.tasks) as TaskMemory[];
}

export function getScoutedRoomMemory(roomName: string): ScoutedRoomMemory | undefined {
    return Memory.scoutedRooms[roomName];
}

export function updateCachedRoomData(): void {
    // get a list of all rooms that we can currently see
    if(!Memory.scoutedRooms) Memory.scoutedRooms = {};
    const visibleRooms = Object.keys(Game.rooms);
    for(const roomName of visibleRooms){
        if(Object.keys(Memory.colonies).includes(roomName)) continue;
        updateCachedRoomDataForRoom(roomName);

        // also determine if the room is hostile/if it should be added to hostile room
    }
}

export function getCostMatrixForRoom(roomName: string): CostMatrix | undefined {
    const scoutedRoom = Memory.scoutedRooms[roomName];
    if (scoutedRoom) {
        return PathFinder.CostMatrix.deserialize(scoutedRoom.rCostMatrix);
    }
    return undefined;
}

// --- Move reservation helpers ---
export function clearMoveReservations(): void {
    Memory.moveReservations = {};
}

export function reserveMove(creepName: string, from: RoomPosition, to: RoomPosition): boolean {
    if (!Memory.moveReservations) Memory.moveReservations = {};
    if (from.roomName === to.roomName && from.x === to.x && from.y === to.y) {
        try { console.log(`[reserveMove] ignored same-tile reservation by ${creepName} from ${from.x},${from.y},${from.roomName} to ${to.x},${to.y},${to.roomName}`); } catch (e) {}
        return false;
    }
    try {
        const dx = Math.abs(from.x - to.x);
        const dy = Math.abs(from.y - to.y);
        // Reservations must be for an adjacent square (including diagonals).
        if (Math.max(dx, dy) > 1) {
            try { console.log(`[reserveMove] ignored non-adjacent reservation by ${creepName} from ${from.x},${from.y} to ${to.x},${to.y}`); } catch (e) {}
            return false;
        }
    } catch (e) {}
    // If any creep has been marked with a temporary blocked tile (set
    // by the movement coordinator to force a replan), reject attempts to
    // reserve that specific tile for the current tick. This prevents a
    // mover from immediately re-reserving a coordinator-blocked square.
    try {
        for (const name of Object.keys(Game.creeps)) {
            try {
                const c = Game.creeps[name];
                if (!c || !c.memory) continue;
                const tb = (c.memory as any).tempBlockedTile;
                if (tb && tb.tick === Game.time && tb.roomName === to.roomName && tb.x === to.x && tb.y === to.y) {
                    try { console.log(`[reserveMove] rejected reservation by ${creepName} to ${to.x},${to.y},${to.roomName} because tempBlockedTile set on ${name}`); } catch(e){}
                    return false;
                }
            } catch(e) {}
        }
    } catch (e) {}
    // Note: do not reject reservations targeting occupied tiles here —
    // allow the movement coordinator to detect conflicts once all intents
    // are published and to force replanning/cleanup. Rejecting at this
    // point creates races and prevents the coordinator from resolving
    // competing intents correctly.
    Memory.moveReservations[creepName] = {
        from: { x: from.x, y: from.y, room: from.roomName },
        to: { x: to.x, y: to.y, room: to.roomName },
        tick: Game.time
    };
    return true;
}

    // Optional lightweight task lock helper: record a brief assign tick on a task
    export function setTaskAssignTick(taskId: string, tick: number) {
        if (!Memory.tasks) return;
        const t = Memory.tasks[taskId];
        if (!t) return;
        (t as any).assignTick = tick;
    }

export function getMoveReservation(creepName: string): {from: {x:number,y:number,room:string}, to: {x:number,y:number,room:string}, tick:number} | undefined {
    return Memory.moveReservations ? Memory.moveReservations[creepName] : undefined;
}

export function getAllMoveReservations(): {[creepName: string]: {from: {x:number,y:number,room:string}, to: {x:number,y:number,room:string}, tick:number}} {
    return Memory.moveReservations || {};
}

// --- Intent collection for colony-level movement coordination ---
export function clearAllIntents(): void {
    if(!Memory.colonies) Memory.colonies = {};
    for(const roomName of Object.keys(Memory.colonies)){
        Memory.colonies[roomName].moveIntents = {};
    }
}

export function publishIntent(colonyRoom: string, creepName: string, from: RoomPosition, to: RoomPosition): void {
    if(!Memory.colonies) Memory.colonies = {};
    if(!Memory.colonies[colonyRoom]) Memory.colonies[colonyRoom] = { taskQueue: [], wallRepairThreshold: 100000 } as ColonyMemory;
    if(!Memory.colonies[colonyRoom].moveIntents) Memory.colonies[colonyRoom].moveIntents = {};
    if (from.roomName === to.roomName && from.x === to.x && from.y === to.y) {
        try { console.log(`[publishIntent] ignored same-tile intent for ${creepName} from ${from.x},${from.y},${from.roomName} to ${to.x},${to.y},${to.roomName}`); } catch (e) {}
        return;
    }
    if (from.roomName !== to.roomName) return;
    if (Math.abs(from.x - to.x) > 1 || Math.abs(from.y - to.y) > 1) return;
    Memory.colonies[colonyRoom].moveIntents![creepName] = { from: { x: from.x, y: from.y, room: from.roomName }, to: { x: to.x, y: to.y, room: to.roomName }, tick: Game.time };
}

export function getColonyIntents(colonyRoom: string): {[creepName: string]: {from: {x:number,y:number,room:string}, to: {x:number,y:number,room:string}, tick: number}} {
    if(!Memory.colonies) return {};
    const col = Memory.colonies[colonyRoom];
    if(!col || !col.moveIntents) return {};
    return col.moveIntents as {[creepName: string]: {from: {x:number,y:number,room:string}, to: {x:number,y:number,room:string}, tick: number}};
}

export function updateCachedRoomDataForRoom(roomName:string): void{
    if(!(roomName in Game.rooms)){
        console.error(`Room ${roomName} is not visible, so cannot be updated`);
        return;
    }
    let controllerObj = undefined;
    let gameController = Game.rooms[roomName].controller;
    if(gameController!==undefined){
        const id = gameController.id;
        const owner = gameController.owner?.username;
        const reserved = gameController.reservation?.username;
        const level = gameController.level;
        const safeMode = gameController.safeMode;

        controllerObj = {
            id,
            owner,
            reserved,
            level,
            safeMode
        };
    }

    let cMatrix = new PathFinder.CostMatrix();
    // create the costMatrix for the given room
    Game.rooms[roomName].find(FIND_STRUCTURES).forEach(structure => {
        if (structure.structureType === STRUCTURE_ROAD) {
            cMatrix.set(structure.pos.x, structure.pos.y, 1);
        } else if (structure.structureType !== STRUCTURE_CONTAINER && (structure.structureType !== STRUCTURE_RAMPART || !structure.my)) {
            cMatrix.set(structure.pos.x, structure.pos.y, 255);
        }
    });

    let minerals = Game.rooms[roomName].find(FIND_MINERALS).map(mineral => mineral.id);
    let mineralType = null;
    if(minerals[0]){
        mineralType = Game.getObjectById(minerals[0])?.mineralType ?? null;
    }

    Memory.scoutedRooms[roomName] = {
        lastScouted: Game.time,
        sources: Game.rooms[roomName].find(FIND_SOURCES).map(source => source.id),
        minerals: minerals.length > 0 ? minerals[0] : null,
        mineralType: mineralType,
        controller: controllerObj,
        hostiles: Game.rooms[roomName].find(FIND_HOSTILE_CREEPS).length,
        hostileStructures: Game.rooms[roomName].find(FIND_HOSTILE_STRUCTURES).map(structure => structure.id),
        terrainScore: 0,
        exits: Game.rooms[roomName].findExits(),
        rCostMatrix: cMatrix.serialize()
    }

    // determine also if the room is hostile/should be added to hostile rooms
    const hostiles = Game.rooms[roomName].find(FIND_HOSTILE_CREEPS);
    const hostileStructures = Game.rooms[roomName].find(FIND_HOSTILE_STRUCTURES).filter(s=>s.structureType==STRUCTURE_TOWER && s.store[RESOURCE_ENERGY]>500);

    if (hostiles.length > 0 && gameController && !gameController.my) {
        addHostileRoom(roomName);
    } else {
        removeHostileRoom(roomName);
    }
}


