
// import { Empire } from "./empire";
import { get } from "lodash";
import { getAllTaskMemory, getCreepMemory, getScoutedRoomMemory, getTaskMemory, removeHostileRoom } from "./memory";
// import { Colony } from "colony/colony";
// import { Empire } from "./empire";
import {profile} from "Profiler";

@profile
export class TaskManager {
    static createTask(type: TaskMemory['type'], target: Mineral | AnyStructure | Source | ConstructionSite | Resource, colony: string, priority:number = 0, role?:string, targetRoom?:string): string {
        if(!Memory.tasks) {
            Memory.tasks = {};
        }
        const id = `${type}_${Game.time}_${Math.random()}`;
        // console.log(targetRoom)
        Memory.tasks[id] = {id, type, targetId: target.id, status: `PENDING`, colony, priority, role, targetRoom} as TaskMemory;
        return id;
    }

    static createDuoTask(type: DuoTaskMemory[`type`], targetRoom: string, colony: string, priority:number = 0, objective:string,targetId:string): string {
        if(!Memory.tasks) {
            Memory.tasks = {};
        }
        const id = `${type}_${Game.time}_${Math.random()}`;
        Memory.tasks[id] = {id, type, targetRoom, colony, priority, objective, status:`PENDING`, healer: undefined, attacker: undefined,targetId:targetId} as DuoTaskMemory;
        return id;
    }

    static getBuildPriority(site: ConstructionSite): number {
        switch(site.structureType) {
            case STRUCTURE_SPAWN:
                return 5;
            case STRUCTURE_TOWER:
                return 4;
            case STRUCTURE_STORAGE:
                return 3;
            case STRUCTURE_EXTENSION:
                return 2;
            case STRUCTURE_CONTAINER:
                return 2;
            default:
                return 1;
        }
    }

    static reprioritiseTasks(empire: EmpireLike): void {
        this.prioritiseBuildTasks(empire);
        this.prioritiseWallRepairTasks(empire);
    }

    static prioritiseWallRepairTasks(focus: EmpireLike | ColonyLike){
        if ("colonies" in focus){
            for(const colony of focus.colonies){
                this.prioritiseWallRepairTasks(colony);
            }
        } else{
            //set all rampart/wallrepair tasks to priority 0
            let wallRepairTasks = getAllTaskMemory().filter(s=>s.type === 'WALLREPAIR' && s.colony === focus.room.name && s.status !== 'DONE');
            for(const task of wallRepairTasks){
                task.priority = 0;
            }
            // now we need to prioritise a singular task
            // if there are ramparts in the task list, then we need to find the one with the lowest hits - if there is a tie then use the lowest ticks to decay to break the tie
            let rampartRepairTasks = wallRepairTasks.filter(s => s.targetId && Game.getObjectById(s.targetId)?.structureType === STRUCTURE_RAMPART);

            if (rampartRepairTasks.length>0){

                //find the rampart(s) with the lowest hits
                let rampartObjects = [];

                for(const s of rampartRepairTasks){
                    if(!s.targetId) continue;
                    const obj = Game.getObjectById(s.targetId);
                    if(obj){
                        rampartObjects.push(obj);
                    }
                }
                let lowestHits = Math.min(...rampartObjects.map(s => s.hits || 0));
                let candidates = rampartObjects.filter(s => s.hits === lowestHits);

                if (candidates.length > 0) {
                    // If there's a tie, use the lowest ticks to decay
                    let lowestTicks = Math.min(...candidates.map(s => s.ticksToDecay || Infinity));
                    let candidate = candidates.find(s => s.ticksToDecay === lowestTicks);
                    if(candidate){
                        // find the rampart task associated with this object
                        let task = rampartRepairTasks.find(t => t.targetId === candidate.id);
                        if(task){
                            task.priority = 1;
                            return;
                        }
                    }
                }
            }

            let wallWallRepairTasks = wallRepairTasks.filter(s => s.targetId && Game.getObjectById(s.targetId)?.structureType === STRUCTURE_WALL);
            if(wallWallRepairTasks.length>0){
                let wallObjects = [];
                for(const s of wallWallRepairTasks){
                    if(!s.targetId) continue;
                    const obj = Game.getObjectById(s.targetId);
                    if(obj){
                        wallObjects.push(obj);
                    }
                }

                //find the wall(s) with the lowest hits
                let lowestHits = Math.min(...wallObjects.map(s => s.hits || Infinity));
                let candidate = wallObjects.find(s => s.hits === lowestHits);
                if (candidate) {
                    let task = wallWallRepairTasks.find(t => t.targetId === candidate.id);
                    if (task) {
                        task.priority = 1;
                        return;
                    }
                }
            }
        }
    }

