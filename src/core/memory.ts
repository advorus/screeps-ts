export function getEmpireMemory(): EmpireMemory {
    if(!Memory.empire){
        Memory.empire = {};
    }
    return Memory.empire as EmpireMemory;
}

export function getColonyMemory(roomName:string): ColonyMemory {
    if(!Memory.colonies){
        Memory.colonies = {};
    }
    if(!Memory.colonies[roomName]){
        Memory.colonies[roomName] = {
            taskQueue: []
        };
    }
    return Memory.colonies[roomName] as ColonyMemory;
}

export function getTaskMemory(taskId:string): TaskMemory {
    if(!Memory.tasks){
        Memory.tasks = {};
    }
    if(!Memory.tasks[taskId]==undefined){
        Memory.tasks[taskId] = {}
    }
    return Memory.tasks[taskId] as TaskMemory;
}

export function getCreepMemory(creepName:string): CreepMemory {
    if(!Memory.creeps){
        Memory.creeps = {};
    }
    if(!Memory.creeps[creepName]){
        Memory.creeps[creepName] = {};
    }
    return Memory.creeps[creepName] as CreepMemory;
}

export function getAllTaskMemory(): TaskMemory[] {
    if (!Memory.tasks) {
        Memory.tasks = {};
    }
    return Object.values(Memory.tasks) as TaskMemory[];
}
