import {getColonyMemory,getCreepMemory, getTaskMemory} from "core/memory";

import "utils/roomPosition";
import "utils/move";
import { extensionStamp, spawnStamp } from "utils/stamps";
import { ConstructionManager } from "core/constructionManager";
import { ColonyVisualizer } from "./colonyVisualiser";

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
    colonyVisualizer?: ColonyVisualizer;
    sourceContainers: StructureContainer[] = [];
    extensions: StructureExtension[] = [];
    fillerContainers: StructureContainer[] = [];
    upgradeContainers: StructureContainer[] = [];
    storage?: StructureStorage;

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

        if(!this.memory.extensionIds) {
            this.memory.extensionIds = this.room.find(FIND_MY_STRUCTURES, {
                filter: (s): s is StructureExtension => s.structureType === STRUCTURE_EXTENSION
            }).map(s => s.id);
        }
        this.memory.storageId ??= this.room.find(FIND_STRUCTURES, {
            filter: (s): s is StructureStorage => s.structureType === STRUCTURE_STORAGE
        }).map(s => s.id)[0];
        this.memory.fillerContainerIds ??= [];
        this.memory.upgradeContainerIds ??= [];
        this.memory.lastStampRCL ??= 0;
        this.memory.plannedConstructionSites ??= [];

        this.setFillerContainerIds();
        this.setUpgradeContainerIds();

        // cache creeps assigned to this colony via memory
        this.creeps = Object.values(Game.creeps).filter(c=>getCreepMemory(c.name).colony === this.room.name);

        // cache objects from IDs
        this.sources = this.memory.sourceIds.map(id=>Game.getObjectById(id)).filter((s):s is Source=>s !== null);
        this.spawns = this.memory.spawnIds.map(id=>Game.getObjectById(id)).filter((s):s is StructureSpawn=> s !== null);
        this.towers = this.memory.towerIds.map(id=>Game.getObjectById(id)).filter((s):s is StructureTower=> s !== null);
        this.extensions = this.memory.extensionIds.map(id=>Game.getObjectById(id)).filter((s):s is StructureExtension=> s !== null);
        this.fillerContainers = this.memory.fillerContainerIds.map(id=>Game.getObjectById(id)).filter((s):s is StructureContainer=> s !== null);
        this.upgradeContainers = this.memory.upgradeContainerIds.map(id=>Game.getObjectById(id)).filter((s):s is StructureContainer=> s !== null);
        this.storage = Game.getObjectById(this.memory.storageId) as StructureStorage | undefined;

        // update the source container object
        for(const source of this.sources) {
            const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure) => structure.structureType === STRUCTURE_CONTAINER
            }) as StructureContainer[];
            if (container.length > 0) {
                this.sourceContainers.push(container[0]);
            }
        }

        // Place spawn stamp if the controller level increased
        if (this.room.controller !== undefined) {
            if (this.memory.lastStampRCL < this.room.controller.level) {
                this.placeSpawnStamp();
                this.memory.lastStampRCL = this.room.controller.level;
            }
        }

        // Place construction sites if any are missing
        if (this.isMissingStructures()){
            ConstructionManager.placeConstructionSites(this.room, this.memory.plannedConstructionSites);
        }

        // Initialise visualiser
        this.colonyVisualizer = new ColonyVisualizer(this);
    }

    run() {
        // Assign tasks to creeps
        for(const creep of this.creeps) {
            if(getCreepMemory(creep.name).taskId) {
                this.runTask(creep);
            }
        }

        this.runTowers();
        this.colonyVisualizer?.run();
    }

    setFillerContainerIds(): void {
        this.memory.fillerContainerIds = [];

        //find all containers within 1 tile of a (planned) spawn
        let containers = this.room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        }) as StructureContainer[];

        //now check if the container is either within 1 tile of a spawn
        for(const spawn of this.spawns) {
            const nearbyContainers = containers.filter(c => c.pos.inRangeTo(spawn.pos, 1));
            this.memory.fillerContainerIds.push(...nearbyContainers.map(c => c.id));
        }

        //now check if any containers are within 1 tile of a spawn in the planned construction sites list
        for(const site of this.memory.plannedConstructionSites ?? []) {
            const nearbyContainers = containers.filter(c => c.pos.inRangeTo(site.pos, 1));
            this.memory.fillerContainerIds.push(...nearbyContainers.map(c => c.id));
        }
    }

    setUpgradeContainerIds(): void {
        const controller = this.room.controller;
            if (controller) {
                this.memory.upgradeContainerIds = this.room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, 4)
                }).map(s => s.id) as Id<StructureContainer>[];
            }
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

    getControllerContainer(): StructureContainer | null {
        if (!this.room.controller){
            this.placeControllerContainer();
            return null;
        }

        return this.room.controller.pos.findInRange(FIND_STRUCTURES, 4, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        })[0] as StructureContainer | null;
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
            this.memory.plannedConstructionSites ??= [];
            this.memory.plannedConstructionSites.push({pos: containerPos, structureType: STRUCTURE_CONTAINER, priority: 0});
            // const newContainer = containerPos.createConstructionSite(STRUCTURE_CONTAINER);
            console.log(`Adding planned container construction for controller in colony ${this.room.name}`);
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
            case `FILL`:
                // there is no longer any energy in the container to fill with
                if(Game.getObjectById(task.targetId)?.store[RESOURCE_ENERGY] === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if(creep.store[RESOURCE_ENERGY] === 0) {
                    // withdraw from the target
                    if (creep.withdraw(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }
                //otherwise fill the nearest in a list of spawns and extensions needing energy by range
                const targets = this.room.find(FIND_MY_STRUCTURES, {
                    filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                });
                if (targets.length > 0) {
                    const closest = creep.pos.findClosestByRange(targets);
                    if (closest) {
                        if (creep.transfer(closest, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                            creep.safeMoveTo(closest, {visualizePathStyle: {stroke: '#ffffff'}});
                        }
                    }
                }
            case `PICKUP`:
                //pickup from the target
                if (creep.store.getFreeCapacity() === 0) {
                    delete creep.memory.taskId;
                    task.status = `DONE`;
                    break;
                }
                if (creep.pickup(target as Resource) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
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

    placeStampIntoMemory(anchor: RoomPosition, stamp: {dx:number, dy:number, structureType: BuildableStructureConstant}[]) {
        /**
         * Places a stamp into the planned construction sites array.
         */
        for (const {dx, dy, structureType} of stamp) {
            const pos = new RoomPosition(anchor.x + dx, anchor.y + dy, anchor.roomName);
            if(!this.memory.plannedConstructionSites) return;
            // check if there is a matching construction site in memory
            const existingSite = this.memory.plannedConstructionSites.find(site => site.pos.isEqualTo(pos) && site.structureType === structureType);
            if(!existingSite) {
                // Otherwise, we need to create a new site
                //the site priority should be the distance to the closest spawn, found by iterating over the spawns and taking the minimum
                const site_priority = Math.min(...this.spawns.map(spawn => spawn.pos.getRangeTo(pos)));
                this.memory.plannedConstructionSites.push({
                    pos: pos,
                    structureType: structureType,
                    priority: site_priority
                });
            }
        }
    }

    placeSpawnStamp() {
        /**
         * this will place the central spawn stamp overfit on the existing spawn (assuming there is only one in the room), and puts the structures
         * into the memory as building sites which need to be placed. These building sites will then be called
         * from the list as/when possible based on RCL from the construction manager and placed onto the map.
         */
        if(!this.spawns[0]) return;
        // check if any of the potential anchor points from the current spawn enable the stamp to be placed. if not throw an error
        const potential_anchors: RoomPosition[] = [];
        const spawnPos = this.spawns[0].pos;
        potential_anchors.push(new RoomPosition(spawnPos.x+2, spawnPos.y-1, spawnPos.roomName));
        potential_anchors.push(new RoomPosition(spawnPos.x-2, spawnPos.y-1, spawnPos.roomName));
        potential_anchors.push(new RoomPosition(spawnPos.x, spawnPos.y+2, spawnPos.roomName));

        //check each anchor to see if it is at the centre of a free 7x7 block (ignore any structure which fits the stamp)
        for (const anchor of potential_anchors) {
            if (anchor.canPlaceStamp(spawnStamp)) {
                this.placeStampIntoMemory(anchor, spawnStamp);
                break;
            }
        }
    }

    isMissingStructures(): boolean {
        for(const structure_constant of Object.keys(CONTROLLER_STRUCTURES) as BuildableStructureConstant[]){
            if (structure_constant !== STRUCTURE_CONTAINER) {
                const existing_structures = this.room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType === structure_constant});
                const existing_construction_sites = this.room.find(FIND_CONSTRUCTION_SITES, {filter: (s) => s.structureType === structure_constant});
                if (existing_structures.length + existing_construction_sites.length < CONTROLLER_STRUCTURES[structure_constant][this.room.controller?.level || 0]) {
                    return true;
                }
            }
        }
        return false;
    }

}