    static hasUnassignedTask(empire: EmpireLike, type: TaskMemory['type']): boolean {
        return Object.values(Memory.tasks).some(task =>
            task.status === `PENDING` &&
            !task.assignedCreep &&
            task.type === type);
    }

    static prioritiseBuildTasks(empire: EmpireLike): void {
        /**
         * Prioritise build tasks for each colony based on their current needs
         * Currently, will ensure a single site is prioritised at a time
         */
        for (const colony of empire.colonies) {
            let multiple_maxes = false;
            let max_target = undefined;
            const pendingBuildTasks = getAllTaskMemory().filter(s=>s.type === 'BUILD' && s.colony === colony.room.name && s.status === 'PENDING');
            for (const task of pendingBuildTasks) {
                // if there are multiple tasks with the same maximum priority level, one of the tasks should have its priority increased by 1
                const maxPriority = Math.max(...pendingBuildTasks.map(t => t.priority || 0));
                if (task.priority === maxPriority) {
                    if (multiple_maxes) {
                        if(max_target!=task.targetId){
                            task.priority = (task.priority) + 1;
                            break;
                        }

                    }
                    multiple_maxes = true;
                    max_target = task.targetId;
                }

            }
        }
    }

    static assignTask(creep:Creep) {
        const availableTasks = Object.values(Memory.tasks).filter(task =>
            task.status === `PENDING` &&
            !task.assignedCreep &&
            task.colony === getCreepMemory(creep.name).colony
        ).sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Sort by priority

        if (availableTasks.length === 0) {
            return;
        }

        const availableDuoTasks = getAllTaskMemory().filter(task =>
            task.status === `PENDING` &&
            task.colony === getCreepMemory(creep.name).colony &&
            task.type === `DUO_ATTACK`
        ).sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Sort by priority

        // if(creep.memory.role == `scout`) console.log(`Scout creep ${creep.name} is checking for tasks`);

        for(const duoTask of availableDuoTasks as DuoTaskMemory[]){
            //duo assignment logic
            console.log(`Checking ${duoTask.id} with target ${duoTask.targetId}`);
            if(creep.memory.role == `duo_attacker`){
                console.log(`Checking if ${creep.name} can be assigned ${duoTask.id}`)
                if(duoTask.attacker !== undefined) continue;
                console.log(`Assigning duo attacker ${creep.name} to task ${duoTask.id}`);
                //then this is a duo task which can be assigned
                duoTask.attacker = creep.name as string;
                creep.memory.taskId = duoTask.id;

                // if there is healer in the task then set its status to in progress
                if(duoTask.healer !== undefined){
                    duoTask.status = `IN_PROGRESS`;
                }
            }
            if(creep.memory.role == `duo_healer`){
                if(duoTask.healer !== undefined) continue;
                console.log(`Assigning duo healer ${creep.name} to task ${duoTask.id}`);
                duoTask.healer = creep.name as string;
                creep.memory.taskId = duoTask.id;

                if(duoTask.attacker !== undefined){
                    duoTask.status = `IN_PROGRESS`;
                    console.log(`Duo task ${duoTask.id} is now in progress with targetId ${duoTask.targetId}`);
                }
            };
        }

        for(const task of availableTasks) {
            if(task.id!==undefined && task.targetId!==undefined) {
                const target = Game.getObjectById(task.targetId);
                if(creep.memory.role == `duo_attacker`) continue;
                if(creep.memory.role == `duo_healer`) continue
                if(Object.keys(task).includes(`objective`)) continue;

                // if(task.type==`SCOUT`) console.log(`Checking if task ${task.id} can be assigned to creep ${creep.name}`);
                // Check if the creep can perform the task
                if (task.type === 'HARVEST' && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                        continue;
                }
                const controller = creep.room.controller;
                let upgradeContainers = [];
                if(controller !== undefined){
                    upgradeContainers = creep.room.find(FIND_STRUCTURES, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, 4) && s.store[RESOURCE_ENERGY]>0
                    });
                }
                if((task.type == `SCOUT` && creep.memory.role !== `scout`)||(creep.memory.role == `scout` && task.type !== `SCOUT`)){
                    continue;
                }
                if (task.type === 'UPGRADE' && creep.store[RESOURCE_ENERGY] === 0) {
                    continue;
                }
                if(creep.memory.role === `hauler` && task.type !== `HAUL` && task.type !== `FILL` && task.type !== `PICKUP`) {
                    continue;
                }
                if( task.type === 'HAUL' && target.structureType!==STRUCTURE_STORAGE && target.structureType!==STRUCTURE_LAB && target.structureType!==STRUCTURE_TERMINAL && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    continue;
                }
                if(task.type === `HAUL` && creep.store.getUsedCapacity() == 0){
                    continue;
                }
                if(task.type === 'BUILD' && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    continue;
                }
                if(task.type === 'PICKUP' && creep.store.getFreeCapacity() === 0) {
                    continue;
                }
                if(task.type == `REPAIR` && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    continue;
                }
                //claimers can only pick claim tasks
                if((task.type == `CLAIM` && creep.memory.role !== `claimer`) || (creep.memory.role == `claimer` && task.type !== `CLAIM`)){
                    continue;
                }
                if(task.type == `WALLREPAIR` && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    continue;
                }
                // only miners can pick up mine tasks
                if(creep.memory.role === `miner` && task.type !== `MINE`) {
                    continue;
                }

                if((task.type==`REMOTE_MINING` && creep.memory.role !== `remote_miner`)||(creep.memory.role == `remote_miner` && task.type !== `REMOTE_MINING`)) continue;

                if(task.type == `REMOTE_PICKUP` && creep.memory.role !== `remote_hauler`) continue;
                if(creep.memory.role == `remote_hauler` && task.type !== `REMOTE_PICKUP` && task.type!== `HAUL`) continue;
                if(task.type == `REMOTE_PICKUP` && creep.store.getFreeCapacity() === 0) continue;

                if(task.type === `MINE` && creep.memory.role !== `miner`) {
                    continue;
                }
                // for now - check if the creep is in the same colony as the task
                if (getCreepMemory(creep.name).colony !== getTaskMemory(task.id).colony) {
                    continue;
                }

                // check if there are haulers in the room - if there are then the only type of creep to be able to pickup from sources is haulers
                const haulersInRoom = creep.room.find(FIND_MY_CREEPS, {
                    filter: c=>c.memory.role===`hauler`
                });

                if(haulersInRoom.length>0){
                    // console.log(`found haulers in room ${creep.room.name}`)
                    if(task.type === `PICKUP` && Game.getObjectById(task.targetId) instanceof StructureContainer){
                        // console.log(`checking if ${creep.name} is a hauler, as ${task.id} can only be performed by a hauler as the source is a source`)
                        if(creep.memory.role !== `hauler`) {
                            continue;
                        }
                    }
                }

                task.assignedCreep = creep.name;
                task.status = `IN_PROGRESS`;
                creep.memory.taskId = task.id;
                // console.log(`Assigned task ${task.id} of type ${task.type} to creep ${creep.name}`)

                // if the task is a haul task and the energy stored in all creeps assigned to drop off at the target is less than the target's free capacity, create another haul task

                //get a list of all creeps assigned to drop off at the target

                const assignedCreeps = Object.values(Game.creeps).filter(c => {
                    const memory = getCreepMemory(c.name);
                    if(memory === undefined) return false;
                    if(memory.taskId === undefined) return false;
                    const assignedTask = getTaskMemory(memory.taskId);
                    if(!assignedTask) return false;
                    if(assignedTask.targetId === undefined) return false;
                    return assignedTask && assignedTask.targetId === task.targetId;
                });
                //sum the amount of energy stored in these hauler creeps
                const totalEnergy = assignedCreeps.reduce((sum, c) => sum + c.store.getUsedCapacity(RESOURCE_ENERGY), 0);
                if ((task.type === 'HAUL') && totalEnergy < Game.getObjectById(task.targetId).store.getFreeCapacity(RESOURCE_ENERGY)) {
                    // console.log(`Creating a new ${task.type} task for ${task.targetId} in colony ${task.colony} because existing creeps cannot fulfil the energy requirement`);
                    this.createTask(task.type, Game.getObjectById(task.targetId) as AnyStructure | Source, task.colony as string, task.priority || 0);
                }

                if (task.type==`BUILD` && Game.getObjectById(task.targetId).progressTotal-Game.getObjectById(task.targetId).progress > creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
                    // console.log(`Creating a new ${task.type} task for ${task.targetId} in colony ${task.colony} because existing creeps cannot fulfil the energy requirement`);
                    this.createTask(task.type, Game.getObjectById(task.targetId) as AnyStructure | Source, task.colony as string, task.priority || 0);
                }

                if(task.type == 'PICKUP'){ //} && Game.getObjectById(task.targetId).amount > creep.store.getFreeCapacity()) {
                    // get the energy capacity of all creeps assigned to the target
                    let totalPickupAmount = 0;
                    if(Game.getObjectById(task.targetId) instanceof Resource) {
                        totalPickupAmount = Game.getObjectById(task.targetId).amount;
                    }
                    else{
                        totalPickupAmount = Game.getObjectById(task.targetId).store.getUsedCapacity(RESOURCE_ENERGY);
                    }
                    const assignedCreeps = Object.values(Game.creeps).filter(c => {
                        const memory = getCreepMemory(c.name);
                        if(!memory.taskId) return false;
                        if(!getTaskMemory(memory.taskId)) return false;
                        return memory.taskId && getTaskMemory(memory.taskId).targetId === task.targetId;
                    });
                    //sum the amount of energy capacity of these creeps
                    const totalEnergyCapacity = assignedCreeps.reduce((sum, c) => sum + c.store.getFreeCapacity(RESOURCE_ENERGY), 0);
                    if (totalPickupAmount > totalEnergyCapacity) {
                        // console.log(`Creating a new ${task.type} task for ${task.targetId} in colony ${task.colony} because existing creeps cannot fulfil the energy requirement`);
                        this.createTask(task.type, Game.getObjectById(task.targetId) as AnyStructure | Source, task.colony as string, task.priority || 0);
                    }
                }
                return;
            }
        }
    }

    static createTasks(focus: ColonyLike | EmpireLike) {
        if ("colonies" in focus) {
            // console.log(focus.dismantleTargets);

            for(const colony of focus.colonies) {
                this.createColonyTasks(colony);
            }
            //create dismantle tasks and assign them to the nearest room

            for(let roomName of focus.dismantleTargets) {
                removeHostileRoom(roomName);
                // console.log(`Creating dismantle tasks for room ${roomName}`);
                let scoutedRoomData = getScoutedRoomMemory(roomName);
                if(scoutedRoomData){
                    // console.log(`Found scouted room data for ${roomName}`);
                    if(getAllTaskMemory().filter(t=>t.type == `DISMANTLE` && t.targetRoom == roomName).length > 3) continue;
                    let nearestColonyName = focus.getNearestColonyName(roomName);
                    // console.log(`Nearest colony for room ${roomName} is ${nearestColonyName}`);
                    if(!Object.keys(Game.rooms).includes(roomName)) {
                        // need to get visbility of the room
                        // create a scout task from the nearest colony
                        if(nearestColonyName) {
                            const colony = focus.colonies.find(c => c.room.name === nearestColonyName);
                            if(this.checkIfExistingTask(`SCOUT`, colony.spawns[0] , nearestColonyName.name)) continue;
                            this.createTask(`SCOUT`, colony.spawns[0] , nearestColonyName.name, 1, `scout`, roomName);
                            console.log(`Created SCOUT task for room ${roomName} from colony ${nearestColonyName}`);
                        }
                        continue;
                    }
                    if(!nearestColonyName) continue;
                    for(const targetId of scoutedRoomData.hostileStructures) {
                        console.log(targetId);
                        if(Game.getObjectById(targetId) == null) continue;
                        if(this.checkIfExistingTask(`DISMANTLE`, Game.getObjectById(targetId) as AnyStructure | Source, nearestColonyName.name)) continue;
                        this.createTask(`DISMANTLE`, Game.getObjectById(targetId) as AnyStructure | Source, nearestColonyName.name, 1, `dismantle`, roomName);
                    }
                }

            }
        } else {
            this.createColonyTasks(focus)
        }
    }

    static createWallRepairTasks(colony: ColonyLike): void{
        // create wall repair tasks for walls and ramparts below a certain threshold
        // check if there are more than 3 wallrepair tasks
        // console.log(`looking for wall repair tasks`);

        const rampartsNeedingRepair = colony.room.find(FIND_STRUCTURES, {
            filter: (structure) => (structure.structureType === STRUCTURE_RAMPART) && structure.hits < colony.memory.wallRepairThreshold
        });
        for(const rampart of rampartsNeedingRepair){
            if(!this.checkIfExistingTask(`WALLREPAIR`, rampart, colony.room.name)) {
                this.createTask(`WALLREPAIR`, rampart, colony.room.name, 2);
                return;
            }
        }

        if(Object.values(Memory.tasks).filter(task =>
            task.type === 'WALLREPAIR' &&
            task.colony === colony.room.name &&
            task.status !== 'DONE'
        ).length > 5) {
            return;
        }

        const wallsNeedingRepair = colony.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_WALL && structure.hits < colony.memory.wallRepairThreshold
        });
        for(const wall of wallsNeedingRepair){
            if(!this.checkIfExistingTask(`WALLREPAIR`, wall, colony.room.name)) {
                this.createTask(`WALLREPAIR`, wall, colony.room.name, 0);
                return;
            }
        }
    }


    static createColonyTasks(colony: ColonyLike) {
        this.createSourceTasks(colony);
        this.createMineralTasks(colony);
        if(colony.room.controller) {
            this.createUpgradeTasks(colony);
        }
        this.createColonyBuildTasks(colony);
        this.createHaulTasks(colony);
        // console.log(`Got here`);
        this.createRepairTasks(colony);
        // console.log(`Got here`)
        this.createDismantleTasks(colony);
        this.createWallRepairTasks(colony);
        this.createRemoteMiningTasks(colony);
        this.createRemoteHaulingTasks(colony);
    }

    static createMineralTasks(colony: ColonyLike){
        // find any active minerals
        if (!colony.memory.minerals) return;
        for(const mineralId of colony.memory.minerals){
            const mineral = Game.getObjectById(mineralId) as Mineral | null;
            if(!mineral) continue;
            if(mineral.mineralAmount <= 0) continue;
            if(colony.room.find(FIND_STRUCTURES).filter(s=>s.structureType===STRUCTURE_EXTRACTOR).length===0) continue;
            if(this.checkIfExistingTask(`MINE`, mineral, colony.room.name)) continue;
            this.createTask(`MINE`, mineral, colony.room.name, 0);
        }
        return;
    }

    static createRemoteHaulingTasks(colony: ColonyLike) {
        // console.log(`Creating remote hauling tasks for ${colony.room.name}`);
        const activeRemoteRooms = colony.memory.remoteSources?.map(rs=>rs.room);
        if(!activeRemoteRooms) return;
        for (const roomName of activeRemoteRooms) {
            if(!Object.keys(Game.rooms).includes(roomName)) continue;
            // console.log(`Checking room: ${roomName} for remote hauling tasks`)
            const resources = Game.rooms[roomName].find(FIND_DROPPED_RESOURCES);
            for (const resource of resources) {
                if (!this.checkIfExistingTask(`REMOTE_PICKUP`, resource, colony.room.name)) {
                    this.createTask(`REMOTE_PICKUP`, resource, colony.room.name, 0, `remote_pickup`, roomName);
                }
            }
        }
    }

    static createRemoteMiningTasks(colony: ColonyLike) {
        if (!colony.memory.remoteSources) return;

        for (const remoteSource of colony.memory.remoteSources) {
            if (!remoteSource.active) continue;

            if(!Object.keys(Game.rooms).includes(remoteSource.room)) {
                console.log(`Remote room ${remoteSource.room} is not visible`);
                // create a scout task to get visibility of the room
                if(this.checkIfExistingTask(`SCOUT`, colony.spawns[0], colony.room.name)) continue;
                this.createTask(`SCOUT`, colony.spawns[0], colony.room.name, 0, `visibility`, remoteSource.room);
                continue;
            }

            const source = Game.getObjectById(remoteSource.id as Id<Source>) as Source | null;
            if (!source) continue;

            if(this.checkIfExistingTask(`REMOTE_MINING`, source, colony.room.name)) continue;
            this.createTask(`REMOTE_MINING`, source, colony.room.name, 0, `remote_mining`, remoteSource.room);
        }
    }

    static createDismantleTasks(colony: ColonyLike) {
        // get any structures in the room which have owner not equal my name
        const foreignStructures = colony.room.find(FIND_HOSTILE_STRUCTURES);
        for (const structure of foreignStructures) {
            if(!this.checkIfExistingTask(`DISMANTLE`, structure, colony.room.name)) {
                this.createTask(`DISMANTLE`, structure, colony.room.name, 15);
            }
        }
    }

    static createRepairTasks(colony: ColonyLike) {
    /**
     * Create repair tasks for damaged structures in the colony
     */
        // const damagedStructures = colony.room.find(FIND_STRUCTURES, {
        //     filter: (structure) => structure.hits < structure.hitsMax && structure.structureType !== STRUCTURE_WALL && structure.structureType !== STRUCTURE_RAMPART
        // });
        // console.log(`here`);
        // console.log(`Found ${damagedStructures.length} damaged structures`);
        if(colony.memory.repairTargets === undefined) return;

        for (const {id, active} of colony.memory.repairTargets) {
            const structure = Game.getObjectById(id) as AnyStructure | null;
            if (!structure) continue;

            //priority of the repair task should be 1 higher than the highest priority build task, otherwise 5
            let priority = 5;
            const existingBuildTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'BUILD' &&
                task.colony === colony.room.name &&
                task.status !== 'DONE'
            );
            if (existingBuildTasks.length > 0) {
                priority = Math.max(...existingBuildTasks.map(task => task.priority ? task.priority : 0)) + 1;
            }

            if(!this.checkIfExistingTask(`REPAIR`, structure, colony.room.name)) {
                this.createTask(`REPAIR`, structure, colony.room.name, priority);
            }
        }
        // console.log(`Created repair tasks`);
    }

    static createColonyBuildTasks(colony: ColonyLike) {
        const construction_sites = colony.room.find(FIND_CONSTRUCTION_SITES);

        for (const site of construction_sites) {
            const existingBuildTasks = Object.values(Memory.tasks).filter(task =>
                task.type === 'BUILD' &&
                task.targetId == site.id &&
                task.colony === colony.room.name &&
                task.status !== 'DONE'
            );
            if (existingBuildTasks.length >= 1) continue; // Skip if there's already a build task for this site

            let priority = TaskManager.getBuildPriority(site);
            // Check if there is an existing build task of the same type in the colony
            const existingBuildTaskOfType = Object.values(Memory.tasks).find(task => {
                if (!task.targetId) return false;
                else return task.type === 'BUILD' &&
                task.colony === colony.room.name &&
                task.status !== 'DONE' &&
                Game.getObjectById(task.targetId)?.structureType === site.structureType;
            });
            // If there is not one, increase the priority
            if (!existingBuildTaskOfType) {
                priority += 1;
            }
            // console.log(`Creating build task for ${site.id} in colony ${colony.room.name} with priority ${priority}`);
            TaskManager.createTask(`BUILD`, site, colony.room.name, priority);
        }
    }

    static createSourceTasks(focus: ColonyLike) {
        const sources = focus.sources;
        for(const source of sources){
            // if there is a source container
            const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure) => structure.structureType === STRUCTURE_CONTAINER
            });
            if (container.length > 0) {
                // If there is a container, create a mining task
                if(!this.checkIfExistingTask(`MINE`, source, focus.room.name)) {
                    TaskManager.createTask(`MINE`, source, focus.room.name);
                }
                // need to create pickup tasks
                this.createPickupTasks(focus);
            }
            else {
                // If there is no container, create harvest tasks for all free tiles
                for (const tile of source.pos.getFreeTiles()) {
                    //check if there is a mathing task already
                    if(this.checkForExistingTasks(`HARVEST`, source, focus.room.name)<source.pos.getFreeTiles().length) {
                        TaskManager.createTask(`HARVEST`, source, focus.room.name);
                    }
                }
            }
        }
    }

    static checkIfExistingTask(type: TaskMemory['type'], target: Mineral | AnyStructure | Source | Resource, colony: string): boolean {
    /**
     * returns true if there is a matching existing task
     */
        const tasks = getAllTaskMemory();
        for (const task of tasks) {
            if (task.type === type && task.targetId === target.id && task.colony === colony && task.status !== `DONE`) {
                return true;
            }
        }
        return false;
    }

    static checkForExistingTasks(type: TaskMemory['type'], target: AnyStructure | Source | Resource, colony: string): number {
        /**
         * Check if there is an existing task of the given type for the target in the specified colony
         */
        // console.log(`Checking for existing tasks of type ${type} for target ${target.id} in colony ${colony} - cpu used to now is ${Game.cpu.getUsed()}`);
        return Object.values(Memory.tasks).filter(task =>
            task.type === type &&
            task.targetId === target.id &&
            task.colony === colony &&
            task.status !== `DONE`
        ).length;
    }

    static createUpgradeTasks(focus: ColonyLike){
        if(focus.room.controller === undefined) return;
        let existingUpgradeTask = Object.values(getAllTaskMemory()).filter(
            task => {
                if(focus.room.controller===undefined) return false;
                return task.type === `UPGRADE` && task.targetId === focus.room.controller.id;
        });
        if(focus.memory.focusOnUpgrade === true) {
            // check if there is an existing upgrade task with priority >20
            let existingHighPriorityUpgradeTask = existingUpgradeTask.find(task => task.priority !== undefined && task.priority > 20);
            if(!existingHighPriorityUpgradeTask){
                TaskManager.createTask(`UPGRADE`, focus.room.controller, focus.room.name,50);
            }
        }
        const existingUpgradeTaskPriority = existingUpgradeTask.find(task => task.priority ?? -10 > -10);
        if (!existingUpgradeTaskPriority) {
            //check if the colony that the controller is in has a focus on upgrade
            TaskManager.createTask(`UPGRADE`, focus.room.controller, focus.room.name,0);

        }
        if( existingUpgradeTask.length<12){
            TaskManager.createTask(`UPGRADE`, focus.room.controller, focus.room.name,-10);
        }
    }

    static createHaulTasks(focus: EmpireLike | ColonyLike){
        // this has to look at all locations where energy can be dropped off and create tasks if energy is required anywhere

        if("colonies" in focus){
            //this will enable future handling of hauling outside colony level logic
            focus.colonies.forEach(colony => {
                TaskManager.createHaulTasks(colony);
            });
        } else{
            //
            // Haul to the upgrade container, which is the container in the room nearest to the controller
            if (focus.upgradeContainers.length > 0) {
                const upgradeContainer = focus.upgradeContainers[0];
                if (upgradeContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    if (!TaskManager.checkIfExistingTask(`HAUL`, upgradeContainer, focus.room.name)) {
                        TaskManager.createTask(`HAUL`, upgradeContainer, focus.room.name, 1);
                    }
                }
            }
            // console.log(`Number of towers: ${focus.towers.length} in ${focus}`);
            if(focus.towers.length>0){
                for(const tower of focus.towers){
                    if(tower.store.getFreeCapacity(RESOURCE_ENERGY)>0){
                        if(!TaskManager.checkIfExistingTask(`HAUL`, tower, focus.room.name)){
                            TaskManager.createTask(`HAUL`, tower, focus.room.name,8);
                        }
                    }
                }
            }
            if(focus.storage && focus.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                // console.log("In here");
                if(TaskManager.checkForExistingTasks(`HAUL`, focus.storage, focus.room.name)===0) {
                    console.log(`Creating haul task for storage in ${focus.room.name}`);
                    if(focus.storage.store[RESOURCE_ENERGY] > 20e3) {
                        TaskManager.createTask(`HAUL`, focus.storage, focus.room.name, -10);
                    }
                    else{
                        TaskManager.createTask(`HAUL`, focus.storage, focus.room.name, 0);
                    }
                }
                // } else{
                //     console.log(`Found a matching task for storage in ${focus.room.name}, ${TaskManager.getExistingTask(`HAUL`, focus.storage, focus.room.name)}`);
                // }
            }
            // haul to the filler containers
            if (focus.fillerContainers.length > 0){
                // console.log(`Creating haul tasks for filler containers in ${focus.room.name}`);
                for(const fillerContainer of focus.fillerContainers){
                    // console.log(`Checking filler container ${fillerContainer.id}`);
                    if(fillerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0){
                        if(!TaskManager.checkIfExistingTask(`HAUL`, fillerContainer, focus.room.name)) {
                            TaskManager.createTask(`HAUL`, fillerContainer, focus.room.name, 10);
                        }
                    }
                }
                this.createFillerTasks(focus);
            } else{
                // Create haul tasks for each spawn in the colony
                focus.spawns.filter(s=>s.store.getFreeCapacity(RESOURCE_ENERGY) > 0).forEach(spawn => {
                    if (!TaskManager.checkIfExistingTask(`HAUL`, spawn, focus.room.name)) {
                        TaskManager.createTask(`HAUL`, spawn, focus.room.name,10);
                    }
                });
                // Create a haul task for extensions
                // console.log(focus.extensions);
                focus.extensions.filter(e=>e.store[RESOURCE_ENERGY] < e.store.getCapacity(RESOURCE_ENERGY)).forEach(extension => {
                    if (!TaskManager.checkIfExistingTask(`HAUL`, extension, focus.room.name)) {
                        TaskManager.createTask(`HAUL`, extension, focus.room.name,10);
                    }
                });
            }
            // haul to storage (if available in the room)

        }
    }

    static createFillerTasks(focus: ColonyLike) {
        /**
         * Create fill tasks for all filler containers in the colony
         */
        // check if there is anywhere left to fill energy
        // console.log(`Energy available in room is ${focus.room.energyAvailable} and energy capacity is ${focus.room.energyCapacityAvailable}`);
        if(focus.room.energyCapacityAvailable>focus.room.energyAvailable){
            // console.log(`Creating fill tasks...`);
            focus.fillerContainers.forEach(container => {
                if (container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    if (TaskManager.checkForExistingTasks(`FILL`, container, focus.room.name) === 0) {
                        TaskManager.createTask(`FILL`, container, focus.room.name, 9);
                    }
                }
            });
        }
    }

    static createPickupTasks(focus: ColonyLike | EmpireLike){
        // once harvest tasks are no longer being created this is where energy enters the system from

        // this has to look at all locations where energy can be picked up and create tasks if energy is available
        if("colonies" in focus) {
            focus.colonies.forEach(colony => {
                TaskManager.createPickupTasks(colony);
            });
        } else{
            if ("sourceContainers" in focus) {
                // check if there is anything to pickup from source containers
                focus.sourceContainers.forEach(container => {
                    if (container.store[RESOURCE_ENERGY] > 0) {
                        if (!this.checkIfExistingTask(`PICKUP`, container, focus.room.name)) {
                            TaskManager.createTask(`PICKUP`, container, focus.room.name);
                        }
                    }
                });
            }
            //check for any energy dropped on the floor
            const droppedResources = focus.room.find(FIND_DROPPED_RESOURCES);
            // console.log(`Found ${droppedResources.length} dropped resources`);
            droppedResources.forEach(resource => {
                if (resource.resourceType === RESOURCE_ENERGY) {
                    // console.log(`Found ${resource.amount} energy dropped at ${resource.pos}`);
                    if (!this.checkIfExistingTask(`PICKUP`, resource, focus.room.name)) {
                        TaskManager.createTask(`PICKUP`, resource, focus.room.name,1);
                    }
                }
            });
            if(focus.storage !== undefined && focus.storage !== null){
                if (focus.storage.store[RESOURCE_ENERGY] > 0) {
                    if (!this.checkIfExistingTask(`PICKUP`, focus.storage, focus.room.name)) {
                        TaskManager.createTask(`PICKUP`, focus.storage, focus.room.name,-15);
                    }
                }
            }
        }
    }
}
