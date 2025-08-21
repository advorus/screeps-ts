import { getCreepMemory, getTaskMemory } from "./memory";

export class TaskManager {
    static createTask(type: TaskMemory['type'], target: AnyStructure | Source | ConstructionSite, colony: string, priority:number = 0, role:string|undefined = undefined): string {
        if(!Memory.tasks) {
            Memory.tasks = {};
        }
        const id = `${type}_${Game.time}_${Math.random()}`;
        Memory.tasks[id] = {id, type, targetId: target.id, status: `PENDING`, colony, priority, role};
        return id;
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
}
