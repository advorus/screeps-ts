import { Colony } from "colony/colony";
import { getEmpireMemory,getCreepMemory, getTaskMemory, addHostileRoom, getHostileRooms, updateCachedRoomData, getAllTaskMemory, getScoutedRoomMemory } from "core/memory";
import { TaskManager } from "core/taskManager";
import { profile } from "Profiler";
import { getAdjacentConnectedRooms } from "utils/room";

// Empire class to manage multiple colonies
// This class is responsible for high-level management of colonies, task creation, and spawning decisions
// It does not directly control creeps or tasks, but coordinates the overall empire strategy

@profile
export class Empire {
    colonies: Colony[];
    memory: EmpireMemory;
    claimTargets: string[] = [];
    dismantleTargets: string[] = [];

    constructor() {
        this.colonies = Object.values(Game.rooms)
        .filter(r=> r.controller && r.controller.my)
        .map(r=> new Colony(r));

        this.memory = getEmpireMemory();
    }

    init() {

        this.memory.lastTick = Game.time;
        if (Memory.tasks === undefined) {
            Memory.tasks = {};
        }
        for (const colony of this.colonies){
            colony.init();
        }

        Memory.scoutedRooms ??= {};

        // // delete any storage claim tasks
        // const claimTasks = Object.values(Memory.tasks).filter(t => t.type === 'WALLREPAIR');
        // for(const task of claimTasks){
        //     if(task.targetId){
        //         console.log(`Deleting claim task ${task.id} for storage`);
        //         delete Memory.tasks[task.id as string];

        //     }
        // }

        // console.log(`testing`)

        this.claimTargets = ["E7S22"]

        for(const roomName of this.claimTargets){
            //check if the colony already exists - if it does then continue
            if(this.colonies.find(c => c.room.name === roomName)) continue;

        //create a claimer task for E2S19 if it is not in colonies and a claimer task doesn't exist
            if(this.colonies.find(c => c.room.name !== roomName)) {
                if(!Object.values(Memory.tasks).find(t => t.type === 'CLAIM' && t.targetRoom === roomName)) {
                    // console.log(`Creating claim task for room ${roomName}`);
                    console.log("testing");
                    TaskManager.createTask('CLAIM', this.colonies[0].spawns[0], this.colonies[0].room.name, 5, 'claimer', roomName);
                }
            }

        }

        // if a creep is in a room which is not a colony hub, then check if there are hostiles or hostile towers in that room
        for(const creep of Object.values(Game.creeps)) {
            if(this.colonies.find(c => c.room.name === creep.room.name) === undefined) {
                const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
                const hostileTowers = creep.room.find(FIND_HOSTILE_STRUCTURES, {
                    filter: { structureType: STRUCTURE_TOWER }
                });
                if(hostiles.length > 0 || hostileTowers.length > 0) {
                    console.log(`Creep ${creep.name} is in a hostile room: ${creep.room.name}`);
                    addHostileRoom(creep.room.name);
                }
            }
        }

        if(Game.time%100==0){
            console.log(`Empire has ${this.colonies.length} colonies and ${Object.values(Memory.tasks).length} tasks`);
        }
        if((Game.time+5)%100 == 0){
            updateCachedRoomData();
        }



    }

    run() {
        // console.log(`The next room to scout for room: ${this.colonies[0].room.name} is ${this.getRoomToScout(this.colonies[0],10)}`);

        // Empire-level task creation
        TaskManager.createTasks(this);
        // console.log(`Got here`);
        TaskManager.reprioritiseTasks(this);

        // console.log(`Empire has ${Object.values(Memory.tasks).length} tasks`);
        // Empire-level spawning decision
        for (const colony of this.colonies) {
            if(!colony.room.controller) continue;
            if(colony.room.controller?.level <3 || colony.sourceContainers.length === 0) {
                if (colony.getWorkerNeed()) colony.spawnCreep('worker');
            }
            else{
                // console.log(`checking for specific worker needs`)
                if (colony.getMinerNeed()) colony.spawnCreep('miner');
                if (colony.getHaulerNeed()) colony.spawnCreep('hauler');
                if (colony.getBuilderNeed()) colony.spawnCreep('builder');
                if (colony.getUpgraderNeed()) colony.spawnCreep('upgrader');
                if (colony.getScoutNeed()) colony.spawnCreep('scout');
            }
            if(colony.spawns.length<1){
                // the first colony not with the colony names should spawn a builder, registered to the new colony name
                // @todo: this logic should be improved to find the nearest colony
                const anotherColony = this.colonies.find(c => c.room.name !== colony.room.name);
                if (anotherColony) {
                    // if the colony has less than 3 workers, spawn one and send it to the new colony
                    if(colony.creeps.filter(c => c.memory.role === 'worker').length < 3){
                        anotherColony.spawnCreep('worker', colony.room.name);
                    }
                }
            }

            if(Game.time%31 == 0){
                // check if the room has a scout task
                if(!getAllTaskMemory().find(task => task.type === 'SCOUT' && task.colony === colony.room.name)){
                    //if not, create one using the nearest room to scout
                    const nearestRoom = this.getRoomToScout(colony, 4);
                    if (nearestRoom) {
                        TaskManager.createTask("SCOUT", colony.room.controller as StructureController, colony.room.name, 1, 'scout', nearestRoom);
                    }
                }
            }
        }
        // if there is an unassigned claimer task then spawn a claimer creep
        if (TaskManager.hasUnassignedTask(this, 'CLAIM')) {
            const colony = this.colonies[0]; // Get the first colony - improve to find the nearest room to the claimer task
            colony.spawnCreep('claimer');
        }

        // Empire-level task assignment
        for (const creep of Object.values(Game.creeps)) {
            const creepMemory = getCreepMemory(creep.name);
            if (!creepMemory.taskId) {
                TaskManager.assignTask(creep);
            }
        }

        // console.log(`Got here`);
        for (const colony of this.colonies){
            // Run the colony logic, including task execution
            colony.run();
        }
    }

