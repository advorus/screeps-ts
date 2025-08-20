import {getColonyMemory,getCreepMemory, getTaskMemory} from "core/memory";
import { TaskManager } from "core/taskManager";
import "utils/roomPosition";
import "utils/move";

// Colony class to manage a single room
// This class is responsible for managing tasks, spawning creeps, and running the colony logic
// It does not directly control the empire or other colonies, but implements the details of the colony's operations

export class Colony {
    room: Room;
    memory: ColonyMemory;
    sources: Source[] = [];
    spawns: StructureSpawn[] = [];
    creeps: Creep[] = [];

    constructor(room: Room) {
        this.room = room;
        this.memory = getColonyMemory(room.name);
    }

    init() {
        // cache sources, spawns, creeps for this room
        this.memory.lastSeen = Game.time;
        if(!this.memory.sourceIds) {
            this.memory.sourceIds = this.room.find(FIND_SOURCES)
            .map(s=>s.id);
        }
        if(!this.memory.spawnIds) {
            this.memory.spawnIds = this.room.find(FIND_MY_SPAWNS)
            .map(s=>s.id);
        }
        this.sources = this.memory.sourceIds
        .map(id=>Game.getObjectById(id))
        .filter((s):s is Source=>s !== null);

        this.spawns = this.memory.spawnIds
        .map(id=>Game.getObjectById(id))
        .filter((s):s is StructureSpawn=> s !== null);

        // cache creeps assigned to this colony via memory
        this.creeps = Object.values(Game.creeps).filter(c=>getCreepMemory(c.name).colony === this.room.name);


    }

    run() {
        // placeholder: e.g. tell screeps to harvest/upgrade
        if(this.room.controller?.my){
            this.room.visual.text("Colony running",1,1);
        }

        // Assign tasks to creeps
        for(const creep of this.creeps) {
            if(getCreepMemory(creep.name).taskId) {
                this.runTask(creep);
            }
        }
    }

    spawnCreep(role: string) {
        for(const spawn of this.spawns) {
            if(!spawn.spawning) {
                const name = `${role}_${Game.time}`;
                if(role === 'worker') {
                    const body = this.workerBodyParts();
                    const memory: WorkerMemory = {role, colony:this.room.name, working:false};
                    const result = spawn.spawnCreep(body,name,{memory});
                    if(result === OK) {
                        console.log(`Spawning new worker in ${this.room.name}`);
                        return;
                    }
                }
            }
        }
    }

    workerBodyParts(): BodyPartConstant[] {
        if (this.room.energyCapacityAvailable<350){
            return [WORK, CARRY, MOVE, MOVE];
        }
        else {
            const num_carry_parts = Math.floor(this.room.energyCapacityAvailable / 100);
            return Array(num_carry_parts).fill(CARRY).concat([MOVE, MOVE, WORK]);
        }
    }

    createTasks() {
        //here we create the tasks to mine, upgrade and haul
        for(const source of this.sources){
            // get the free tiles around a source and create a harvest task for each one
            const freeTiles = source.pos.getFreeTiles();
            for(const tile of freeTiles) {
                const existingHarvestTasks = Object.values(Memory.tasks).filter(task =>
                    task.type === 'HARVEST' &&
                    task.targetId === source.id &&
                    task.colony === this.room.name &&
                    task.status !== 'DONE'
                );
                if (existingHarvestTasks.length >= freeTiles.length) continue; // Skip if there's already a harvest task for this source
                TaskManager.createTask(`HARVEST`, source, this.room.name);
            }
        }

        let existingUpgradeTasks = Object.values(Memory.tasks).filter(task =>
            task.type === 'UPGRADE' &&
            task.colony === this.room.name &&
            task.status !== 'DONE'
        ).length;

        if (!(existingUpgradeTasks > 5)){ // Skip if there's already an upgrade task for this colony
            TaskManager.createTask(`UPGRADE`, this.room.controller as StructureController, this.room.name);
            existingUpgradeTasks++;
        }

        // create some low priority upgrade tasks to fall back on
        while (existingUpgradeTasks < 5) {
            TaskManager.createTask(`UPGRADE`, this.room.controller as StructureController, this.room.name, -1);
            existingUpgradeTasks++;
        }

        // create a haul task for each spawn
        for(const spawn of this.spawns) {
            const existingHaulTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'HAUL' &&
                task.targetId === spawn.id &&
                task.colony === this.room.name &&
                task.status !== 'DONE'
            );
            if (existingHaulTasks.length >= 1) continue; // Skip if there's already a haul task for this spawn
            TaskManager.createTask(`HAUL`, spawn, this.room.name, 2); // Priority 1 for hauling to spawn
        }

        const construction_sites = this.room.find(FIND_CONSTRUCTION_SITES);

        for (const site of construction_sites) {
            const existingBuildTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'BUILD' &&
                task.targetId === site.id &&
                task.colony === this.room.name &&
                task.status !== 'DONE'
            );
            if (existingBuildTasks.length >= 1) continue; // Skip if there's already a build task for this site
            console.log(`Creating build task for ${site.id} in colony ${this.room.name}`);
            TaskManager.createTask(`BUILD`, site, this.room.name, 1);
        }
    }

    getWorkerNeed(): boolean {
        const workers = _.filter(Game.creeps, (c:Creep) =>
        (c.memory as WorkerMemory).role == 'worker' &&
        c.room.name == this.room.name
        );

        const unassignedWorkerTasks = Object.values(Memory.tasks).filter(task =>
            task.colony === this.room.name &&
            task.status === 'PENDING' &&
            !task.assignedCreep
        );

        return unassignedWorkerTasks.length > 0;

    }

    runTask(creep: Creep) {
        const taskId = getCreepMemory(creep.name).taskId;
        if (!taskId) return;

        const task = getTaskMemory(taskId);
        if (!task || task.status !== 'IN_PROGRESS') return;

        if (task.targetId === undefined) {
            console.error(`Task ${taskId} has no targetId`);
            return;
        }

        const target = Game.getObjectById(task.targetId);
        switch (task.type) {
            case 'HARVEST':
                if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.harvest(target as Source) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffaa00'}});
                }
                break;
            case 'UPGRADE':
                if (creep.store[RESOURCE_ENERGY] === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.upgradeController(target as StructureController) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
            case 'BUILD':
                if (creep.store[RESOURCE_ENERGY] === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.build(target as ConstructionSite) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
            case 'HAUL':
                // add a check that if the target is full of energy, the task is done
                if (target instanceof StructureSpawn && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.store[RESOURCE_ENERGY] === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.transfer(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
            case 'MINE':
                if (creep.harvest(target as Source) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#fffff'}});
                }
                break;
            }

    }
}
