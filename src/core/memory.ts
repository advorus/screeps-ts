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

export function getTaskMemory(taskId:string): TaskMemory {
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

export function getAllTaskMemory(): TaskMemory[] {
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

export function updateCachedRoomDataForRoom(roomName:string): void{
    if(!(roomName in Game.rooms)){
        console.error(`Room ${roomName} is not visible, so cannot be updated`);
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

    Memory.scoutedRooms[roomName] = {
        lastScouted: Game.time,
        sources: Game.rooms[roomName].find(FIND_SOURCES).map(source => source.id),
        minerals: Game.rooms[roomName].find(FIND_MINERALS).length > 0 ? Game.rooms[roomName].find(FIND_MINERALS)[0].id : null,
        controller: controllerObj,
        hostiles: Game.rooms[roomName].find(FIND_HOSTILE_CREEPS).length,
        hostileStructures: Game.rooms[roomName].find(FIND_HOSTILE_STRUCTURES).map(structure => structure.id),
        terrainScore: 0,
        exits: Game.rooms[roomName].findExits()
    }

    // determine also if the room is hostile/should be added to hostile rooms
    const hostiles = Game.rooms[roomName].find(FIND_HOSTILE_CREEPS);
    const hostileStructures = Game.rooms[roomName].find(FIND_HOSTILE_STRUCTURES).filter(s=>s.structureType==STRUCTURE_TOWER && s.store[RESOURCE_ENERGY]>500);
    if (hostiles.length > 0 || hostileStructures.length > 0) {
        addHostileRoom(roomName);
    } else {
        removeHostileRoom(roomName);
    }
}

// interface ScoutedRoomMemory {
//         lastScouted: number,
//         sources: string[];
//         minerals: string | null;
//         controller: {
//             id: string,
//             owner: string | null,
//             reserved: string|null,
//             level: number|null,
//             safeMode: boolean
//         } | null,
//         hostiles: number,
//         hostileStructures: string[];
//         terrainScore: number,
//         exits: string[]
//     }
