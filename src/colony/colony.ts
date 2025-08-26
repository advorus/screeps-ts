import {getAllTaskMemory, getColonyMemory,getCreepMemory, getScoutedRoomMemory, getTaskMemory, updateCachedRoomDataForRoom} from "core/memory";

import "utils/roomPosition";
import "utils/move";
import { coreStamp, extensionStamp, labStamp, spawnStamp, towerStamp } from "utils/stamps";
import { ConstructionManager } from "core/constructionManager";
import { ColonyVisualizer } from "./colonyVisualiser";
import {profile} from "Profiler";

// Colony class to manage a single room
// This class is responsible for managing tasks, spawning creeps, and running the colony logic
// It does not directly control the empire or other colonies, but implements the details of the colony's operations

@profile
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
    spawnsAvailableForSpawning: StructureSpawn[] = [];

    constructor(room: Room) {
        this.room = room;
        this.memory = getColonyMemory(room.name);
    }

    init() {
        // this.clearPlannedConstructionSites();
        // this.memory.lastStampRCL = 2;

        // // count the number of planned construction sites at each room position
        // const plannedConstructionSitesCount = new Map<string, number>();
        // for (const site of this.memory.plannedConstructionSites || []) {
        //     const key = `${site.pos.x},${site.pos.y},${site.pos.roomName}`;
        //     plannedConstructionSitesCount.set(key, (plannedConstructionSitesCount.get(key) || 0) + 1);
        // }
        // // log any overlapping construction sites
        // for (const [key, count] of plannedConstructionSitesCount) {
        //     if (count > 1) {
        //         console.log(`Found ${count} overlapping construction sites at ${key}}`);
        //     }
        // }

        // cache sources, spawns, creeps for this room
        this.memory.wallRepairThreshold = 100000;

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
            this.memory.towerIds = this.room.find(FIND_STRUCTURES, {
                filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER
            }).map(s => s.id);
        }
        this.memory.repairTargets ??= [];


        this.updateTowerIds();

        this.memory.extensionIds ??= [];
        this.updateExtensionIds();
        this.updateSpawnIds();

        this.memory.storageId = this.room.find(FIND_STRUCTURES, {
            filter: (s): s is StructureStorage => s.structureType === STRUCTURE_STORAGE
        }).map(s => s.id)[0];
        this.storage = Game.getObjectById(this.memory.storageId) as StructureStorage | undefined;

        this.memory.fillerContainerIds ??= [];
        this.memory.upgradeContainerIds ??= [];
        this.memory.lastStampRCL ??= 0;
        this.memory.plannedConstructionSites ??= [];
        this.memory.focusOnUpgrade ??= false;
        this.memory.haulerPartsNeeded ??= 0;

        this.setFocusOnUpgrade();
        this.setFillerContainerIds();
        this.setUpgradeContainerIds();
        // this.updateStorage();

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

        // console.log(`got here for room ${this.room.name}`);

        this.updateSpawnsForSpawning();

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
            if (this.memory.lastStampRCL < this.room.controller.level && this.room.controller.level > 2) {
                //update the stamp level
                this.memory.lastStampRCL = this.room.controller.level;

                // check if there are three spawns either built or planned
                if(this.getTotalStructuresIncludingPlanned(STRUCTURE_SPAWN) < 3){
                    this.placeSpawnStamp();
                    console.log("Placed spawn stamp for colony " + this.room.name);
                }

                // place containers (source and upgrader) at level 3
                if(this.room.controller.level == 3) {
                    this.placeContainers();
                    console.log("Placed container stamps for colony " + this.room.name);
                }

                // this stamp includes the key structures
                if(this.getTotalStructuresIncludingPlanned(STRUCTURE_NUKER)<1){
                    this.placeCoreStamp();
                    console.log("Placed core stamp for colony " + this.room.name);
                }

                // this stamp includes all towers
                if(this.getTotalStructuresIncludingPlanned(STRUCTURE_TOWER) < 5){
                    this.placeTowerStamp();
                    console.log("Placed tower stamp for colony " + this.room.name);
                }

                // continue to place extension stamps until the total number have been planned
                while(this.getTotalStructuresIncludingPlanned(STRUCTURE_EXTENSION)<CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][8]){
                    this.placeExtensionStamp();
                }

                if(this.getTotalStructuresIncludingPlanned(STRUCTURE_LAB) < 1){
                    const labStampLocation = this.spawns[0].pos.findNearestValidStampLocation(labStamp);
                    if(labStampLocation !== null){
                        this.placeStampIntoMemory(labStampLocation, labStamp);
                        console.log("Placed lab stamp for colony " + this.room.name);
                    }
                }
            }
        }

        // Place construction sites if we are missing them on the map
        if (this.isMissingStructures()){
            ConstructionManager.placeConstructionSites(this.room, this.memory.plannedConstructionSites);
        }

        if(Game.time%30==0){
            this.updateHaulerPartsNeeded();
            this.updateRepairTargets();
            this.updateWallRepairThreshold();
        }

        // Initialise visualiser
        this.colonyVisualizer = new ColonyVisualizer(this);

    }

    run() {
        // console.log(`Hauler parts needed for ${this.room.name}: ${this.memory.haulerPartsNeeded}`);
        // Assign tasks to creeps
        for(const creep of this.creeps) {
            if(getCreepMemory(creep.name).taskId) {
                this.runTask(creep);
            } else{
                // console.log(`Colony ${this.room.name} has a creep ${creep.name} that is not assigned a task`);
                //if sitting next to a source then move away from it
                for(let source of this.sources){
                    //check if the creep is near that source;
                    //if it is then move away
                    if(creep.pos.isNearTo(source.pos)){
                        // console.log(`Colony ${this.room.name} has a creep ${creep.name} that is sitting next to a source`);
                        //find the nearest path that takes the creep more than 1 tile away from the source
                        let path = PathFinder.search(creep.pos, {pos: source.pos, range:2}, {flee:true}).path;
                        // console.log(path);
                        creep.moveByPath(path);
                        break;
                    }
                }
            }
        }

        this.runTowers();
        this.colonyVisualizer?.run();
    }

    updateWallRepairThreshold():void{
        const wallsNeedingRepair = this.room.find(FIND_STRUCTURES, {filter: s=> (s.structureType===STRUCTURE_WALL || s.structureType===STRUCTURE_RAMPART)&&s.hits<this.memory.wallRepairThreshold});
        if(wallsNeedingRepair.length == 0){
            if(this.room.controller!==undefined){
                this.memory.wallRepairThreshold = Math.min(this.memory.wallRepairThreshold + 100000, Math.max(this.room.controller.level-2,1)*300e3);
            }
        }
    }

    updateRepairTargets(): void {
        //delete any repair targets with structure hits == hitsMax
        if(this.memory.repairTargets === undefined) return;
        for(const {id, active} of this.memory.repairTargets) {
            const structure = Game.getObjectById(id) as AnyStructure | null;
            if(structure && structure.hits === structure.hitsMax) {
                this.memory.repairTargets = this.memory.repairTargets.filter(t => t.id !== id);
            }
        }

        const structureToRepair = this.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART && s.hits < 0.75 * s.hitsMax
        });

        for(const structure of structureToRepair){
            if(!this.memory.repairTargets.find(t => t.id === structure.id)){
                this.memory.repairTargets.push({id: structure.id, active: true});
            }
        }
    }

    updateSpawnIds(): void {
        this.memory.spawnIds = this.room.find(FIND_MY_SPAWNS).map(s => s.id);
    }

    updateHaulerPartsNeeded(): void {
        // console.log(`Updating hauler parts needed for ${this.room.name}`);
        if(this.room.controller === undefined){
            this.memory.haulerPartsNeeded = 0;
            return
        }
        if(this.room.controller?.level<3){
            this.memory.haulerPartsNeeded = 0;
            return;
        }
        let haulerPartsNeeded = 0;
        for(const source of this.sources){
            let existingMinerParts = 0;
            // check if there is a mining task assigned
            const miningTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'MINE' && task.targetId === source.id && task.status === 'IN_PROGRESS'
            );
            // for each miningTask check how many mining parts exist on the assigned creep
            for(const miningTask of miningTasks){
                if(miningTask.assignedCreep){
                    const creep = Game.creeps[miningTask.assignedCreep];
                    if(creep){
                        const numMiningParts = creep.body.filter(part => part.type === WORK).length;
                        // for each mining part, we need 2 carry parts to transport the energy
                        existingMinerParts += numMiningParts;
                    }
                }
            }
            // get the path to the source
            let haulTarget = this.room.storage?.pos;
            if(!this.room.storage){
                haulTarget = this.spawns[0].pos;
            }
            haulTarget??= new RoomPosition(25,25,this.room.name);
            const pathToSource = PathFinder.search(haulTarget, source.pos).path;
            const timeToSource = pathToSource.length;
            // calculate the time taken to return from the source given the 2:1 carry/move ratio
            // takes 2 ticks to traverse plain, 1 tick to traverse road,
            const timeFromSource = pathToSource.reduce((acc, pos) => {
                const terrain = Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y);
                if (terrain === TERRAIN_MASK_SWAMP) {
                    return acc + 10;
                } else {
                    return acc + 2;
                }
            }, 0);
            const roundTripTime = timeToSource + timeFromSource;
            // the number of carry parts needed is minerparts*2*roundTripTime
            haulerPartsNeeded += existingMinerParts * 2 * roundTripTime / 50;
        }
        this.memory.haulerPartsNeeded = haulerPartsNeeded;
    }

    getTotalStructuresExcludingPlanned(structure_type: StructureConstant): number {
        /**
         * returns the number of structures of that type on the map (includes existing structures and those still in construction site form)
         */
        const numExistingStructures = this.room.find(FIND_STRUCTURES, {filter: s=> s.structureType == structure_type}).length;
        const numStructureSites = this.room.find(FIND_CONSTRUCTION_SITES, {filter: s=> s.structureType == structure_type}).length;
        return numExistingStructures+numStructureSites;
    }

    getTotalStructuresIncludingPlanned(structure_type: StructureConstant): number {
        /**
         * returns the number of structures of that type on the map and those in memory (planned construction sites)
         */
        const numPlannedSites = this.memory.plannedConstructionSites?.filter(s=> s.structureType==structure_type).length;
        return this.getTotalStructuresExcludingPlanned(structure_type)+(numPlannedSites??0);
    }

    clearPlannedConstructionSites(): void {
        this.memory.plannedConstructionSites = [];
    }

    updateTowerIds(): void {
        this.memory.towerIds = this.room.find(FIND_STRUCTURES, {
            filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER
        }).map(s => s.id);
    }

    updateSpawnsForSpawning(): void {
        this.spawnsAvailableForSpawning = this.spawns.filter(s => !s.spawning);
    }

    updateExtensionIds(): void {
        this.memory.extensionIds = this.room.find(FIND_STRUCTURES, {
            filter: (s): s is StructureExtension => s.structureType === STRUCTURE_EXTENSION
        }).map(s => s.id);
    }

    setFocusOnUpgrade(): void {
        if(this.room.controller){
            if (this.room.controller.ticksToDowngrade < 4000) {
                this.memory.focusOnUpgrade = true;
            }
            if (this.room.controller.ticksToDowngrade > 8000) {
                this.memory.focusOnUpgrade = false;
            }
        }
    }

    setFillerContainerIds(): void {
        this.memory.fillerContainerIds = [];
        // console.log(`filler container ids for ${this.room.name} are ${this.memory.fillerContainerIds}`);
        //find all containers within 1 tile of a (planned) spawn
        let containers = this.room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        }) as StructureContainer[];

        for(const container of containers) {
            for(const spawn of this.spawns){
                if(container.pos.isNearTo(spawn.pos)){
                    if(!(container.id in this.memory.fillerContainerIds)) {
                        this.memory.fillerContainerIds.push(container.id);
                    }
                    break;
                }
            }
            const plannedSpawns = this.memory.plannedConstructionSites?.filter(s => s.structureType === STRUCTURE_SPAWN) ?? [];
            for(const site of plannedSpawns) {
                const sitePos = new RoomPosition(site.pos.x, site.pos.y, site.pos.roomName);
                if(container.pos.isNearTo(sitePos)){
                    if(!(container.id in this.memory.fillerContainerIds)) {
                        this.memory.fillerContainerIds.push(container.id);
                    }
                    break;
                }
            }


        }

        // //now check if the container is either within 1 tile of a spawn
        // for(const spawn of this.spawns) {
        //     const nearbyContainers = containers.filter(c => c.pos.inRangeTo(spawn.pos, 1));
        //     this.memory.fillerContainerIds.push(...nearbyContainers.map(c => c.id));
        // }

        // //now check if any containers are within 1 tile of a spawn in the planned construction sites list
        // for(const site of this.memory.plannedConstructionSites ?? []) {
        //     const nearbyContainers = containers.filter(c => c.pos.inRangeTo(site.pos, 1));
        //     this.memory.fillerContainerIds.push(...nearbyContainers.map(c => c.id));
        // }
    }

    setUpgradeContainerIds(): void {
        const controller = this.room.controller;
            if (controller) {
                this.memory.upgradeContainerIds = this.room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, 4)
                }).map(s => s.id) as Id<StructureContainer>[];
            }
    }

    spawnCreep(role: string, colonyName?: string|undefined) : void {
        for(const spawn of this.spawnsAvailableForSpawning) {
            const spawnIndex = this.spawnsAvailableForSpawning.indexOf(spawn);
            const name = `${role}_${Game.time}_${this.room.name}`;
            if(role === 'worker' || role===`builder` || role===`upgrader`) {
                const body = this.workerBodyParts();
                // console.log(`trying to spawn new worker with body ${body}`);
                if(colonyName === undefined){
                    colonyName = this.room.name;
                }
                const memory: CreepMemory = {role, colony:colonyName};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new worker in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role == `miner`){
                const body = this.minerBodyParts();
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new miner in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role==`claimer`){
                const body = [CLAIM, MOVE];
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new claimer in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role==`hauler`){
                // console.log(`trying to spawn a hauler in room ${this.room.name}`);
                // const body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE];
                // const body = Array.from({ length: this.room.energyAvailable/150}, () => [CARRY,CARRY,MOVE]).flat();
                const body = this.haulerBodyParts();
                // console.log(body);
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new hauler in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role==`scout`){
                const body = [TOUGH,TOUGH,TOUGH,MOVE,MOVE];
                // console.log(body);
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new scout in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
        }
    }
    haulerBodyParts(): BodyPartConstant[] {
        const multiples = Math.min(Math.floor(this.room.energyAvailable/150),7);
        let body: BodyPartConstant[] = [];

        for(let i=0;i<multiples;i++){
            body.push(CARRY);
            body.push(CARRY);
            body.push(MOVE);
        }
        return body;
    }
    workerBodyParts(): BodyPartConstant[] {
        if (this.room.energyAvailable<350){
            return [WORK, CARRY, MOVE, MOVE];
        }
        else {
            const num_work_parts = Math.min(Math.floor((this.room.energyAvailable) / 200),5);
            const body: BodyPartConstant[] = [];
            for(let i=0;i<num_work_parts;i++){
                body.push(WORK);
                body.push(CARRY);
                body.push(MOVE);
            }
            // console.log(`Colony ${this.room.name} is spawning a worker with body: ${body}`);
            return body;
        }
    }

    minerBodyParts(): BodyPartConstant[] {
        const num_work_parts = Math.max(Math.min(Math.floor((this.room.energyAvailable-50) / 100),5), 1);
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
            //also check for either a planned container or an existing container construction site
            const existingContainerConstructionSite = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER
            })[0];
            //also check for either a planned container or an existing container construction site
            const existingPlannedContainer = this.memory.plannedConstructionSites?.find(s => {
                const containerPos = new RoomPosition(s.pos.x, s.pos.y, s.pos.roomName);
                return s.structureType === STRUCTURE_CONTAINER && containerPos.isNearTo(source.pos);
            });

            if (!container && !existingContainerConstructionSite && !existingPlannedContainer) {
                const nearestOpenTile = source.pos.findNearestOpenTile(1, 1, true, true);
                if (nearestOpenTile!==null){
                    const newContainer = this.memory.plannedConstructionSites?.push({
                        pos: nearestOpenTile,
                        structureType: STRUCTURE_CONTAINER,
                        priority: 0
                    });
                }
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

        const existingContainerSite = this.room.controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 4, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        })[0];

        const existingPlannedContainer = this.memory.plannedConstructionSites?.find(s => {
            const containerPos = new RoomPosition(s.pos.x, s.pos.y, s.pos.roomName);
            //get the distance of the container to the controller
            if(this.room.controller) {
                const distance = containerPos.getRangeTo(this.room.controller.pos);
                return s.structureType === STRUCTURE_CONTAINER && distance < 4;
            }
            return false;
        });
        if(existingContainerSite) return;
        if(existingPlannedContainer) return;

        // if it doesn't then place one
        const containerPos = this.room.controller.pos.findNearestOpenTile(4, 3, true, true);
        if (containerPos) {
            this.memory.plannedConstructionSites ??= [];
            this.memory.plannedConstructionSites.push({pos: containerPos, structureType: STRUCTURE_CONTAINER, priority: 0});
            // const newContainer = containerPos.createConstructionSite(STRUCTURE_CONTAINER);
            console.log(`Adding planned container construction for controller in colony ${this.room.name}`);
        }
    }

    getBuilderNeed(): boolean {
        const builders = this.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'builder'
        });
        const constructionSites = this.room.find(FIND_CONSTRUCTION_SITES);
        return builders.length < 1 && constructionSites.length > 0;
    }

    getUpgraderNeed(): boolean {
        const upgraders = this.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'upgrader'
        });
        if (this.storage !== undefined && this.storage !== null){
            const targetUpgraders = Math.min(Math.max(this.storage.store[RESOURCE_ENERGY] / 40e3, 1), 10);
            return targetUpgraders > upgraders.length;
        }
        else{
            return upgraders.length < 5 && this.room.controller !== undefined;
        }
    }

    getMinerNeed(): boolean {
        /**
         * Checks if the colony wants to spawn a miner, based on the number of source containers and existing miners
         * @todo: if a miner is close to death then spawn one so that it can start heading towards the site?
         */
        // console.log(`Checking ${this.room.name} for miner need: ${this.sourceContainers.length} source containers and ${this.room.find(FIND_MY_CREEPS, { filter: (c) => c.memory.role === 'miner' }).length} existing miners`);
        const miners = this.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'miner'
        });

        return miners.length < this.sourceContainers.length;
    }

    getPorterNeed(): boolean {
        /**
         * checks if a 'porter' needs to be spawned to move energy from storage to the filler and upgrader containers
         */
        const porters = this.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'porter'
        });
        if(this.storage!== undefined && this.storage.store[RESOURCE_ENERGY] > 0 && (this.sourceContainers.find(s=>s.store[RESOURCE_ENERGY]<s.store.getCapacity(RESOURCE_ENERGY))||this.upgradeContainers.find(s=>s.store[RESOURCE_ENERGY]<s.store.getCapacity(RESOURCE_ENERGY)))) {
            return porters.length < 1;
        }
        else{
            return false;
        }
    }

    getHaulerNeed(): boolean {
        // for each source, need to calculate the number of hauler parts required, which is a function of the number of mining parts
        // assigned to the mining task at each one


        // get the number of existing haul parts, filter Game.creeps by those assigned to this colony
        let existingHaulerParts = 0;
        for(let creepName in Game.creeps){
            const creep = Game.creeps[creepName];
            if(creep.memory.role === 'hauler' && creep.memory.colony === this.room.name){
                // add the number of carry parts to the existingHaulerParts
                existingHaulerParts += creep.body.filter(part => part.type === CARRY).length;
            }
        }

        // console.log(`Number of haul parts needed/existing is ${this.memory.haulerPartsNeeded ?? 0} / ${existingHaulerParts}`)
        return (this.memory.haulerPartsNeeded ?? 0) > existingHaulerParts;
    }

    getScoutNeed(): boolean {
        const scouts = this.creeps.filter(c=>c.memory.role === `scout`);
        // console.log(`Colony ${this.room.name} has ${scouts.length} scouts`);
        const scoutTasks = getAllTaskMemory().filter(t=>t.type === `SCOUT` && t.colony === this.room.name);
        // console.log(`Colony ${this.room.name} has ${scoutTasks.length} scout tasks`);
        // console.log(`Colony ${this.room.name} needs a scout: ${scouts.length < 1 && scoutTasks.length > 0}`);
        return scouts.length < 1 && scoutTasks.length > 0;

    }

    getWorkerNeed(): boolean {
        const workers = this.creeps.filter(c=> c.memory.role == `worker`);
        const unassignedWorkerTasks = Object.values(Memory.tasks).filter(task =>
            task.colony === this.room.name &&
            task.status === 'PENDING' &&
            !task.assignedCreep
        );

        // console.log(`Colony ${this.room.name} has ${workers.length} workers and ${unassignedWorkerTasks.length} unassigned worker tasks`);

        const miners = this.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === 'miner'
        });

        if (workers.length < 10){
            // console.log(`in here`);
            if(miners.length>0){
                if (workers.length < 6) {
                    return true;
                }
            }
            return unassignedWorkerTasks.length > 0;
        }
        else{
            return false
        }

    }

    runTask(creep: Creep) {
        const taskId = getCreepMemory(creep.name).taskId;
        if (!taskId) return;

        const task = getTaskMemory(taskId);
        if (!task || task.status !== 'IN_PROGRESS') return;

        if (task.targetId === undefined) {
            console.log(`Task ${taskId} of type ${task.type} has no targetId`);
            task.status = `DONE`;
            delete creep.memory.taskId;
            return;
        }

        const target = Game.getObjectById(task.targetId);
        if (target === undefined) {
            console.log(`Task ${taskId} of type ${task.type} has invalid targetId`);
            task.status = `DONE`;
            delete creep.memory.taskId;
            return;
        }

        // console.log(`Running ${task.type} task for creep ${creep.name}`);
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
                // if there is an upgrade container in the room, pickup from there and upgrade similar to the fill task
                // console.log(this.upgradeContainers)
                if (this.upgradeContainers.length>0){
                    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                        // console.log(`Creep ${creep.name} is full of energy, switching to working`);
                        // mark the creep as working
                        creep.memory.working = true;
                    }
                    //if the creep energy store is empty then change to not working
                    if (creep.store[RESOURCE_ENERGY] === 0) {
                        task.status = `DONE`;
                        delete creep.memory.taskId;
                        creep.memory.working = false;
                        break;
                    }
                    // console.log(creep.memory.working);
                    if(creep.memory.working){
                        // upgrade the controller, if not in range move to it
                        // console.log(`Creep ${creep.name} is upgrading the controller`);
                        if (creep.upgradeController(target as StructureController) === ERR_NOT_IN_RANGE) {
                            creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                        }
                    }
                    else {
                    // filter the list of containers to ones with energy
                        const container = this.upgradeContainers.filter(s=>s.store[RESOURCE_ENERGY] > 0)[0];
                        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                            creep.safeMoveTo(container, {visualizePathStyle: {stroke: '#ffffff'}});
                        }
                    }
                } else{
                    if (creep.store[RESOURCE_ENERGY] === 0) {
                        task.status = `DONE`;
                        delete creep.memory.taskId;
                        break;
                    }
                    // console.log(`Creep ${creep.name} is upgrading the controller`);
                    if (creep.upgradeController(target as StructureController) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                    break;
                }
                break;
            case 'BUILD':
                if (Game.getObjectById(task.targetId) === null) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.store[RESOURCE_ENERGY] === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.build(target as ConstructionSite) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
            case "REPAIR":
                if(Game.getObjectById(task.targetId)?.hits === Game.getObjectById(task.targetId)?.hitsMax) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (Game.getObjectById(task.targetId) === null) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.store[RESOURCE_ENERGY] === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
            case 'HAUL':
                // add a check that if the target is full of energy, the task is done
                // creep.say(`Checking HAUL task for creep ${creep.name} and target ${target.id}`);
                if (target instanceof StructureSpawn && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if(target instanceof StructureContainer && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if(target instanceof StructureExtension && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if(target instanceof StructureTower && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
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
                //find the source container next to the source
                const sourceContainer = this.room.find(FIND_STRUCTURES, {
                    filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.pos.isNearTo(target)
                })[0];
                if(!creep.pos.isEqualTo(sourceContainer.pos)) {
                    creep.moveTo(sourceContainer.pos);
                }else{
                    creep.harvest(target as Source);
                }
                // if (creep.harvest(target as Source) === ERR_NOT_IN_RANGE) {
                //     creep.safeMoveTo(target, {reusePath:15, visualizePathStyle: {stroke: '#ffffff'}});
                // }
                break;
            case `FILL`:
                // there is no longer any energy in the container to fill with
                if(creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    if(Game.getObjectById(task.targetId)?.store[RESOURCE_ENERGY] === 0) {
                        task.status = `DONE`;
                        delete creep.memory.taskId;
                        console.log(`Creep ${creep.name} has completed FILL task for ${target.id}`);
                        break;
                    }
                    creep.memory.working = false;
                    // withdraw from the target
                }
                if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 || Game.getObjectById(task.targetId)?.store[RESOURCE_ENERGY] === 0) {
                    creep.memory.working = true;
                }
                if (creep.memory.working) {
                    // console.log(`Creep ${creep.name} is working on filling`);
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
                    else {
                        // there is nowhere left to fill energy with
                        task.status = `DONE`;
                        delete creep.memory.taskId;
                        break;
                    }
                }
                else {

                    // console.log(`Creep ${creep.name} withdrawing from container ${target.id}`);
                    if (creep.withdraw(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }
                break;
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
                if(creep.withdraw(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
            case `SCOUT`:
                if(task.targetRoom!== undefined){

                    let srMem = getScoutedRoomMemory(task.targetRoom);
                    // console.log(`Room ${task.targetRoom} has scouted memory ${JSON.stringify(srMem)}`);
                    if(srMem!== undefined){
                        // console.log(`Room ${task.targetRoom} was last scouted at ${srMem.lastScouted}`);
                        if(srMem.lastScouted!== undefined){
                            if(srMem.lastScouted + 1000 > Game.time){
                                delete creep.memory.taskId;
                                task.status = `DONE`;
                                break;
                            }
                        }
                    }
                }
                if(creep.room.name !== task.targetRoom || !creep.pos.isInsideRoom()) {
                    creep.safeMoveTo(new RoomPosition(25, 25, task.targetRoom??creep.room.name), {visualizePathStyle: {stroke: '#ffffff'}});
                }
                else {
                    updateCachedRoomDataForRoom(task.targetRoom);
                    delete creep.memory.taskId;
                    task.status = `DONE`;
                    break;
                }
                break;
            case `CLAIM`:
                // if we own the controller in the room then the task is done
                if((creep.room.name == task.targetRoom) && Game.rooms[task.targetRoom]?.controller?.my){
                    delete creep.memory.taskId;
                    task.status = `DONE`;
                    break;
                }
                // if we can't claim the controller then move towards it
                if(task.targetRoom !== undefined){
                    // console.log(creep.pos.isInsideRoom());
                    if(creep.room.name != task.targetRoom || !creep.pos.isInsideRoom()){
                        // console.log(`Creep at position ${creep.pos} to claim room ${task.targetRoom}`);
                        creep.moveTo(new RoomPosition(25, 25, task.targetRoom), {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                    if (creep.claimController(Game.rooms[task.targetRoom]?.controller as StructureController) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(Game.rooms[task.targetRoom]?.controller as StructureController, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }

                break;
            case `DISMANTLE`:
                if(!creep.memory.colony) {
                    console.log(`Creep at ${creep.pos} is not assigned to a colony`);
                    break;
                }
                if(!creep.memory.taskId) break;

                const taskMem = getTaskMemory(creep.memory.taskId);

                if(taskMem.targetRoom == undefined) break;
                if(taskMem.targetId === undefined) break;

                if(creep.room.name !== taskMem.targetRoom || !creep.pos.isInsideRoom()) {
                    // move to the colony
                    creep.safeMoveTo(new RoomPosition(25, 25, taskMem.targetRoom), {visualizePathStyle: {stroke: '#ffffff'}});
                }
                else{

                    if(creep.dismantle(Game.getObjectById(taskMem.targetId) as Structure) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(Game.getObjectById(taskMem.targetId) as Structure, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }
                if(Game.getObjectById(taskMem.targetId) === null || Game.getObjectById(taskMem.targetId)?.hits === 0) {
                    delete creep.memory.taskId;
                    task.status = `DONE`;
                }

                break;
            case `WALLREPAIR`:
                if(creep.store[RESOURCE_ENERGY] === 0) {
                    delete creep.memory.taskId;
                    task.status = `DONE`;
                    break;
                }
                if (Game.getObjectById(task.targetId) === null) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                    creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
                break;
        }
        // console.log(`Status of task ${task.id}: ${task.status}`);

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

    placeTowerStamp() {
        /**
         * Similar logic to the corestamp - place the tower stamp at the nearest free point spiralling away from spawn
         */
        if(!this.spawns[0]) return;
        // now spiral outwards from here, checking at each location (which isn't a wall) if the core stamp will fit with that position as the anchor
        const spawnPos = this.spawns[0].pos;
        const searchRadius = 25;
        for (let r = 1; r <= searchRadius; r++) {
            for (let x = -r; x <= r; x++) {
                for (let y = -r; y <= r; y++) {
                    if(Math.abs(x)!==r && Math.abs(y)!==r) continue; // Only check the outer ring of the square
                    const pos = new RoomPosition(spawnPos.x + x, spawnPos.y + y, spawnPos.roomName);
                    if (pos.canPlaceStamp(towerStamp)) {
                        this.placeStampIntoMemory(pos, towerStamp);
                        console.log(`Placed tower stamp for colony ${this.room.name} at ${pos}`);
                        // console.log(this.memory.plannedConstructionSites);
                        return;
                    }
                }
            }
        }
    }

    placeCoreStamp() {
        /**
         * Finds the spot nearest to the spawn which will fit the core stamp and then places it there.
         */
        if(!this.spawns[0]) return;
        // now spiral outwards from here, checking at each location (which isn't a wall) if the core stamp will fit with that position as the anchor
        const spawnPos = this.spawns[0].pos;
        const searchRadius = 25;
        for (let r = 1; r <= searchRadius; r++) {
            for (let x = -r; x <= r; x++) {
                for (let y = -r; y <= r; y++) {
                    if(Math.abs(x)!==r && Math.abs(y)!==r) continue; // Only check the outer ring of the square
                    const pos = new RoomPosition(spawnPos.x + x, spawnPos.y + y, spawnPos.roomName);
                    if (pos.canPlaceStamp(coreStamp)) {
                        this.placeStampIntoMemory(pos, coreStamp);
                        console.log(`Placed core stamp for colony ${this.room.name} at ${pos}`);
                        // console.log(this.memory.plannedConstructionSites);
                        return;
                    }
                }
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
            const existingSite = this.memory.plannedConstructionSites.find(site => {
                const sitePos = new RoomPosition(site.pos.x, site.pos.y, site.pos.roomName);
                return sitePos.isEqualTo(pos) && site.structureType === structureType;
            });
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

    placeExtensionStamp(allowOverlayExcRoads: boolean = false): void {
        /**
         * Places an extension stamp at the nearest possible point, spiralling out from spawn
         */
        if(!this.spawns[0]) return;
        const spawnPos = this.spawns[0].pos;
        const maxRadius = 25;
        for(let r = 1; r <= maxRadius; r++) {
            for (let x = -r; x <= r; x++) {
                for (let y = -r; y <= r; y++) {
                    if(Math.abs(x)!==r && Math.abs(y)!==r) continue; // Only check the outer ring of the square
                    const pos = new RoomPosition(spawnPos.x + x, spawnPos.y + y, spawnPos.roomName);
                    if (pos.canPlaceStamp(extensionStamp, allowOverlayExcRoads)) {
                        this.placeStampIntoMemory(pos, extensionStamp);
                        console.log(`Placed extension stamp for colony ${this.room.name} at ${pos}`);
                        // console.log(this.memory.plannedConstructionSites);
                        return;
                    }
                }
            }
        }

    }



    placeSpawnStamp(): void {
        /**
         * this will place the central spawn stamp overfit on the existing spawn (assuming there is only one in the room), and puts the structures
         * into the memory as building sites which need to be placed. These building sites will then be called
         * from the list as/when possible based on RCL from the construction manager and placed onto the map.
         */
        if(!this.spawns[0]) return;
        // check if any of the potential anchor points from the current spawn enable the stamp to be placed. if not throw an error
        const potential_anchors: RoomPosition[] = [];
        const spawnPos = this.spawns[0].pos;
        potential_anchors.push(new RoomPosition(spawnPos.x+2, spawnPos.y+1, spawnPos.roomName));
        potential_anchors.push(new RoomPosition(spawnPos.x-2, spawnPos.y+1, spawnPos.roomName));
        potential_anchors.push(new RoomPosition(spawnPos.x, spawnPos.y-2, spawnPos.roomName));

        //check each anchor to see if it is at the centre of a free 7x7 block (ignore any structure which fits the stamp)
        for (const anchor of potential_anchors) {
            console.log(`Checking to see if can place spawn stamp at ${anchor}`);
            if (anchor.canPlaceStamp(spawnStamp)) {
                this.placeStampIntoMemory(anchor, spawnStamp);
                console.log(`Placed spawn stamp for colony ${this.room.name} at ${anchor}`);
                // console.log(this.memory.plannedConstructionSites);
                break;
            }
        }
    }

    isMissingStructures(): boolean {
        for(const structure_constant of Object.keys(CONTROLLER_STRUCTURES) as BuildableStructureConstant[]){
            if (!(structure_constant in [STRUCTURE_CONTAINER, STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_WALL])) {
                if (this.getTotalStructuresExcludingPlanned(structure_constant) < CONTROLLER_STRUCTURES[structure_constant][this.room.controller?.level || 0]) {
                    return true;
                }
            }
        }
        return false;
    }

}
