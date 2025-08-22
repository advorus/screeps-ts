
// import { Empire } from "./empire";
import { getAllTaskMemory, getCreepMemory, getTaskMemory } from "./memory";
// import { Colony } from "colony/colony";
// import { Empire } from "./empire";
import {profile} from "Profiler";

@profile
export class TaskManager {
    static createTask(type: TaskMemory['type'], target: AnyStructure | Source | ConstructionSite | Resource, colony: string, priority:number = 0, role:string|undefined = undefined): string {
        if(!Memory.tasks) {
            Memory.tasks = {};
        }
        const id = `${type}_${Game.time}_${Math.random()}`;
        Memory.tasks[id] = {id, type, targetId: target.id, status: `PENDING`, colony, priority, role};
        return id;
    }

    static getBuildPriority(site: ConstructionSite): number {
        switch(site.structureType) {
            case STRUCTURE_SPAWN:
                return 5;
            case STRUCTURE_TOWER:
                return 4;
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


        for(const task of availableTasks) {
            if(task.id!==undefined && task.targetId!==undefined) {
                // Check if the creep can perform the task
                if (task.type === 'HARVEST' && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                        continue;
                }
                if (task.type === 'UPGRADE' && creep.store[RESOURCE_ENERGY] === 0) {
                    continue;
                }
                if( task.type === 'HAUL' && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
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
                // only miners can pick up mine tasks
                if(task.type === `MINE` && creep.memory.role !== `miner`) {
                    continue;
                }
                // for now - check if the creep is in the same colony as the task
                if (getCreepMemory(creep.name).colony !== getTaskMemory(task.id).colony) {
                    continue;
                }
                task.assignedCreep = creep.name;
                task.status = `IN_PROGRESS`;
                creep.memory.taskId = task.id;
                console.log(`Assigned task ${task.id} of type ${task.type} to creep ${creep.name}`)

                // if the task is a haul task and the energy stored in all creeps assigned to drop off at the target is less than the target's free capacity, create another haul task

                //get a list of all creeps assigned to drop off at the target
                const assignedCreeps = Object.values(Game.creeps).filter(c => {
                    const memory = getCreepMemory(c.name);
                    return memory.taskId && getTaskMemory(memory.taskId).targetId === task.targetId;
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
                // console.log(`Assigned task ${task.id} of type ${task.type} to creep ${creep.name}`);
                return; // Return the assigned task ID
            }
        }
    }

    static createTasks(focus: ColonyLike | EmpireLike) {
        if ("colonies" in focus) {
            for(const colony of focus.colonies) {
                this.createColonyTasks(colony);
            }
        } else {
            this.createColonyTasks(focus)
        }
    }

    static createColonyTasks(colony: ColonyLike) {
        this.createSourceTasks(colony);
        if(colony.room.controller) {
            this.createUpgradeTasks(colony);
        }
        this.createColonyBuildTasks(colony);
        this.createHaulTasks(colony);
        this.createRepairTasks(colony);
    }

    static createRepairTasks(colony: ColonyLike) {
    /**
     * Create repair tasks for damaged structures in the colony
     */
    const damagedStructures = colony.room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax
    });
    for (const structure of damagedStructures) {
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
        if(this.checkForExistingTasks(`REPAIR`, structure, colony.room.name) === 0) {
            this.createTask(`REPAIR`, structure, colony.room.name, priority);
        }
    }
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
            console.log(`Creating build task for ${site.id} in colony ${colony.room.name} with priority ${priority}`);
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
                TaskManager.createTask(`MINE`, source, focus.room.name);
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

    static checkForExistingTasks(type: TaskMemory['type'], target: AnyStructure | Source | Resource, colony: string): number {
        /**
         * Check if there is an existing task of the given type for the target in the specified colony
         */
        return Object.values(Memory.tasks).filter(task =>
            task.type === type &&
            task.targetId === target.id &&
            task.colony === colony &&
            task.status !== `DONE`
        ).length;
    }

    static createUpgradeTasks(focus: ColonyLike){
        if(focus.room.controller === undefined) return;
        const existingUpgradeTask = Object.values(getAllTaskMemory()).filter(
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
        if (!existingUpgradeTask) {
            //check if the colony that the controller is in has a focus on upgrade
            TaskManager.createTask(`UPGRADE`, focus.room.controller, focus.room.name);

        }
        if( existingUpgradeTask.length<4){
            TaskManager.createTask(`UPGRADE`, focus.room.controller, focus.room.name,-5);
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
                    if (TaskManager.checkForExistingTasks(`HAUL`, upgradeContainer, focus.room.name) === 0) {
                        TaskManager.createTask(`HAUL`, upgradeContainer, focus.room.name, 0);
                    }
                }
            }
            // haul to the filler containers
            if (focus.fillerContainers.length > 0){
                for(const fillerContainer of focus.fillerContainers){
                    if(fillerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0){
                        if(TaskManager.checkForExistingTasks(`HAUL`, fillerContainer, focus.room.name) === 0) {
                            TaskManager.createTask(`HAUL`, fillerContainer, focus.room.name, 10);
                        }
                    }
                }
                this.createFillerTasks(focus);
            } else{
                // Create haul tasks for each spawn in the colony
                focus.spawns.filter(s=>s.store.getFreeCapacity(RESOURCE_ENERGY) > 0).forEach(spawn => {
                    if (TaskManager.checkForExistingTasks(`HAUL`, spawn, focus.room.name) === 0) {
                        TaskManager.createTask(`HAUL`, spawn, focus.room.name,10);
                    }
                });
                // Create a haul task for extensions
                console.log(focus.extensions);
                focus.extensions.filter(e=>e.store[RESOURCE_ENERGY] < e.store.getCapacity(RESOURCE_ENERGY)).forEach(extension => {
                    if (TaskManager.checkForExistingTasks(`HAUL`, extension, focus.room.name) === 0) {
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
                        if (this.checkForExistingTasks(`PICKUP`, container, focus.room.name) === 0) {
                            TaskManager.createTask(`PICKUP`, container, focus.room.name);
                        }
                    }
                });
            }
            //check for any energy dropped on the floor
            const droppedResources = focus.room.find(FIND_DROPPED_RESOURCES);
            droppedResources.forEach(resource => {
                if (resource.resourceType === RESOURCE_ENERGY) {
                    if (this.checkForExistingTasks(`PICKUP`, resource, focus.room.name) === 0) {
                        TaskManager.createTask(`PICKUP`, resource, focus.room.name);
                    }
                }
            });
        }
    }
}
