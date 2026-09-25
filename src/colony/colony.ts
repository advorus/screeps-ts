import {addHostileRoom, removeHostileRoom, getAllTaskMemory, getColonyMemory,getCreepMemory, getScoutedRoomMemory, getTaskMemory}from "core/memory";

import "utils/roomPosition";
import "utils/move";
import { containerStamp, coreStamp, extensionStamp, extractorStamp, labStamp, spawnStamp, towerStamp } from "utils/stamps";
import { ConstructionManager } from "core/constructionManager";
import { ColonyVisualizer } from "./colonyVisualiser";
import {profile} from "Profiler";
import { resolveCname } from "dns";

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
    minerals: Mineral[] = [];

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
        this.memory.wallRepairThreshold ??= 100000;

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

        this.memory.storageId ??= this.room.find(FIND_STRUCTURES, {
            filter: (s): s is StructureStorage => s.structureType === STRUCTURE_STORAGE
        }).map(s => s.id)[0];
        this.storage = Game.getObjectById(this.memory.storageId) as StructureStorage | undefined;

        this.memory.minerals ??= this.room.find(FIND_MINERALS).map(m => m.id);
        this.memory.fillerContainerIds ??= [];
        this.memory.upgradeContainerIds ??= [];
        this.memory.lastStampRCL ??= 0;
        this.memory.plannedConstructionSites ??= [];
        this.memory.focusOnUpgrade ??= false;
        this.memory.haulerPartsNeeded ??= 0;
        this.memory.remoteSources ??= [];


        this.setFocusOnUpgrade();
        this.setFillerContainerIds();
        this.setUpgradeContainerIds();
        this.updateStorage();
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
        // this.minerals = this.room.find(FIND_MINERALS);



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

                if(this.room.controller?.level?this.room.controller.level>=6:false){
                    // delete the upgrader container from the map and planned construction sites
                    const upgraderContainer = this.memory.upgradeContainerIds.map(id=>Game.getObjectById(id))[0];
                    if(upgraderContainer){
                        upgraderContainer.destroy();
                        this.memory.plannedConstructionSites = this.memory.plannedConstructionSites.filter(site=>!(site.pos.x === upgraderContainer.pos.x && site.pos.y === upgraderContainer.pos.y && site.pos.roomName === upgraderContainer.pos.roomName && site.structureType === STRUCTURE_CONTAINER));
                        this.memory.upgradeContainerIds = [];
                        console.log("Removed upgrader container for colony " + this.room.name);
                    }
                }

                if(this.getTotalStructuresIncludingPlanned(STRUCTURE_EXTRACTOR)<1){
                    const extractorLocation = this.room.find(FIND_MINERALS)[0]?.pos;
                    if(extractorLocation){
                        this.placeStampIntoMemory(extractorLocation, extractorStamp);
                        console.log("Placed extractor stamp for colony " + this.room.name);
                    }
                }

                if(this.getTotalStructuresIncludingPlanned(STRUCTURE_EXTRACTOR)>0){
                    console.log("Extractor already placed for colony " + this.room.name);
                    // place a container next to the extractor
                    const extractorLocation = this.room.find(FIND_MINERALS)[0]?.pos;
                    // check if there is a container next to the extractor
                    const containers = this.room.find(FIND_STRUCTURES,{filter: s=> s.structureType === STRUCTURE_CONTAINER}) as StructureContainer[];
                    let containerNearExtractor = false;
                    for(const container of containers){
                        if(container.pos.isNearTo(extractorLocation)){
                            containerNearExtractor = true;
                            console.log(`Found container next to extractor at ${container.pos}`);
                            break;
                        }
                    }

                    const containerPos = extractorLocation.getFreeTiles()[0];
                    if(containerPos && !containerNearExtractor){
                        this.placeStampIntoMemory(containerPos, containerStamp);
                        console.log("Placed container stamp for extractor for colony " + this.room.name);
                    }
                }


            }
        }


        // Place construction sites if we are missing them on the map
        if (this.isMissingStructures()){
            if(Game.time%100 == 0){
                // console.log(`CPU used to this point in init of ${this.room.name}: ${Game.cpu.getUsed()}`);
                ConstructionManager.placeConstructionSites(this.room, this.memory.plannedConstructionSites);
                // console.log(`CPU used to this point in init of ${this.room.name}: ${Game.cpu.getUsed()}`);
            }
        }


        if(Game.time%200==0){
            this.updateHaulerPartsNeeded();
            this.updateRepairTargets();
            this.updateWallRepairThreshold();

            const terminals = this.room.find(FIND_STRUCTURES).filter(s=>s.structureType===STRUCTURE_TERMINAL) as StructureTerminal[] | null;
            if(terminals){
                this.memory.terminalId ??= terminals[0]?.id;
            }

            this.updateMineralContainers();
        }



        // Initialise visualiser
        this.colonyVisualizer = new ColonyVisualizer(this);



    }

    updateStorage(): void {

        // Always prefer a real Storage structure when present (auto-switch).
        const storages = this.room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_STORAGE }) as StructureStorage[];
        if (storages && storages.length > 0) {
            this.memory.storageId = storages[0].id;
            this.storage = storages[0];
            return;
        }

        // If an explicit storageId is set and the object exists, use it (container or storage)
        if (this.memory.storageId) {
            const obj = Game.getObjectById(this.memory.storageId as Id<any>);
            if (obj && (obj.structureType === STRUCTURE_STORAGE || obj.structureType === STRUCTURE_CONTAINER)) {
                this.storage = obj as StructureStorage;
                return;
            }
        }

        // Fallback: find a container that is NOT adjacent to any source or mineral
        const containers = this.room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }) as StructureContainer[];
        for (const c of containers) {
            const nearbyResources = c.pos.findInRange(FIND_SOURCES, 1).length + c.pos.findInRange(FIND_MINERALS, 1).length;
            if (nearbyResources === 0) {
                // treat this container as central storage
                this.memory.storageId = c.id;
                this.storage = c as unknown as StructureStorage;
                return;
            }
        }

        // nothing found
        this.storage = undefined;
        this.memory.storageId = this.memory.storageId ?? undefined;
    }

    run() {
        // periodically attempt to detect a central storage/container until a real Storage exists
        const cpuStart = Game.cpu.getUsed();
        console.log(`Running colony ${this.room.name}, cpu: ${cpuStart}`);

        // if (!this.storage && Game.time % 10 === 0) {
        //     this.updateStorage();
        // }
        // console.log(`Hauler parts needed for ${this.room.name}: ${this.memory.haulerPartsNeeded}`);
        // Assign tasks to creeps
        for(const creep of this.creeps) {
            if(getCreepMemory(creep.name).taskId) {
                // console.log(`Running task for creep ${creep.name} in colony ${this.room.name}, cpu: ${Game.cpu.getUsed()}`);
                this.runTask(creep);

            } else{
                // console.log(`Creep ${creep.name} in colony ${this.room.name} is not assigned a task, cpu: ${Game.cpu.getUsed()}`);
                // console.log(`Colony ${this.room.name} has a creep ${creep.name} that is not assigned a task`);
                //if sitting next to a source then move away from it
                for(let source of this.sources){
                    //check if the creep is near that source;
                    //if it is then move away
                    if(creep.pos.isNearTo(source.pos)){
                        // console.log(`Colony ${this.room.name} has a creep ${creep.name} that is sitting next to a source`);
                        //find the nearest path that takes the creep more than 1 tile away from the source
                        let path = PathFinder.search(creep.pos, {pos: source.pos, range:2}, {flee:true}).path;
                        console.log(`Creep ${creep.name} in colony ${this.room.name} is moving away from source, cpu: ${Game.cpu.getUsed()}`);
                        // console.log(path);
                        creep.moveByPath(path);
                        break;
                    }
                }
            }
        }

        const cpuAfterAssign = Game.cpu.getUsed();

        this.runTowers();
        const cpuAfterTowers = Game.cpu.getUsed();

        if(Game.cpu.bucket > 2000){
            this.colonyVisualizer?.run();
        }
        const cpuAfterVisualizer = Game.cpu.getUsed();

        // store a short history of CPU usage for this colony
        try {
            this.memory.cpuHistory ??= [];
            const total = cpuAfterVisualizer - cpuStart;
            this.memory.cpuHistory.push({ t: Game.time, total, assign: Math.max(0, cpuAfterAssign - cpuStart), towers: Math.max(0, cpuAfterTowers - cpuAfterAssign), visualizer: Math.max(0, cpuAfterVisualizer - cpuAfterTowers) });
            // keep up to CPU_HISTORY_MAX entries
            const CPU_HISTORY_MAX = 1000;
            if (this.memory.cpuHistory.length > CPU_HISTORY_MAX) this.memory.cpuHistory.shift();
        } catch (e) {}
    }

    updateWallRepairThreshold():void{
        const currentThreshold = this.memory.wallRepairThreshold
        const walls = this.room.find(FIND_STRUCTURES, {filter: s=> s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART});
        const wallsNeedingRepair = walls.filter(s=> s.hits<currentThreshold);
        if(walls.length>0 && wallsNeedingRepair.length == 0){
            if(this.room.controller!==undefined){
                this.memory.wallRepairThreshold = Math.min(currentThreshold + 100000, Math.max(this.room.controller.level-2,1)*300e3);
                console.log(`Updating wall repair threshold in room ${this.room.name} to ${this.memory.wallRepairThreshold}`);
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

    updateMineralContainers(): void {
        this.memory.mineralContainers = [];
        for(const mineralId of this.memory.minerals || []){
            const mineral = Game.getObjectById(mineralId);
            if(!mineral) continue;
            const containers = this.room.find(FIND_STRUCTURES, {filter: s=> s.structureType==STRUCTURE_CONTAINER}) as StructureContainer[] | null;
            if(!containers) continue;
            for(const container of containers){
                if(container.pos.isNearTo(mineral.pos)){
                    this.memory.mineralContainers.push(container.id);
                }
            }
        }
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
                task.type === 'MINE' && task.targetId === source.id && task.status === 'IN_PROGRESS' && task.colony == this.room.name
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
            // const pathToSource = PathFinder.search(haulTarget, source.pos).path;
            // const timeToSource = pathToSource.length;
            // // calculate the time taken to return from the source given the 2:1 carry/move ratio
            // // takes 2 ticks to traverse plain, 1 tick to traverse road,
            // const timeFromSource = pathToSource.reduce((acc, pos) => {
            //     const terrain = Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y);
            //     if (terrain === TERRAIN_MASK_SWAMP) {
            //         return acc + 10;
            //     } else {
            //         return acc + 2;
            //     }
            // }, 0);
            const timetosource = haulTarget.getRangeTo(source.pos);
            const roundTripTime = timetosource * 2 * 2;
            // the number of carry parts needed is minerparts*2*roundTripTime
            haulerPartsNeeded += existingMinerParts * 2 * roundTripTime / 50;
        }

        // now do same operation but for mineral tasks

        // every 5 ticks, any miners assigned to the mineral will extract 1*the number of work parts
        // this will need to be moved to the central storage, so need to compute the distance to and from storage to the container
        for(const mineralId of this.memory.minerals || []){
            const mineral = Game.getObjectById(mineralId);
            if(!mineral) continue;
            let existingMinerParts = 0
            // now get the number of mining parts assigned to this mineral
            const miningTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'MINE' && task.targetId === mineral.id && task.status === 'IN_PROGRESS' && task.colony == this.room.name
            );
            for(const miningTask of miningTasks){
                if(miningTask.assignedCreep){
                    const creep = Game.creeps[miningTask.assignedCreep];
                    if(creep){
                        const numMiningParts = creep.body.filter(part => part.type === WORK).length;
                        existingMinerParts += numMiningParts;
                    }
                }
            }
            // now need the distance of the path from the mineral container to the storage
            let haulTarget = this.room.storage?.pos;
            if(!this.room.storage){
                haulTarget = this.spawns[0].pos;
            }
            haulTarget??= new RoomPosition(25,25,this.room.name);
            // const pathToSource = PathFinder.search(haulTarget, mineral.pos).path;
            // const timeToSource = pathToSource.length;
            // // calculate the time taken to return from the source given the 2:1 carry/move ratio
            // // takes 2 ticks to traverse plain, 1 tick to traverse road,
            // const timeFromSource = pathToSource.reduce((acc, pos) => {
            //     const terrain = Game.map.getRoomTerrain(pos.roomName).get(pos.x, pos.y);
            //     if (terrain === TERRAIN_MASK_SWAMP) {
            //         return acc + 10;
            //     } else {
            //         return acc + 2;
            //     }
            // }, 0);
            // const roundTripTime = timeToSource + timeFromSource;
            const timetosource = haulTarget.getRangeTo(mineral.pos);
            const roundTripTime = timetosource * 2 * 1.75;
            // the number of carry parts needed is minerparts*2*roundTripTime
            haulerPartsNeeded += 0.2 * existingMinerParts * roundTripTime / 50;
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
            if(role == `miner` || role==`remote_miner`){
                let body:BodyPartConstant[] = []
                if(role==`miner`) body = this.minerBodyParts();
                if(role==`remote_miner`) body = this.remoteMinerBodyParts();
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
            if(role==`hauler`||role==`remote_hauler`){
                // console.log(`trying to spawn a hauler in room ${this.room.name}`);
                // const body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE];
                // const body = Array.from({ length: this.room.energyAvailable/150}, () => [CARRY,CARRY,MOVE]).flat();
                const body = this.haulerBodyParts();
                // console.log(body);
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new ${role} in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role==`scout`){
                const body = [MOVE];
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
            if(role == `duo_attacker`){
                const body = this.duoAttackerBodyParts();
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new duo_attacker in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role == `duo_healer`){
                const body = this.duoHealerBodyParts();
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new duo_healer in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role == "harasser"){
                if(this.room.controller && this.room.controller.level < 5){
                    console.log(`Cannot spawn harasser in ${this.room.name} because RCL is below 5`);
                    return;
                }
                const body = this.harasserBodyParts();
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new harasser in ${this.room.name}`);
                    if (spawnIndex < 0) {
                        console.log(`Couldn't find spawn index`);
                    } else {
                        this.spawnsAvailableForSpawning.splice(spawnIndex, 1);
                    }
                    return;
                }
            }
            if(role == "dismantler"){
                if(this.room.controller && this.room.controller.level < 5){
                    console.log(`Cannot spawn dismantler in ${this.room.name} because RCL is below 5`);
                    return;
                }
                const body = this.dismantlerBodyParts();
                const memory: CreepMemory = {role, colony: this.room.name};
                const result = spawn.spawnCreep(body,name,{memory});
                if(result === OK) {
                    console.log(`Spawning new dismantler in ${this.room.name}`);
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

    dismantlerBodyParts(): BodyPartConstant[] {
        const numTough = 3;
        const numAttack = 10;
        const numMove = 13;

        return Array(numTough).fill(TOUGH)
            .concat(Array(numMove).fill(MOVE))
            .concat(Array(numAttack).fill(ATTACK));
    }

    duoAttackerBodyParts(): BodyPartConstant[] {
        switch(this.room.controller?.level){
            case 5:
                return [TOUGH,TOUGH,
                    ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,
                    MOVE,MOVE,MOVE,MOVE,MOVE];
            case 6:
                return [
                    TOUGH, TOUGH, TOUGH, TOUGH,
                    ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
                ];
        }
        return [TOUGH,ATTACK,MOVE];

    }

    duoHealerBodyParts(): BodyPartConstant[] {
        switch(this.room.controller?.level){
            case 5:
                // RCL 5: 1300 energy
                // 3 HEAL, 5 MOVE
                return [
                    HEAL, HEAL, HEAL,
                    MOVE, MOVE, MOVE, MOVE, MOVE
                ];
            case 6:
                // RCL 6: 2000 energy
                // 5 HEAL, 8 MOVE
                return [
                    HEAL, HEAL, HEAL, HEAL, HEAL,
                    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
                ];
        }
        // Default: minimal healer
        return [HEAL, MOVE];
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

    harasserBodyParts(): BodyPartConstant[] {
        const numTough = 10;
        const numHeal = 4;
        const numMove = 14;

        return Array(numTough).fill(TOUGH)
            .concat(Array(numMove).fill(MOVE))
            .concat(Array(numHeal).fill(HEAL));
    }

    workerBodyParts(): BodyPartConstant[] {
        if (this.room.energyAvailable<350){
            return [WORK, CARRY, MOVE, MOVE];
        }
        else {
            const num_work_parts = Math.min(Math.floor((this.room.energyAvailable) / 200),8);
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

    remoteMinerBodyParts(): BodyPartConstant[] {
        return [WORK,WORK,WORK,MOVE,MOVE,MOVE];
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

        // this.placeControllerContainer();
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
        const builders = this.creeps.filter(c => c.memory.role === 'builder');
        const constructionSites = this.room.find(FIND_CONSTRUCTION_SITES);
        return builders.length < 1 && constructionSites.length > 0;
    }

    getUpgraderNeed(): boolean {
        const upgraders = this.creeps.filter(c => c.memory.role === 'upgrader');
        if (this.storage !== undefined && this.storage !== null){
            const targetUpgraders = Math.min(Math.max(this.storage.store[RESOURCE_ENERGY] / 15e3, 1), 10);
            if (this.storage.structureType !== STRUCTURE_STORAGE) {
                // check if all containers in the room are >90% capacity
                const containers = this.room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }) as StructureContainer[];
                const allContainersFull = containers.every(c => c.store.getFreeCapacity(RESOURCE_ENERGY) / c.store.getCapacity(RESOURCE_ENERGY) < 0.1);
                if (allContainersFull) {
                    return true;
                }
            }
            return targetUpgraders > upgraders.length;
        }
        else{
            // approximate the number of upgraders based on the number of work parts on miners and the number
            // of spaces between the source and the controller. miner work parts generate 1 energy per tick
            // upgraders use 1 energy every tick they are at the controller, which for 50 ticks is two legs plus
            // of travel time, each square takes roughly 2 ticks to traverse
            // very rough approximation
            // also, multiply the linear range between the cells by 1.25 to account for some path deviation
            // the linear range should be the average of each of the two sources
            let avSourceDistance = undefined;
            const sourceIds = this.memory.sourceIds;
            if(sourceIds && sourceIds.length > 0) {
                const sourceDistances = sourceIds.map(id => {
                    const source = Game.getObjectById(id) as Source | null;
                    if(!source) return 0;
                    return this.room.controller ? this.room.controller.pos.getRangeTo(source.pos) : 0;
                });
                avSourceDistance = sourceDistances.reduce((a,b) => a+b, 0) / sourceDistances.length;
            }
            // get number of miner work parts in the room
            // cap the number at five per source

            const minerWorkParts = this.creeps.filter(c => c.memory.role === 'miner').reduce((sum, c) => sum + c.getActiveBodyparts(WORK), 0);
            if (minerWorkParts && avSourceDistance) {
                // an upgrader part uses 50 energy in 50+2*avSourceDistance*1.25*2 ticks
                // which means it uses 50/(50+2*avSourceDistance*1.25*2) energy per tick on average
                const energyPerTickPerUpgraderPart = 50 / (50 + 2 * avSourceDistance );
                console.log(`Colony ${this.room.name} average source distance: ${avSourceDistance}, energy per tick per upgrader part: ${energyPerTickPerUpgraderPart}`);
                // check the number of work parts on upgraders
                const upgraderWorkParts = this.creeps.filter(c => c.memory.role === 'upgrader').reduce((sum, c) => sum + c.getActiveBodyparts(WORK), 0);
                console.log(`Colony ${this.room.name} upgrader work parts: ${upgraderWorkParts}`);
                const energyPerTickForAllUpgraders = upgraderWorkParts * energyPerTickPerUpgraderPart;
                // if the energy per tick for all upgraders is less than the energy available per tick from miners, we might need more upgraders
                const energyPerTickFromMiners = minerWorkParts-1.5; // assuming each miner work part generates 1 energy per tick
                console.log(`Colony ${this.room.name} might need more upgraders: energyPerTickForAllUpgraders=${energyPerTickForAllUpgraders}, energyPerTickFromMiners=${energyPerTickFromMiners}`);
                if (energyPerTickForAllUpgraders < energyPerTickFromMiners) {
                    // logic to determine if more upgraders are needed

                    return true;
                }

            }
            return upgraders.length < 5 && this.room.controller !== undefined;
        }
    }

    getDuoAttackerNeed(): boolean {
        const colonyDuoTasks = getAllTaskMemory().filter(t => (t.type === 'DUO_ATTACK'||t.type==`DUO_DEFEND`) && t.colony === this.room.name && t.status!==`DONE`) as DuoTaskMemory[];
        const duoAttackers = this.creeps.filter(c=>c.memory.role === `duo_attacker`);
        return duoAttackers.length < colonyDuoTasks.length;
    }

    getDuoHealerNeed(): boolean {
        const colonyDuoTasks = getAllTaskMemory().filter(t => (t.type === 'DUO_ATTACK'||t.type==`DUO_DEFEND`) && t.colony === this.room.name && t.status!==`DONE`) as DuoTaskMemory[];
        const colonyDuoHealers = this.creeps.filter(c=>c.memory.role === `duo_healer`);
        return colonyDuoHealers.length < colonyDuoTasks.length;
    }

    getMinerNeed(): boolean {
        /**
         * Checks if the colony wants to spawn a miner, based on the number of source containers and existing miners
         * @todo: if a miner is close to death then spawn one so that it can start heading towards the site?
         */
        // console.log(`Checking ${this.room.name} for miner need: ${this.sourceContainers.length} source containers and ${this.room.find(FIND_MY_CREEPS, { filter: (c) => c.memory.role === 'miner' }).length} existing miners`);
        const miners = this.creeps.filter(c=>c.memory.role === 'miner');

        return miners.length < getAllTaskMemory().filter(t=> t.type === 'MINE' && t.status !== 'DONE' && t.colony === this.room.name).length;
    }

    getRemoteMinerNeed(): boolean{
        const remoteMiningTasks = getAllTaskMemory().filter(t=>t.type === `REMOTE_MINING` && t.status !== `DONE` && t.colony === this.room.name);
        const remoteMiners = this.creeps.filter(c=>c.memory.role === 'remote_miner');
        return remoteMiners.length < remoteMiningTasks.length;
    }

    getHarasserNeed(): boolean {
        const harassTasks = getAllTaskMemory().filter(t => t.type === `HARASS_TOWER` && t.status !== `DONE` && t.colony === this.room.name);
        const harassers = this.creeps.filter(c => c.memory.role === `harasser`);
        return harassers.length < harassTasks.length;
    }

    getDismantlerNeed(): boolean {
        const dismantleTasks = getAllTaskMemory().filter(t => t.type === `DISMANTLE` && t.status !== `DONE` && t.colony === this.room.name);
        const dismantlers = this.creeps.filter(c => c.memory.role === `dismantler`);
        return dismantlers.length < dismantleTasks.length;
    }

    getPorterNeed(): boolean {
        /**
         * checks if a 'porter' needs to be spawned to move energy from storage to the filler and upgrader containers
         */
        const porters = this.creeps.filter(c=>c.memory.role === 'porter');
        if(this.storage!== undefined && this.storage.store[RESOURCE_ENERGY] > 0 && (this.sourceContainers.find(s=>s.store[RESOURCE_ENERGY]<s.store.getCapacity(RESOURCE_ENERGY))||this.upgradeContainers.find(s=>s.store[RESOURCE_ENERGY]<s.store.getCapacity(RESOURCE_ENERGY)))) {
            return porters.length < 1;
        }
        else{
            return false;
        }
    }

    getRemoteHaulerNeed(): boolean {
        // Estimate required remote haulers based on mining output and travel time.
        // Approach:
        // - For each REMOTE_MINING task, estimate miner work parts (from assigned miner or default)
        // - Compute round-trip path length from storage/spawn to remote source and convert to travel ticks
        // - Estimate energy produced per tick and required carry parts to transport that energy
        // - Convert required carry parts into number of hauler creeps (using haulerBodyParts carry capacity)
        // - Spawn if existing remote_hauler count < estimated required (with a conservative cap)

        const remoteMiningTasks = getAllTaskMemory().filter(t => t.type === `REMOTE_MINING` && t.status !== `DONE` && t.colony === this.room.name);
        if (remoteMiningTasks.length === 0) return false;

        // helper: how many CARRY parts one hauler body provides in current room energy context
        const exampleHaulerBody = this.haulerBodyParts();
        const carryPerHauler = exampleHaulerBody.filter(p => p === CARRY).length || 1; // guard

        let totalCarryPartsNeeded = 0;

        for (const task of remoteMiningTasks) {
            // estimate miner work parts: if a remote miner is assigned, use its WORK parts, else assume 3
            let minerWorkParts = 3;
            if (task.assignedCreep) {
                const assigned = Game.creeps[task.assignedCreep];
                if (assigned) minerWorkParts = Math.max(1, assigned.body.filter(b => b.type === WORK).length);
            }

            // estimate energy extracted per tick = minerWorkParts (1 energy per WORK per tick for mines)
            const energyPerTick = minerWorkParts;

            // find a representative haul target (prefer storage, else first spawn)
            let haulTargetPos: RoomPosition | undefined = this.storage?.pos;
            if (!haulTargetPos && this.spawns.length > 0) haulTargetPos = this.spawns[0].pos;
            if (!haulTargetPos) haulTargetPos = new RoomPosition(25, 25, this.room.name);

            // get the source position (targetId may be id of Source or object)
            let sourcePos: RoomPosition | null = null;
            try {
                const srcObj = Game.getObjectById(task.targetId as Id<any>);
                if (srcObj && (srcObj.pos)) sourcePos = (srcObj.pos as RoomPosition);
            } catch (e) {}
            if (!sourcePos && typeof task.targetId === 'object' && (task as any).targetId.pos) {
                sourcePos = (task as any).targetId.pos as RoomPosition;
            }
            if (!sourcePos) continue;

            // Use PathFinder.search but limit CPU by using simple straight line length when across rooms @todo
            const path = PathFinder.search(haulTargetPos, { pos: sourcePos, range: 1 }).path;
            // need a method to calculate the straight line method between points which works intraroom
            const roundTripTicks = Math.max(1, path.length * 3);

            // total energy produced per round trip
            const energyPerRoundTrip = energyPerTick * roundTripTicks;

            // required carry parts to move that energy (each CARRY holds 50 energy)
            const carryPartsForThisTask = Math.ceil(energyPerRoundTrip / 50);

            // Add a small buffer (25%) to account for inefficiencies
            totalCarryPartsNeeded += Math.ceil(carryPartsForThisTask * 1.25);
        }

        // Convert required carry parts to hauler count
        const estimatedHaulers = Math.ceil(totalCarryPartsNeeded / carryPerHauler);

        // Conservative caps: don't spawn more than 4 remote haulers per colony
        const maxRemoteHaulers = 5;
        const desiredHaulers = Math.min(estimatedHaulers, maxRemoteHaulers);

        const remoteHaulers = this.creeps.filter(c => c.memory.role === 'remote_hauler');

        // If there are fewer haulers than desired, return true to spawn one
        return remoteHaulers.length < desiredHaulers;
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
        const visibilityTasks = scoutTasks.filter(t=>t.role==`visibility`);
        // console.log(`Colony ${this.room.name} has ${scoutTasks.length} scout tasks`);
        // console.log(`Colony ${this.room.name} needs a scout: ${scouts.length < 1 && scoutTasks.length > 0}`);
        return scouts.length < scoutTasks.length;

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
        // @todo: add a 'harass' task which targets an enemy room with something that goes in, takes tower damage for a hit, recovers back to the
        // previous room it was in to heal, then when back to full health re-enters the room

        const taskId = getCreepMemory(creep.name).taskId;
        if (!taskId) return;

        let task = getTaskMemory(taskId);
        if (!task || task.status !== 'IN_PROGRESS') return;

        if (task.targetId === undefined) {
            console.log(`Task ${taskId} of type ${task.type} has no targetId`);
            task.status = `DONE`;
            delete creep.memory.taskId;
            return;
        }

        const target = Game.getObjectById(task.targetId);
        if ((target === undefined || target === null) && task.type !== `DUO_ATTACK`) {
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
                    creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffaa00'}});
                }
                break;
            case 'UPGRADE':
                // if there is an upgrade container in the room, pickup from there and upgrade similar to the fill task
                // console.log(this.upgradeContainers)
                if (this.upgradeContainers.length > 0) {
                    // mark working when full
                    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                        creep.memory.working = true;
                    }

                    // If creep is working, perform upgrade
                    if (creep.memory.working) {
                        if (creep.upgradeController(target as StructureController) === ERR_NOT_IN_RANGE) {
                            creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                        }
                        break;
                    }

                    // Not working and empty: try to withdraw from an upgrader container first
                    if (creep.store[RESOURCE_ENERGY] === 0) {
                        const container = this.upgradeContainers.find(s => s.store[RESOURCE_ENERGY] > 0);
                        if (container) {
                            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                                creep.betterMoveTo(container, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                            }
                            break;
                        }

                        // Fallback: if central storage has energy, withdraw from it
                        if (this.storage && this.storage.store[RESOURCE_ENERGY] > 0) {
                            if (creep.withdraw(this.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                                creep.betterMoveTo(this.storage, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                            }
                            break;
                        }

                        // Nothing to withdraw -> mark task done
                        task.status = `DONE`;
                        delete creep.memory.taskId;
                        creep.memory.working = false;
                        break;
                    }
                } else {
                    // No upgrader containers: attempt to withdraw from central storage before giving up
                    if (creep.store[RESOURCE_ENERGY] === 0) {
                        if (this.storage && this.storage.store[RESOURCE_ENERGY] > 0) {
                            if (creep.withdraw(this.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                                creep.betterMoveTo(this.storage, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                            }
                            break;
                        }
                        task.status = `DONE`;
                        delete creep.memory.taskId;
                        break;
                    }

                    if (creep.upgradeController(target as StructureController) === ERR_NOT_IN_RANGE) {
                        creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
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
                    creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
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
                    creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
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
                if (creep.store.getUsedCapacity() === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                if(task.resourceType!== undefined){
                    if(creep.store[task.resourceType] === 0){
                        task.status=`DONE`;
                        delete creep.memory.taskId;
                        break;
                    }
                    if (creep.transfer(target as AnyStructure, task.resourceType) === ERR_NOT_IN_RANGE) {
                        creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                    }
                } else {
                    if (creep.transfer(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                    }
                    for(const resourceType of Object.keys(creep.store) as ResourceConstant[]){
                    if(creep.transfer(target as AnyStructure, resourceType) === ERR_NOT_IN_RANGE) {
                        creep.betterMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 10});
                    }
                }

                }
                // try to transfer the other resources

                break;
            case 'MINE':
                //find the source container next to the source
                // check if there are source containers listed in the room memory
                let sourceContainer = undefined;
                let targetPos = undefined;
                if(this.memory.storageId !== undefined && this.room.energyCapacityAvailable > 550){
                    if(this.sourceContainers === undefined || this.memory.mineralContainers === undefined){
                        sourceContainer = this.room.find(FIND_STRUCTURES, {
                            filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.pos.isNearTo(target)
                        })[0];
                        targetPos = sourceContainer?.pos;
                    } else{
                        // convert the mineralContainerIds to objects
                        let mineralContainers = this.memory.mineralContainers.map(id => Game.getObjectById(id)).filter(c => c !== null) as StructureContainer[];
                        let mineralAndSourceContainers = this.sourceContainers.concat(mineralContainers);
                        sourceContainer = mineralAndSourceContainers.find(c => c.pos.isNearTo(target));
                        targetPos = sourceContainer?.pos;

                    }
                }
                if(sourceContainer === undefined){
                    // find a free tile next to the source
                    const freeTiles = target.pos.getFreeTiles();
                    // console.log(`Free tiles next to source ${target.id}: ${JSON.stringify(freeTiles)}`);
                    if(freeTiles.length > 0) {
                        targetPos = new RoomPosition(freeTiles[0].x, freeTiles[0].y, target.room.name);
                    }
                    // console.log(`No source container found for source ${target.id}, using free tile at ${targetPos}`);
                };

                if (!sourceContainer && creep.pos.inRangeTo(target, 1)) {
                    creep.harvest(target as Source);
                }
                else{
                    if(targetPos && !creep.pos.isEqualTo(targetPos)) {
                        creep.betterMoveTo(targetPos, {visualizePathStyle: {stroke: '#f12345'}, reusePath: 10});
                    }else{
                        creep.harvest(target as Source);
                    }
                }
                // if (creep.harvest(target as Source) === ERR_NOT_IN_RANGE) {
                //     creep.safeMoveTo(target, {reusePath:15, visualizePathStyle: {stroke: '#ffffff'}});
                // }
                break;
            case `FILL`:
                // there is no longer any energy in the container to fill with
                if(creep.store.getUsedCapacity()>creep.store.getUsedCapacity(RESOURCE_ENERGY)){
                    task.status= `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
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
                if(task.resourceType!== undefined){
                    // console.log(`Creep ${creep.name} is withdrawing ${task.resourceType} from ${target.id}`);
                    if(creep.withdraw(target as AnyStructure, task.resourceType) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                    if(creep.withdraw(target as AnyStructure, task.resourceType) === ERR_NOT_ENOUGH_RESOURCES){
                        // console.log(`Creep ${creep.name} has withdrawn ${task.resourceType} from ${target.id}`);
                        delete creep.memory.taskId;
                        task.status = `DONE`;
                        break;
                    }
                } else {
                    // console.log(`Creep ${creep.name} is withdrawing ENERGY from ${target.id}`);
                    if(creep.withdraw(target as AnyStructure, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }
                // need to try and pickup other resource types

                // if the target is a container and its empty then mark the task as done
                if (target instanceof StructureContainer && target.store.getUsedCapacity() === 0) {
                    task.status = `DONE`;
                    delete creep.memory.taskId;
                    break;
                }
                break;
            case `SCOUT`:
                console.log(`Creep ${creep.name} in colony ${this.room.name} is starting SCOUT task, cpu: ${Game.cpu.getUsed()}`);
                if(creep.room.name !== task.targetRoom || !creep.pos.isInsideRoom()) {

                    creep.moveTo(new RoomPosition(25, 25, task.targetRoom??creep.room.name), {visualizePathStyle: {stroke: '#ffffff'}, reusePath:50, maxOps: 1000});
                    console.log(`Creep ${creep.name} in colony ${this.room.name} and room ${creep.room.name} is moving towards target room ${task.targetRoom}, cpu: ${Game.cpu.getUsed()}`);
                }
                else {
                    if(task.targetRoom!== undefined){
                        let srMem = getScoutedRoomMemory(task.targetRoom);
                        // console.log(`Room ${task.targetRoom} has scouted memory ${JSON.stringify(srMem)}`);
                        if(srMem!== undefined){
                            // console.log(`Room ${task.targetRoom} was last scouted at ${srMem.lastScouted}`);
                            if(srMem.lastScouted!== undefined){
                                if(srMem.lastScouted + 1000 > Game.time){
                                    if(task.role !==  `visibility`) {
                                        delete creep.memory.taskId;
                                        task.status = `DONE`;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    // For visibility scouts we must always refresh the cached room data so
                    // that controller/reservation info is captured.
                    if(task.role === `visibility`) {
                        this.updateCachedRoomDataForRoom(task.targetRoom);
                        delete creep.memory.taskId;
                        task.status = `DONE`;
                        break;
                    }

                    // Non-visibility scouts use the existing behaviour (refresh and finish)
                    if(task.role!==`visibility`){
                        this.updateCachedRoomDataForRoom(task.targetRoom);
                        delete creep.memory.taskId;
                        task.status = `DONE`;
                    }
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
                        creep.safeMoveTo(new RoomPosition(25, 25, task.targetRoom), {visualizePathStyle: {stroke: '#ffffff'}, reusePath: 50});
                    }
                    if (creep.claimController(Game.rooms[task.targetRoom]?.controller as StructureController) === ERR_NOT_IN_RANGE) {
                        creep.safeMoveTo(Game.rooms[task.targetRoom]?.controller as StructureController, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }

                break;
            case `DISMANTLE`:
                // console.log(`Creep ${creep.name} is dismantling structure`);
                if(!creep.memory.colony) {
                    console.log(`Creep at ${creep.pos} is not assigned to a colony`);
                    break;
                }
                if(!creep.memory.taskId) break;

                const taskMem = getTaskMemory(creep.memory.taskId);

                // console.log(taskMem.targetRoom, taskMem.targetId);

                if(taskMem.targetRoom == undefined) taskMem.targetRoom = taskMem.colony;
                if(taskMem.targetId === undefined) break;
                if(taskMem.targetRoom === undefined) break;

                if(creep.room.name !== taskMem.targetRoom || !creep.pos.isInsideRoom()) {
                    // move to the colony
                    // console.log(`Creep ${creep.name} moving to room ${taskMem.targetRoom} to dismantle structure ${taskMem.targetId}`);
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
            case `REMOTE_MINING`:
                if(!creep.pos.isNearTo(target.pos)) {
                    creep.safeMoveTo(target.pos);
                }else{
                    creep.harvest(target as Source);
                }
                break;
            case `REMOTE_PICKUP`:
                if (creep.store.getFreeCapacity() === 0) {
                    delete creep.memory.taskId;
                    task.status = `DONE`;
                    break;
                }
                if(target instanceof Resource) {
                    if(!creep.pos.isNearTo(target.pos)) {
                        creep.safeMoveTo(target.pos);
                    }else{
                        creep.pickup(target as Resource);
                    }
                }
                if(target instanceof StructureStorage){
                    let resourceType: ResourceConstant = RESOURCE_ENERGY;
                    if(task.resourceType!== undefined){
                        resourceType = task.resourceType;
                    }
                    if(!creep.pos.isNearTo(target.pos)) {
                        creep.safeMoveTo(target.pos);
                    }else{
                        creep.withdraw(target as StructureStorage, resourceType);
                    }
                }
                break;
            case `DUO_ATTACK`:
                const duoTask = task as DuoTaskMemory
                // task = task as DuoTaskMemory; // cast task to DuoTaskMemory to access healer and attacker properties
                // depends on whether the creep is the attacker or the healer
                if(!Object.keys(duoTask).includes(`healer`)) break;
                if(!Object.keys(duoTask).includes(`attacker`)) break;
                if(creep.memory.role === `duo_attacker`) {
                    const healerId = duoTask.healer;
                    if(typeof healerId !== `string`) break;
                    const healer = Game.creeps[healerId]
                    if(!healer) {
                        break;
                    }
                    // if the creep is within 2 of an exit tile and not near the healer, then stop
                    if(!creep.pos.isNearTo(healer.pos) && !creep.pos.isNearEdge()) break;

                    // if we are not in the target room then move into it
                    if(creep.room.name !== task.targetRoom || !creep.pos.isInsideRoom()) {
                        creep.betterMoveTo(new RoomPosition(25, 25, task.targetRoom??creep.room.name), {visualizePathStyle: {stroke: '#ff0000'}});
                        break;
                    }
                    if(task.targetId === this.spawns[0].id) {
                        // console.log(`resetting targetId`)
                        const bestTarget = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                        if(bestTarget == null){
                            const creepTarget = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES);
                            task.targetId = creepTarget?.id;
                        } else task.targetId = bestTarget?.id;
                    }
                    if(task.targetId===this.spawns[0].id) break;
                    if(task.targetId === undefined) break;
                    let attackTarget = Game.getObjectById(task.targetId);
                    // if we are near the target then attack it
                    if(creep.attack(attackTarget as Creep | Structure) === ERR_NOT_IN_RANGE) {
                        creep.betterMoveTo(attackTarget.pos, {visualizePathStyle: {stroke: '#ff0000'}, reusePath: 30});
                    }
                    // if the target is dead then the task is done
                    if(target === null){
                        const bestTarget = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                        if(bestTarget == null){
                            const creepTarget = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, { filter: c => c.structureType !== STRUCTURE_CONTROLLER });                            if(creepTarget == null){
                                // if there are no hostile creeps then the task is done
                                delete creep.memory.taskId;
                                task.status = `DONE`;
                                break;
                            }
                            task.targetId = creepTarget?.id;
                        } else task.targetId = bestTarget?.id;
                        break;
                    }
                    if((target as Creep | Structure).hits === 0 || (target as Creep | Structure).hits === undefined) {
                        const bestTarget = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                        if(bestTarget == null){
                            const creepTarget = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, { filter: c => c.structureType !== STRUCTURE_CONTROLLER });
                            if(creepTarget == null){
                                // if there are no hostile creeps then the task is done
                                delete creep.memory.taskId;
                                task.status = `DONE`;
                                break;
                            }
                            task.targetId = creepTarget?.id;
                        } else task.targetId = bestTarget?.id;
                    }
                }else if(creep.memory.role === `duo_healer`) {
                    // if the creep isn't near the attacker then move towards it
                    const duoTask = task as DuoTaskMemory;
                    if(!duoTask.attacker) break;
                    const attacker = Game.creeps[duoTask.attacker];
                    if(!attacker) break;
                    // if the healer isn't near the attacker then move towards it
                    if(creep.pos.getRangeTo(attacker) > 0) {
                        creep.betterMoveTo(attacker.pos, {visualizePathStyle: {stroke: '#00ff00'}, reusePath: 30});
                    }
                    // heal the attacker
                    if(creep.pos.getRangeTo(attacker) === 1) {
                        if(attacker.hits < attacker.hitsMax) {
                            creep.heal(attacker);
                            break;
                        }
                    }
                    if(creep.hits < creep.hitsMax) {
                        creep.heal(creep);
                        break;
                    }
                }
                break;
            case `HARASS_TOWER`:
                // aim is to move to the hostile room, enter the room for a tick, and then retreat back to safety
                if(creep.hits == creep.hitsMax) {
                    // check if we are in the hostile room
                    console.log(`Creep ${creep.name} in colony ${this.room.name} is checking if it is in the hostile room ${task.targetRoom}`);
                    if(creep.room.name !== task.targetRoom || !creep.pos.isInsideRoom()) {
                        console.log(`Creep ${creep.name} is not in the hostile room ${task.targetRoom}, moving towards it.`);
                        creep.betterMoveTo(new RoomPosition(25, 25, task.targetRoom??creep.room.name), {visualizePathStyle: {stroke: '#ff0000'}, reusePath: 30});
                    }
                }
                else {
                    // then we need to retreat via the nearest exit
                    if(creep.room.name == task.targetRoom){
                        const exit = creep.pos.findClosestByRange(FIND_EXIT);
                        if(exit) {
                            creep.betterMoveTo(exit, {visualizePathStyle: {stroke: '#ff0000'}, reusePath: 30});
                        }
                    } else {
                        // we need to move in inside whichever room we are now in
                        if(!creep.pos.isInsideRoom()){
                            creep.betterMoveTo(new RoomPosition(25, 25, creep.room.name), {visualizePathStyle: {stroke: '#ff0000'}, reusePath: 30});
                        }

                    }

                }
                creep.heal(creep);
        }
        // console.log(`Status of task ${task.id}: ${task.status}`);

    }

    runTowers() {
        // console.log(`Running towers for colony ${this.room.name}, cpu: ${Game.cpu.getUsed()}`);;
        const towers = this.towers;
        for (const tower of towers) {
            const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (closestHostile) {
                tower.attack(closestHostile);
            }
        }
        // console.log(`Finished running towers for colony ${this.room.name}, cpu: ${Game.cpu.getUsed()}`);
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
        const maxRadius = 50;
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
    updateCachedRoomDataForRoom(roomName:string): void{
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

        let cMatrix = Game.rooms[roomName].generateCostMatrix();

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

}
