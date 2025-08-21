import { Colony } from "colony/colony";
import { getAllTaskMemory, getCreepMemory, getTaskMemory } from "./memory";
import { Empire } from "./empire";

export class TaskManager {
    static createTask(type: TaskMemory['type'], target: AnyStructure | Source | ConstructionSite, colony: string, priority:number = 0, role:string|undefined = undefined): string {
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
                if ((task.type === 'HAUL' || task.type === "BUILD") && totalEnergy < Game.getObjectById(task.targetId).store.getFreeCapacity(RESOURCE_ENERGY)) {
                    console.log(`Creating a new ${task.type} task for ${task.targetId} in colony ${task.colony} because existing creeps cannot fulfil the energy requirement`);
                    this.createTask(task.type, Game.getObjectById(task.targetId) as AnyStructure | Source, task.colony as string, task.priority || 0);
                }
                return; // Return the assigned task ID
            }
        }
    }

    static createTasks(focus: Colony | Empire) {
        if (focus instanceof Empire) {
            for(const colony of focus.colonies) {
                this.createColonyTasks(colony);
            }
        } else {
            this.createColonyTasks(focus)
        }
    }

    static createColonyTasks(colony: Colony) {
        this.createSourceTasks(colony);
        if(colony.room.controller) {
            this.createUpgradeTasks(colony.room.controller);
        }
        this.createColonyBuildTasks(colony);
        this.createSpawnHaulTasks(colony);
    }

    static createColonyBuildTasks(colony: Colony) {
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

    static createSourceTasks(focus: Colony | Source) {
        if (focus instanceof Colony) {
            // for each free tile around the source create a harvest task
            focus.sources.forEach(source => {
                const freeTiles = source.pos.getFreeTiles();
                freeTiles.forEach(tile => {
                    TaskManager.createTask(`HARVEST`, source, focus.room.name);
                });
            });
        } else {
            const freeTiles = focus.pos.getFreeTiles();
            freeTiles.forEach(tile => {
                TaskManager.createTask(`HARVEST`, focus, focus.room.name);
            });
        }
    }

    static createUpgradeTasks(focus: StructureController){
        const existingUpgradeTask = Object.values(getAllTaskMemory()).filter(
            task => task.type === `UPGRADE` && task.targetId === focus.id
        );
        if (!existingUpgradeTask) {
            TaskManager.createTask(`UPGRADE`, focus, focus.room.name);
        }
        if( existingUpgradeTask.length<4){
            TaskManager.createTask(`UPGRADE`, focus, focus.room.name,-5);
        }
    }

    static createSpawnHaulTasks(focus: StructureSpawn | Colony){
        if (focus instanceof Colony) {
            // Create haul tasks for each spawn in the colony
            focus.spawns.filter(s=>s.store.getFreeCapacity(RESOURCE_ENERGY) > 0).forEach(spawn => {
                TaskManager.createTask(`HAUL`, spawn, focus.room.name,10);
            });
        } else {
            // Create a haul task for the spawn
            TaskManager.createTask(`HAUL`, focus, focus.room.name,10);
        }
    }
}
