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
    towers: StructureTower[] = [];

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

        if(!this.memory.towerIds) {
            this.memory.towerIds = this.room.find(FIND_MY_STRUCTURES, {
                filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER
            }).map(s => s.id);
        }

        this.sources = this.memory.sourceIds
        .map(id=>Game.getObjectById(id))
        .filter((s):s is Source=>s !== null);

        this.spawns = this.memory.spawnIds
        .map(id=>Game.getObjectById(id))
        .filter((s):s is StructureSpawn=> s !== null);

        // cache creeps assigned to this colony via memory
        this.creeps = Object.values(Game.creeps).filter(c=>getCreepMemory(c.name).colony === this.room.name);

        this.towers = this.memory.towerIds
        .map(id=>Game.getObjectById(id))
        .filter((s):s is StructureTower=> s !== null);
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

        this.runTowers();
    }

    spawnCreep(role: string) {
        for(const spawn of this.spawns) {
            if(!spawn.spawning) {
                const name = `${role}_${Game.time}`;
                if(role === 'worker') {
                    const body = this.workerBodyParts();
                    const memory: CreepMemory = {role, colony:this.room.name};
                    const result = spawn.spawnCreep(body,name,{memory});
                    if(result === OK) {
                        console.log(`Spawning new worker in ${this.room.name}`);
                        return;
                    }
                }
                if(role == `miner`){
                    const body = this.minerBodyParts();
                    const memory: CreepMemory = {role, colony: this.room.name};
                }
            }
        }
    }

    workerBodyParts(): BodyPartConstant[] {
        if (this.room.energyCapacityAvailable<350){
            return [WORK, CARRY, MOVE, MOVE];
        }
        else {
            const num_work_parts = Math.floor(this.room.energyCapacityAvailable / 100);
            return Array(num_work_parts).fill(WORK).concat([MOVE, MOVE, CARRY]);
        }
    }

    minerBodyParts(): BodyPartConstant[] {
        const num_work_parts = Math.floor(this.room.energyCapacityAvailable / 100);
        return Array(num_work_parts).fill(WORK).concat(MOVE);
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

        this.createBuildingTasks();
    }

    createBuildingTasks() : void {
        const construction_sites = this.room.find(FIND_CONSTRUCTION_SITES);

        for (const site of construction_sites) {
            const existingBuildTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'BUILD' &&
                // task.targetId === site.id &&
                task.colony === this.room.name &&
                task.status !== 'DONE'
            );
            if (existingBuildTasks.length >= 1) continue; // Skip if there's already a build task for this site
            console.log(`Creating build task for ${site.id} in colony ${this.room.name}`);
            TaskManager.createTask(`BUILD`, site, this.room.name, 1);
        }
    }

    placeContainers(): void {
        /**
         * Place containers near source for mining, and one near the controller for upgrading
         * containers will only be placed from RCL 3 onwards
         */
        if (!this.room.controller) return;
        if (this.room.controller?.level < 3) return;

        for (const source of this.sources) {
            const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER
            })[0];

            if (!container) {
                const newContainer = source.pos.createConstructionSite(STRUCTURE_CONTAINER);
                console.log(`Placing container for ${source.id} in colony ${this.room.name}`);
            }
        }

        this.placeControllerContainer();
    }

    placeControllerContainer(): void {
        /**
         * places a container near the controller which will be used for upgraders to pick up from
         * also checks that no container exists before placing one
         * */
        if(!this.room.controller) return;
        if(this.room.controller.level < 3) return; // Only place container if RCL is 3 or higher

        // check whether a container exists within 4 tiles of the controller
        const existingContainer = this.room.controller.pos.findInRange(FIND_STRUCTURES, 4, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        })[0];
        if(existingContainer) return;

        // if it doesn't then place one
        const containerPos = this.room.controller.pos.findNearestOpenTile(4, 3, true, true);
        if (containerPos) {
            const newContainer = containerPos.createConstructionSite(STRUCTURE_CONTAINER);
            console.log(`Placing container for controller in colony ${this.room.name}`);
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
                    creep.safeMoveTo(target, {reusePath:15, visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
        }

    }
    runTowers() {
        const towers = this.towers;
        for (const tower of towers) {
            const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (closestHostile) {
                tower.attack(closestHostile);
            }
        }
    }
}