    post() {
        // console.log(`got here`)
        for(const name in Memory.colonies){
            if(!(name in Game.rooms)){
                delete Memory.colonies[name];
            }
        }
        for(const name in Memory.creeps){
            if(!(name in Game.creeps)){
                delete Memory.creeps[name];
            }
        }
        for(const creep in Game.creeps){
            // if the taskId is no longer in Memory.tasks, delete it from the creep's memory
            const creepMemory = getCreepMemory(creep);
            if (creepMemory.taskId && getTaskMemory(creepMemory.taskId) === undefined) {
                // console.log(`Task ${creepMemory.taskId} no longer exists, removing from creep ${creep}'s memory`);
                delete creepMemory.taskId;
            }
        }
        for(const taskId in Memory.tasks){
            const task = getTaskMemory(taskId);
            if(task.targetId!==undefined){
                const target = Game.getObjectById(task.targetId);
                if(target === null){
                    console.log(`Task ${task.id} has an invalid target ${task.targetId}`);
                    delete Memory.tasks[taskId];
                }
            }

            // remove completed tasks
            if(task.status === `DONE`) {
                // console.log(`Task ${task.id} completed and so is being deleted`);
                delete Memory.tasks[taskId];
            }
            // remove assigned creeps from tasks if the creep is no longer in the game
            if (task.assignedCreep){
                if(!(task.assignedCreep in Game.creeps)) {
                    // console.log(`Creep ${task.assignedCreep} is no longer in the game and so removing it from task`);
                    delete Memory.tasks[taskId]
                }

            }
        }

        for(const colony of this.colonies){
            if(colony.memory.creepColors===undefined) continue;
            for(const creep of Object.keys(colony.memory.creepColors)){
                if (!(creep in Game.creeps)) {
                    delete colony.memory.creepColors[creep];
                }
            }
        }

        this.memory.cpuUsage ??= [];
        this.memory.cpuUsage.push(Game.cpu.getUsed());
        if(this.memory.cpuUsage.length > 100) this.memory.cpuUsage.shift();
        const avgCpu = _.sum(this.memory.cpuUsage) / this.memory.cpuUsage.length;
        if (Game.time % 25 === 0) {
            console.log(`Empire: Average CPU usage over last 100 ticks: ${avgCpu}`);
        }

        // console.log(Game.cpu.getUsed());
    }

    getNearestColonyName(roomName: string): string | null {
        let nearestColony: Colony | null = null;
        let nearestDistance = Infinity;

        for (const colony of this.colonies) {
            const distance = Game.map.getRoomLinearDistance(colony.room.name, roomName);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestColony = colony;
            }
        }

        return nearestColony ? nearestColony.room.name : null;
    }

    getRoomToScout(colony:Colony, maxSearchDepth: number = 10): string | null{
        /**
         * Find a room to scout for the given colony.
         * Will do a breadth-first-search up to 10 tiles away and return the first available room. Consider an branch dead in the bfs if it reaches a hostile room seen in the last 3000 ticks or gets to a room in the list of colonies.
         * If no room is found, return null.
         */

        const startRoom = colony.room.name;
        const visited = new Set<string>();
        const queue: { room: string, depth: number }[] = [{ room: startRoom, depth: 0 }];

        const hostileRooms = getHostileRooms().filter(r => r.lastSeen > Game.time - 3000).map(r => r.roomName);
        const colonyRooms = this.colonies.map(c => c.room.name);

        while(queue.length>0){
            const {room,depth} = queue.shift()!;
            // console.log(`Checking room ${room} at depth ${depth}`);
            if(depth > maxSearchDepth) continue;
            if(visited.has(room)) continue;
            visited.add(room);

            if(!hostileRooms.includes(room) && !colonyRooms.includes(room)){
                let srMem = getScoutedRoomMemory(room);
                if(srMem === undefined) {
                    // console.log(`Room ${room} has not been scouted yet, returning as room to scout`);
                    return room;
                } else{
                    //need to check that it has been a while since we scouted the room
                    if(!(srMem.lastScouted > Game.time - 3000)) return room;
                }
            }

            if(hostileRooms.includes(room) || Object.keys(this.colonies).includes(room)) {
                // If we found a hostile room, we need to remember it
                continue;
            }

            // console.log(`Adjacent rooms for ${room}: ${getAdjacentConnectedRooms(room)}`);
            const adjacentRooms = getAdjacentConnectedRooms(room);
            for(const adjacentRoom of adjacentRooms){
                if(!visited.has(adjacentRoom)){
                    queue.push({ room: adjacentRoom, depth: depth + 1 });
                }
            }
        }

        return null;
    }

}

