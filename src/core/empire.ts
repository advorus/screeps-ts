import { Colony } from "colony/colony";
import { getEmpireMemory,getCreepMemory, getTaskMemory } from "core/memory";
import { TaskManager } from "core/taskManager";
import { profile } from "Profiler";

// Empire class to manage multiple colonies
// This class is responsible for high-level management of colonies, task creation, and spawning decisions
// It does not directly control creeps or tasks, but coordinates the overall empire strategy

@profile
export class Empire {
    colonies: Colony[];
    memory: EmpireMemory;

    constructor() {
        this.colonies = Object.values(Game.rooms)
        .filter(r=> r.controller && r.controller.my)
        .map(r=> new Colony(r));

        this.memory = getEmpireMemory();
    }

    init() {
        this.memory.lastTick = Game.time;
        if (Memory.tasks === undefined) {
            Memory.tasks = {};
        }
        for (const colony of this.colonies){
            colony.init();
        }
    }

    run() {

        // Empire-level task creation
        TaskManager.createTasks(this);
        // console.log(`Got here`);
        TaskManager.reprioritiseTasks(this);

        // Empire-level spawning decision
        for (const colony of this.colonies) {
            if (colony.getWorkerNeed()) {
                // console.log(`Empire: Spawning worker in ${colony.room.name}`);

                colony.spawnCreep('worker'); // Empire triggers spawn, colony implements details
            }
            if (colony.getMinerNeed()) {
                // console.log(`Colony ${colony.room.name} needs a miner`);
                // console.log(`Empire: Spawning miner in ${colony.room.name}`);
                colony.spawnCreep('miner'); // Empire triggers spawn, colony implements details
            }
        }

        // Empire-level task assignment
        for (const creep of Object.values(Game.creeps)) {
            const creepMemory = getCreepMemory(creep.name);
            if (!creepMemory.taskId) {
                TaskManager.assignTask(creep);
            }
        }

        // console.log(`Got here`);
        for (const colony of this.colonies){
            // Run the colony logic, including task execution
            colony.run();
        }
    }

    post() {
        // console.log(`got here`)
        for(const name in Memory.colonies){
            if(!(name in Game.rooms)){
                delete Memory.colonies[name];
            }
        }
        for(const name in Memory.creeps){
            if(!(name in Game.creeps)){
                delete Memory.creeps[name];
            }
        }
        for(const creep in Game.creeps){
            // if the taskId is no longer in Memory.tasks, delete it from the creep's memory
            const creepMemory = getCreepMemory(creep);
            if (creepMemory.taskId && getTaskMemory(creepMemory.taskId) === undefined) {
                console.log(`Task ${creepMemory.taskId} no longer exists, removing from creep ${creep}'s memory`);
                delete creepMemory.taskId;
            }
        }
        for(const taskId in Memory.tasks){
            const task = getTaskMemory(taskId);
            if(task.targetId!==undefined){
                const target = Game.getObjectById(task.targetId);
                if(target === null){
                    console.log(`Task ${task.id} has an invalid target ${task.targetId}`);
                    delete Memory.tasks[taskId];
                }
            }

            // remove completed tasks
            if(task.status === `DONE`) {
                console.log(`Task ${task.id} completed and so is being deleted`);
                delete Memory.tasks[taskId];
            }
            // remove assigned creeps from tasks if the creep is no longer in the game
            if (task.assignedCreep){
                if(!(task.assignedCreep in Game.creeps)) {
                    console.log(`Creep ${task.assignedCreep} is no longer in the game and so removing it from task`);
                    delete task.assignedCreep;
                    task.status = "PENDING";
                }

            }
        }

        this.memory.cpuUsage ??= [];
        this.memory.cpuUsage.push(Game.cpu.getUsed());
        if(this.memory.cpuUsage.length > 100) this.memory.cpuUsage.shift();
        const avgCpu = _.sum(this.memory.cpuUsage) / this.memory.cpuUsage.length;
        if (Game.time % 25 === 0) {
            console.log(`Empire: Average CPU usage over last 100 ticks: ${avgCpu}`);
        }
        // console.log(Game.cpu.getUsed());
    }
}

