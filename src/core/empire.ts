import { Colony } from "colony/colony";
import { getCostMatrixForRoom, removeHostileRoom, getEmpireMemory,getCreepMemory, getTaskMemory, addHostileRoom, getHostileRooms, getAllTaskMemory, getScoutedRoomMemory, checkIfHostileRoom } from "core/memory";
import { TaskManager } from "core/taskManager";
import { get } from "lodash";
import { profile } from "Profiler";
import { getAdjacentConnectedRooms } from "utils/room";

// Empire class to manage multiple colonies
// This class is responsible for high-level management of colonies, task creation, and spawning decisions
// It does not directly control creeps or tasks, but coordinates the overall empire strategy

@profile
export class Empire {
    colonies: Colony[];
    memory: EmpireMemory;
    rescoutThreshold: number = 2000;
    claimTargets: string[] = [];
    dismantleTargets: string[] = [];
    duoAttackTargets: string[] = [];
    withdrawTargets: string[] = [];
    harassTargets: string[] = [];
    roomTerminalsToRebalance: [string,string][] = [];
    minTerminalBuffer: number = 30e3;

    constructor() {
        this.colonies = Object.values(Game.rooms)
        .filter(r=> r.controller && r.controller.my)
        .map(r=> new Colony(r));

        this.memory = getEmpireMemory();
    }

    init() {

        // for(const colony of this.colonies){
        //     const costMatrix = getCostMatrixForRoom(colony.room.name);
        //     if(costMatrix === undefined) continue;
        //     if(colony.room.name!=="W29S16") continue;
        //     console.log(`Cost matrix for room ${colony.room.name}:`);
        //     for (let y = 0; y < 50; y++) {
        //         let row = '';
        //         for (let x = 0; x < 50; x++) {
        //             // number of spaces depends on how many digits the cost value has
        //             const v = costMatrix.get(x, y);
        //             const s = String(v);
        //             row += s;
        //             const pad = Math.max(1, 4 - s.length);
        //             row += ' '.repeat(pad);
        //         }
        //         console.log(row);
        //     }

        // }

        // Memory.hostileRooms = [];
        // Memory.tasks = {};
        this.memory.lastTick = Game.time;
        if (Memory.tasks === undefined) {
            Memory.tasks = {};
        }
        for (const colony of this.colonies){
            // console.log(`Initializing colony in room ${colony.room.name}, cpu used to here ${Game.cpu.getUsed()}`);
            colony.init();
            // console.log(`Cpu used after initializing colony ${colony.room.name}: ${Game.cpu.getUsed()}`);
        }

        Memory.scoutedRooms ??= {};


        // // delete any storage claim tasks
        // const claimTasks = Object.values(Memory.tasks).filter(t => t.type === 'SCOUT');
        // for(const task of claimTasks){
        //     if(task.targetId){
        //         console.log(`Deleting claim task ${task.id} for storage`);
        //         delete Memory.tasks[task.id as string];

        //     }
        // }

        // console.log(`testing`)

        // this.claimTargets = ["W29S13"];
        // this.harassTargets = ["W29S17"]
        // this.dismantleTargets = ["W29S17"];
        // this.duoAttackTargets = ["W29S17"];

        for(const roomName of this.claimTargets){
            //check if the colony already exists - if it does then continue
            if(this.colonies.find(c => c.room.name === roomName)) continue;

        //create a claimer task for E2S19 if it is not in colonies and a claimer task doesn't exist
            if(true){ //(this.colonies.length > 1) {
                if(!Object.values(Memory.tasks).find(t => t.type === 'CLAIM' && t.targetRoom === roomName)) {
                    // console.log(`Creating claim task for room ${roomName}`);
                    // console.log("testing");
                    TaskManager.createTask('CLAIM', this.colonies[0].spawns[0], this.colonies[0].room.name, 5, 'claimer', roomName);
                }
            }

        }
        if(Game.time%30==0){
            for(const target of this.harassTargets){
                // find the nearest colony which is at least RCL 5
                const nearestColony = this.colonies
                    .filter(c => c.room.controller && c.room.controller.level >= 5)
                    .sort((a, b) => Game.map.getRoomLinearDistance(a.room.name, target) - Game.map.getRoomLinearDistance(b.room.name, target))[0];
                if(!nearestColony) continue;
                // create a harass task if it doesn't already exist
                if(!Object.values(Memory.tasks).find(t => t.type === 'HARASS_TOWER' && t.targetRoom === target)) {
                    TaskManager.createTask('HARASS_TOWER', nearestColony.spawns[0], nearestColony.room.name, 5, 'harasser', target);
                }
            }

            for(const target of this.duoAttackTargets){
                const nearestColony = this.colonies
                    .filter(c => c.room.controller && c.room.controller.level >= 5)
                    .sort((a, b) => Game.map.getRoomLinearDistance(a.room.name, target) - Game.map.getRoomLinearDistance(b.room.name, target))[0];
                if(!nearestColony) continue;
                // create a duo attack task if it doesn't already exist
                if(!Object.values(Memory.tasks).find(t => t.type === 'DUO_ATTACK' && t.targetRoom === target)) {
                    const spawnId = nearestColony.spawns[0]?.id;
                    if(spawnId == undefined) continue;
                    TaskManager.createDuoTask('DUO_ATTACK', target, nearestColony.room.name, 5, 'duo_attack', spawnId);
                }
            }

            // for(const target of this.dismantleTargets){
            //     // find the nearest colony which is at least RCL 5
            //     const nearestColony = this.colonies
            //         .filter(c => c.room.controller && c.room.controller.level >= 5)
            //         .sort((a, b) => Game.map.getRoomLinearDistance(a.room.name, target) - Game.map.getRoomLinearDistance(b.room.name, target))[0];
            //     if(!nearestColony) continue;
            //     // create a dismantle task if it doesn't already exist
            //     if(!Object.values(Memory.tasks).find(t => t.type === 'DISMANTLE' && t.targetRoom === target)) {
            //         TaskManager.createTask('DISMANTLE', nearestColony.spawns[0], nearestColony.room.name, 5, 'dismantler', target);
            //     }
            // }

        }
        // if a creep is in a room which is not a colony hub, then check if there are hostiles or hostile towers in that room
        // for(const creep of Object.values(Game.creeps)) {
        //     if(this.colonies.find(c => c.room.name === creep.room.name) === undefined) {
        //         const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
        //         const hostileTowers = creep.room.find(FIND_HOSTILE_STRUCTURES, {
        //             filter: { structureType: STRUCTURE_TOWER }
        //         });
        //         if(hostiles.length > 0 || hostileTowers.length > 0) {
        //             console.log(`Creep ${creep.name} is in a hostile room: ${creep.room.name}`);
        //             addHostileRoom(creep.room.name);
        //         }
        //     }
        // }

        if((Game.time+3)%1500==0){
            console.log(`Empire has ${this.colonies.length} colonies and ${Object.values(Memory.tasks).length} tasks`);
            console.log(`Allocating remote sources...`);
            this.allocateRemoteSources();
        }
        if((Game.time+5)%500 == 0){
            console.log(`Updating cached room data...`);
            this.updateCachedRoomData();
        }





        // for(const target of this.duoAttackTargets){
        //     if(Object.values(Memory.tasks).some(task => task.type === 'DUO_ATTACK' && task.targetRoom === target)) continue;
        //     // Create a new duo attack task
        //     // get a spawn id in room E9S21
        //     const spawnId = this.colonies.find(c => c.room.name === "E9S21")?.spawns[0]?.id;
        //     if(spawnId == undefined) continue;
        //     TaskManager.createDuoTask('DUO_ATTACK', target, "E9S21", 5, 'duo_attack', spawnId);
        // }

        // this.dismantleTargets = ["E8S21"];
        // this.withdrawTargets = [`E11S19`];
        // for(const roomName of this.withdrawTargets){
        //     //check if we can see the room
        //     // if not create a visbility task for the room using the nearest room
        //     const nearestColonyData = this.getNearestColonyName(roomName);
        //     let nearestColonyName = nearestColonyData?.name;
        //     if(!nearestColonyName) continue;
        //     if(!Object.keys(Game.rooms).includes(roomName)){
        //         if(!Object.values(Memory.tasks).some(t => t.type === 'SCOUT' && t.targetRoom === roomName && t.role === `visibility`)){
        //             TaskManager.createTask('SCOUT', this.colonies.find(c => c.room.name === nearestColonyName)?.spawns[0] as StructureSpawn, nearestColonyName, 1, 'visibility', roomName);
        //         }
        //         continue;
        //     }

        //     // if we have visibility of the room check if the room has storage
        //     // if it does then check if there is a remote pickup task from the storage
        //     // if not then create one for whatever resource there is the most of in storage
        //     const room = Game.rooms[roomName];
        //     const storage = room.find(FIND_STRUCTURES, {
        //         filter: (s): s is StructureStorage => s.structureType === STRUCTURE_STORAGE
        //     })[0] as StructureStorage | undefined;
        //     if(storage && storage.store.getUsedCapacity()>100){
        //         const resourceType = Object.keys(storage.store).reduce((a, b) => storage.store[a] > storage.store[b] ? a : b) as ResourceConstant;
        //         if(TaskManager.checkIfExistingTask(`REMOTE_PICKUP`,storage,nearestColonyName)){
        //             TaskManager.createTask('REMOTE_PICKUP', storage, nearestColonyName, 1, 'pickup', resourceType);
        //         }
        //     }
        // }

    }

    run() {
        // collect CPU checkpoints to build a per-tick breakdown for visuals
        const cpuStart = Game.cpu.getUsed();
        // console.log(`The next room to scout for room: ${this.colonies[1].room.name} is ${this.getRoomToScout(this.colonies[0],10)}`);
        // Empire-level task creation
        // addHostileRoom("E4S19");
        if(Game.time%5==0){
            console.log(`Creating new tasks...`);
            TaskManager.createTasks(this);
            // checkpoint: after task creation
        }
        const cpuAfterTasks = Game.cpu.getUsed();
        // console.log(`Got here`);
        TaskManager.reprioritiseTasks(this);
        const cpuAfterReprioritise = Game.cpu.getUsed();

        // console.log(`CPU used after reprioritising tasks: ${Game.cpu.getUsed()}`)

        // console.log(`Empire has ${Object.values(Memory.tasks).length} tasks`);
        // Empire-level spawning decision
        for (const colony of this.colonies) {
            if(!colony.room.controller) continue;
            // if(colony.room.controller?.level <3 || colony.sourceContainers.length === 0) {
                // if (colony.getWorkerNeed()) colony.spawnCreep('worker');
            // }
            // else{
                // console.log(`checking for specific worker needs`)
            if(Game.time%15==0){
                console.log(`Checking spawn needs for colony: ${colony.room.name}`);
                if (colony.getDuoAttackerNeed()) colony.spawnCreep('duo_attacker');
                if (colony.getDuoHealerNeed()) colony.spawnCreep('duo_healer');
                // console.log(`Checking miner need for colony: ${colony.room.name} which is ${colony.getMinerNeed()}`);
                if (colony.getMinerNeed()) colony.spawnCreep('miner');

                if (colony.getHaulerNeed()) colony.spawnCreep('hauler');
                if (colony.getBuilderNeed()) colony.spawnCreep('builder');
                if (colony.getUpgraderNeed()) colony.spawnCreep('upgrader');
                if (colony.room.controller?.level > 3){
                    if (colony.getScoutNeed()) colony.spawnCreep('scout');
                }
                if(colony.getRemoteMinerNeed()) colony.spawnCreep('remote_miner');
                if(colony.getRemoteHaulerNeed()) colony.spawnCreep('remote_hauler');
                if (colony.getHarasserNeed()) colony.spawnCreep('harasser');
                if(colony.getDismantlerNeed()) colony.spawnCreep('dismantler');
            // }
                if(colony.spawns.length<1){
                    // the first colony not with the colony names should spawn a builder, registered to the new colony name
                    // @todo: this logic should be improved to find the nearest colony
                    if(!colony.room.name) continue;
                    const anotherColony = this.getNearestColonyName(colony.room.name, false)?.name;//this.colonies.find(c => c.room.name !== colony.room.name);
                    if (anotherColony) {
                        // if the colony has less than 3 workers, spawn one and send it to the new colony
                        if(colony.creeps.filter(c => c.memory.role === 'worker').length < 3){
                            // console.log(`Trying to spawn workers using ${anotherColony} for ${colony.room.name} which has no spawn`);
                            this.colonies.find(c => c.room.name === anotherColony)?.spawnCreep('worker', colony.room.name);
                        }
                    }
                }
            }

            if(Game.time%1 == 0){
                // check if the room has a scout task
                if(getAllTaskMemory().filter(task => task.type === 'SCOUT' && task.colony === colony.room.name && task.role !== `visibility`).length <2){
                    //if not, create one using the nearest room to scout
                    const nearestRoom = this.getRoomToScout(colony, 4);

                    if (nearestRoom) {
                        // Do not create non-visibility scout tasks for rooms already marked hostile
                        try {
                            if (!checkIfHostileRoom(nearestRoom)) {
                                TaskManager.createTask("SCOUT", colony.room.controller as StructureController, colony.room.name, 1, 'scout', nearestRoom);
                            } else {
                                // skip creating a scout for a known hostile room
                                try { console.log(`[Empire] skipping SCOUT for hostile room ${nearestRoom}`); } catch(e) {}
                            }
                        } catch (e) {
                            // on any error, fall back to creating the scout
                            TaskManager.createTask("SCOUT", colony.room.controller as StructureController, colony.room.name, 1, 'scout', nearestRoom);
                        }
                    }
                }
            }
        }
        // checkpoint: after colony spawning decisions
        const cpuAfterSpawning = Game.cpu.getUsed();
        // if there is an unassigned claimer task then spawn a claimer creep
        if (TaskManager.hasUnassignedTask(this, 'CLAIM')) {
            const colony = this.colonies[0]; // Get the first colony - improve to find the nearest room to the claimer task
            colony.spawnCreep('claimer');
        }

        // Empire-level task assignment

        if((Game.time+2)%5==0){
            console.log(`Starting empire-level task assignment, cpu usage: ${Game.cpu.getUsed()}`);
            for (const creep of Object.values(Game.creeps)) {
                const creepMemory = getCreepMemory(creep.name);
                if (!creepMemory.taskId) {
                    TaskManager.assignTask(creep);
                }
            }

            const cpuAfterAssign = Game.cpu.getUsed();
            console.log(`Finished empire-level task assignment, cpu usage: ${cpuAfterAssign}`);
        }
        // console.log(`Got here`);
        const perColonyCpu: { [roomName: string]: number } = {};
        for (const colony of this.colonies){
            // Run the colony logic, including task execution and record per-colony CPU
            try {
                const cpuBeforeColony = Game.cpu.getUsed();
                colony.run();
                const cpuAfterColony = Game.cpu.getUsed();
                perColonyCpu[colony.room.name] = cpuAfterColony - cpuBeforeColony;
            } catch (e) {
                // ensure an error in one colony doesn't break the loop
                perColonyCpu[colony.room.name] = 0;
            }
        }
        const cpuAfterColonies = Game.cpu.getUsed();

        for(let roomName of Object.keys(Memory.scoutedRooms)){
            // generate a game.map.visual of a tick over the room, containing key info
            // if the room is in hostile rooms display that info too
            const centerPos = new RoomPosition(25,25,roomName)
            if (checkIfHostileRoom(roomName)){
                Game.map.visual.text(`❌`, centerPos, { align: 'center', opacity: 0.8, color: 'red' });
            } else{
               Game.map.visual.text(`✅ - ${getScoutedRoomMemory(roomName)?.sources.length}s`,centerPos, { align: 'center', opacity: 0.8 });
            }
        }
        // generate a map visual linking colonies and remote rooms (allocated in grey, switched on in green)
        for(let colony of this.colonies){
            const colonyPos = new RoomPosition(25, 25, colony.room.name);
            if(colony && colony.memory.remoteSources){
                for(let remoteSource of colony.memory.remoteSources){
                    const remotePos = new RoomPosition(25, 25, remoteSource.room);
                    if (remoteSource.active){
                        Game.map.visual.line(colonyPos, remotePos, {color: 'green', opacity: 0.5});
                    } else {
                        Game.map.visual.line(colonyPos, remotePos, {color: 'grey', opacity: 0.5});
                    }
                }
            }
        }

        // }
        if(this.roomTerminalsToRebalance.length > 0){
            this.rebalanceTerminals();
        }
        if(Game.time%10==0){
            const cpuBeforeMarket = Game.cpu.getUsed();
            console.log(`CPU used before market functions: ${cpuBeforeMarket}`);
            this.checkEnergyMarket();
            const cpuAfterMarket = Game.cpu.getUsed();
            console.log(`CPU used after market functions: ${cpuAfterMarket}`);

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
                // console.log(`Task ${creepMemory.taskId} no longer exists, removing from creep ${creep}'s memory`);
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
                // console.log(`Task ${task.id} completed and so is being deleted`);
                delete Memory.tasks[taskId];
            }
            // remove assigned creeps from tasks if the creep is no longer in the game
            if (task.assignedCreep){
                if(!(Object.keys(Game.creeps).includes(task.assignedCreep))) {
                    // console.log(`Creep ${task.assignedCreep} is no longer in the game and so removing it from task`);
                    delete Memory.tasks[taskId]
                }
            }

            //if the task is a haul task priority 0, target is storage and the storage has greater than 20e3 energy in it, delete the task
            if(task.type === `HAUL` && task.priority === 0) {
                if(!task.targetId) continue;
                const target = Game.getObjectById(task.targetId);
                if(target && target.structureType === STRUCTURE_STORAGE) {
                    if(target.store[RESOURCE_ENERGY] > 20000) {
                        // console.log(`Deleting task ${task.id} because its target has enough energy`);
                        delete Memory.tasks[taskId];
                    }
                }
            }
        }

        for(const taskId in Memory.tasks){
            const task = getTaskMemory(taskId) as DuoTaskMemory;

            if(task.healer === undefined) continue;
            if(task.attacker === undefined) continue;
            if(!(Object.keys(Game.creeps).includes(task.healer))) {
                // the duo has been broken
                // console.log(`Healer creep ${task.healer} is no longer in the game and so removing it from task`);
                delete Memory.tasks[taskId];
            }
            if(!(Object.keys(Game.creeps).includes(task.attacker))) {
                // the duo has been broken
                // console.log(`Attacker creep ${task.attacker} is no longer in the game and so removing it from task`);
                delete Memory.tasks[taskId];
            }
        }

        for(const colony of this.colonies){
            if(colony.memory.creepColors===undefined) continue;
            for(const creep of Object.keys(colony.memory.creepColors)){
                if (!(creep in Game.creeps)) {
                    delete colony.memory.creepColors[creep];
                }
            }
        }

        this.memory.cpuUsage ??= [];
        this.memory.cpuUsage.push(Game.cpu.getUsed());
        if(this.memory.cpuUsage.length > 1000) this.memory.cpuUsage.shift();
        const avgCpu = _.sum(this.memory.cpuUsage) / this.memory.cpuUsage.length;
        if (Game.time % 25 === 0) {
            console.log(`Empire: Average CPU usage over last 1000 ticks: ${avgCpu}`);
            if(Game.time %500 == 0) {
                if(avgCpu < 0.7 * Game.cpu.limit) {
                    this.turnOnSingleRemoteSource();
                }
                if(avgCpu > 0.9 * Game.cpu.limit) {
                    this.turnOffSingleRemoteSource();
                }
            }
        } else {
            // console.log(`Empire: CPU usage this tick: ${Game.cpu.getUsed()}`);
        }


        // console.log(Game.cpu.getUsed());

        // Draw CPU usage breakdown as RoomVisuals in bottom-right of each colony room
        // try {
        //     const breakdown = (this.memory as any).lastCpuBreakdown;
        //     for (const colony of this.colonies) {
        //         if (!colony.room) continue;
        //         const roomName = colony.room.name;
        //         const vis = new RoomVisual(roomName);
        //         const baseX = 42;
        //         const baseY = 42;
        //         const b = breakdown ?? { total: Game.cpu.getUsed(), createTasks: 0, reprioritise: 0, spawningDecisions: 0, assignTasks: 0, colonies: 0, market: 0, colonyPerRoom: {} };
        //         const total = b.total || 0.0001;

        //         // background box
        //         vis.rect(baseX - 1, baseY - 1, 8, 7, { fill: 'rgba(0,0,0,0.6)', stroke: 'transparent' });
        //         vis.text(`CPU ${total.toFixed(1)}`, baseX, baseY - 1, { color: 'yellow', align: 'left', font: 0.6 });

        //         const parts = [
        //             { key: 'createTasks', label: 'Tasks', color: '#f1c40f' },
        //             { key: 'reprioritise', label: 'Reprio', color: '#e67e22' },
        //             { key: 'spawningDecisions', label: 'Spawn', color: '#2ecc71' },
        //             { key: 'assignTasks', label: 'Assign', color: '#3498db' },
        //             { key: 'colonies', label: 'Colony', color: '#9b59b6' },
        //             { key: 'market', label: 'Market', color: '#e74c3c' },
        //         ];

        //         // draw labels for the categories on the left
        //         let line = 0;
        //         for (const part of parts) {
        //             vis.text(part.label, baseX, baseY + line, { color: part.color, align: 'left', font: 0.45 });
        //             line += 1;
        //         }

        //         // three stacked bars: avg1000, avg100, lastTick — positioned to fit on screen
        //         try {
        //             const history = (colony.memory.cpuHistory as any[]) || [];

        //             const avgSlice = (arr: any[], n: number) => {
        //                 const slice = arr.slice(Math.max(0, arr.length - n));
        //                 if (slice.length === 0) return { assign: 0, towers: 0, visualizer: 0, total: 0 };
        //                 const sum = slice.reduce((acc, v) => ({ assign: acc.assign + (v.assign||0), towers: acc.towers + (v.towers||0), visualizer: acc.visualizer + (v.visualizer||0), total: acc.total + (v.total||0) }), { assign: 0, towers: 0, visualizer: 0, total: 0 });
        //                 return { assign: sum.assign / slice.length, towers: sum.towers / slice.length, visualizer: sum.visualizer / slice.length, total: sum.total / slice.length };
        //             };

        //             const avg1000 = avgSlice(history, 1000);
        //             const avg100 = avgSlice(history, 100);
        //             const last = history.length > 0 ? history[history.length - 1] : { assign: 0, towers: 0, visualizer: 0, total: 0 };

        //             const chartBaseX = baseX - 2;
        //             const chartBaseY = baseY + 0.6;
        //             const chartH = 3.6;
        //             const barW = 1.2;
        //             const spacing = 1.6;

        //             // compute per-colony stats across all colonies so we can distribute empire overhead
        //             const colonyStats = this.colonies.map(c => {
        //                 const h = (c.memory.cpuHistory as any[]) || [];
        //                 const avg = (arr: any[], n: number) => {
        //                     const slice = arr.slice(Math.max(0, arr.length - n));
        //                     if (slice.length === 0) return 0;
        //                     return slice.reduce((acc, v) => acc + (v.total || 0), 0) / slice.length;
        //                 };
        //                 return {
        //                     name: c.room.name,
        //                     avg1000: avg(h, 1000),
        //                     avg100: avg(h, 100),
        //                     last: h.length > 0 ? (h[h.length - 1].total || 0) : 0,
        //                     avg1000Parts: h.length > 0 ? (h[h.length - 1]) : { assign: 0, towers: 0, visualizer: 0 }
        //                 };
        //             });

        //             const sum1000 = colonyStats.reduce((s, v) => s + v.avg1000, 0) || 0.0001;
        //             const sum100 = colonyStats.reduce((s, v) => s + v.avg100, 0) || 0.0001;
        //             const sumLast = colonyStats.reduce((s, v) => s + v.last, 0) || 0.0001;

        //             const empireBreakdown = (this.memory as any).lastCpuBreakdown;
        //             const empireOverhead = empireBreakdown ? Math.max(0, empireBreakdown.total - (empireBreakdown.colonies || 0)) : 0;

        //             const bars = [ { label: 'avg1000', data: avg1000 }, { label: 'avg100', data: avg100 }, { label: 'last', data: last } ];

        //             // distribute empireOverhead proportionally across colonies for each metric
        //             const getOverheadShare = (metric: 'avg1000' | 'avg100' | 'last', idx: number) => {
        //                 const col = colonyStats[idx];
        //                 if (!col) return 0;
        //                 if (metric === 'avg1000') return empireOverhead * (col.avg1000 / sum1000 || 0);
        //                 if (metric === 'avg100') return empireOverhead * (col.avg100 / sum100 || 0);
        //                 return empireOverhead * (col.last / sumLast || 0);
        //             };

        //             // compute maximum total after adding overhead to scale bars
        //             let maxTotal = 0.1;
        //             for (let i = 0; i < bars.length; i++) {
        //                 const metric = i === 0 ? 'avg1000' : (i === 1 ? 'avg100' : 'last');
        //                 const col = colonyStats[i] || { avg1000: bars[i].data.total, avg100: bars[i].data.total, last: bars[i].data.total };
        //                 const totalWithOverhead = bars[i].data.total + getOverheadShare(metric as any, i);
        //                 if (totalWithOverhead > maxTotal) maxTotal = totalWithOverhead;
        //             }

        //             // draw bars left-to-right, adding an 'Empire' gray segment
        //             for (let i = 0; i < bars.length; i++) {
        //                 const x = chartBaseX + i * spacing;
        //                 let yBottom = chartBaseY + chartH;
        //                 const metric = i === 0 ? 'avg1000' : (i === 1 ? 'avg100' : 'last');
        //                 const overheadShare = getOverheadShare(metric as any, i);
        //                 const segVals = [ { val: bars[i].data.assign || 0, color: '#f1c40f' }, { val: bars[i].data.towers || 0, color: '#3498db' }, { val: bars[i].data.visualizer || 0, color: '#9b59b6' } ];
        //                 for (const seg of segVals) {
        //                     const segH = Math.max(0, (seg.val / maxTotal) * chartH);
        //                     if (segH > 0.001) {
        //                         vis.rect(x, yBottom - segH, barW, segH, { fill: seg.color, stroke: '#111111', strokeWidth: 0.03, opacity: 0.98 });
        //                         yBottom -= segH;
        //                     }
        //                 }
        //                 if (overheadShare > 0.001) {
        //                     const h = Math.max(0, (overheadShare / maxTotal) * chartH);
        //                     vis.rect(x, yBottom - h, barW, h, { fill: '#95a5a6', stroke: '#111111', strokeWidth: 0.03, opacity: 0.9 });
        //                     yBottom -= h;
        //                 }

        //                 vis.text(bars[i].label, x + barW / 2, chartBaseY + chartH + 0.5, { color: '#ffffff', align: 'center', font: 0.5 });
        //                 const totalVal = (bars[i].data.total || 0) + overheadShare;
        //                 vis.text(`${totalVal.toFixed(2)}`, x + barW / 2, chartBaseY - 0.5, { color: 'yellow', align: 'center', font: 0.55 });
        //             }

        //             // legend to the right
        //             const legendX = chartBaseX + bars.length * spacing + 0.4;
        //             vis.rect(legendX, chartBaseY, 0.6, 0.6, { fill: '#f1c40f' }); vis.text('Assign', legendX + 0.8, chartBaseY + 0.3, { color: '#ffffff', align: 'left', font: 0.45 });
        //             vis.rect(legendX, chartBaseY + 0.8, 0.6, 0.6, { fill: '#3498db' }); vis.text('Towers', legendX + 0.8, chartBaseY + 1.1, { color: '#ffffff', align: 'left', font: 0.45 });
        //             vis.rect(legendX, chartBaseY + 1.6, 0.6, 0.6, { fill: '#9b59b6' }); vis.text('Visual', legendX + 0.8, chartBaseY + 1.9, { color: '#ffffff', align: 'left', font: 0.45 });
        //             vis.rect(legendX, chartBaseY + 2.4, 0.6, 0.6, { fill: '#95a5a6' }); vis.text('Empire overhead', legendX + 0.8, chartBaseY + 2.7, { color: '#ffffff', align: 'left', font: 0.45 });
        //         } catch (e) {}
        //     }
        // } catch (e) {
        //     // swallow visual errors to avoid breaking logic
        // }

        // clean any scouted room data which is greater than 6 linear distance from a colony
        if (Game.time%5000 == 0){
            for (const roomName in Memory.scoutedRooms) {
                let shouldDelete = true;
                for (const colony of this.colonies) {
                    if (Game.map.getRoomLinearDistance(colony.room.name, roomName) < 6) {
                        shouldDelete = false;
                        break;
                    }
                }
                if (shouldDelete) {
                    delete Memory.scoutedRooms[roomName];
                }
            }

            for (let hostileRoomIdx =0; hostileRoomIdx < Object.keys(Memory.hostileRooms).length; hostileRoomIdx++){
                let shouldDelete = true;
                for (const colony of this.colonies) {
                    if (Game.map.getRoomLinearDistance(colony.room.name, Memory.hostileRooms[hostileRoomIdx].roomName) < 6) {
                        shouldDelete = false;
                        break;
                    }
                }
                if (shouldDelete) {
                    removeHostileRoom(Memory.hostileRooms[hostileRoomIdx].roomName);
                }
            }
        }
    }



    getNearestColonyName(roomName: string, allowSelf: boolean = true): {name:string, distance: number} | null {
        let nearestColony: Colony | null = null;
        let nearestDistance = Infinity;

        for (const colony of this.colonies) {
            if (colony.room.name === roomName && !allowSelf) continue;
            const routeBtwRooms = Game.map.findRoute(colony.room.name, roomName, {
                routeCallback(roomName, fromRoomName) {
                    if(checkIfHostileRoom(roomName)) return Infinity;
                    return 1;
                }
            });
            let distance = Infinity;
            if (routeBtwRooms == -2) continue;
            else{
                distance = routeBtwRooms.length;
            }
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestColony = colony;
            }
        }

        return nearestColony ? {name: nearestColony.room.name, distance: nearestDistance} : null;
    }

    getRoomToScout(colony:Colony, maxSearchDepth: number = 10): string | null{
        /**
         * Find a room to scout for the given colony.
         * Will do a breadth-first-search up to 10 tiles away and return the first available room. Consider an branch dead in the bfs if it reaches a hostile room seen in the last 3000 ticks or gets to a room in the list of colonies.
         * If no room is found, return null.
         */

        const startRoom = colony.room.name;
        const visited = new Set<string>();
        const queue: { room: string, depth: number }[] = [{ room: startRoom, depth: 0 }];

        const hostileRooms = getHostileRooms().filter(r => r.lastSeen > Game.time - this.rescoutThreshold).map(r => r.roomName);
        const colonyRooms = this.colonies.map(c => c.room.name);

        while(queue.length>0){
            const {room,depth} = queue.shift()!;
            // console.log(`Checking room ${room} at depth ${depth}`);
            if(depth > maxSearchDepth) continue;
            if(visited.has(room)) continue;
            visited.add(room);
            // console.log(`Visiting room ${room} at depth ${depth}`);

            if(!(getHostileRooms().some(r=>r.roomName==room && r.lastSeen > Game.time - 3000))){ // && !colonyRooms.includes(room)){
                let srMem = getScoutedRoomMemory(room);
                if(srMem === undefined) {
                    // console.log(`Room ${room} has not been scouted yet, returning as room to scout`);
                    return room;
                } else{
                    //need to check that it has been a while since we scouted the room
                    if(!(srMem.lastScouted > Game.time - this.rescoutThreshold)) return room;
                }
            }

            if(getHostileRooms().some(r=>r.roomName==room && r.lastSeen > Game.time - 3000)){// || Object.keys(this.colonies).includes(room)) {
                // If we found a hostile room, we need to remember it
                continue;
            }

            // console.log(`Adjacent rooms for ${room}: ${getAdjacentConnectedRooms(room)}`);
            const adjacentRooms = getAdjacentConnectedRooms(room);
            for(const adjacentRoom of adjacentRooms){
                if(!visited.has(adjacentRoom)){
                    queue.push({ room: adjacentRoom, depth: depth + 1 });
                }
            }
        }

        return null;
    }

    allocateRemoteSources(): void {
        for(const colony of this.colonies){
            //set all remote sources to empty as we are going to reallocate
            // and there could be new closer rooms since the last allocation
            colony.memory.remoteSources = [];
        }

        for(const remoteRoom of Object.keys(Memory.scoutedRooms)){
            // console.log(`Trying to allocate remote sources in ${remoteRoom}`);
            if(checkIfHostileRoom(remoteRoom)) continue; // cannot allocate hostile room sources

            const scoutedRoomMemory = getScoutedRoomMemory(remoteRoom);
            if(!scoutedRoomMemory) continue;

            // If we don't have controller info for the scouted room, schedule a visibility scout
            if(!scoutedRoomMemory.controller) {
                const nearest = this.getNearestColonyName(remoteRoom);
                if(nearest) {
                    const nearestColony = this.colonies.find(c => c.room.name === nearest.name);
                    if(nearestColony && nearestColony.spawns[0]){
                        if(!TaskManager.checkIfExistingTask(`SCOUT`, nearestColony.spawns[0], nearest.name)){
                            TaskManager.createTask(`SCOUT`, nearestColony.spawns[0], nearest.name, 0, `visibility`, remoteRoom);
                        }
                    }
                }
                continue;
            }

            // Skip rooms that have been reserved by another player until we re-scout them
            if(scoutedRoomMemory.controller.reserved) continue;

            if(scoutedRoomMemory.sources.length === 0) continue;

            // now get the closest colony to the remote room
            const closestColonyName = this.getNearestColonyName(remoteRoom)
            if(!closestColonyName) continue;
            if(closestColonyName.distance > 3 ) continue; //don't assign remote sources a long way from the colony

            const closestColony = this.colonies.find(c => c.room.name === closestColonyName.name);
            if(!closestColony) continue;
            if(closestColony.spawns.length === 0) continue; // don't assign remote sources if the colony has no spawns

            // allocate the sources in the remote room to the closest colony
            for(const sourceId of scoutedRoomMemory.sources){
                // this will only allocate sources that we can currently see
                // const source = Game.getObjectById(sourceId as Id<Source>) as Source | null;
                // if(!source) continue;
                closestColony.memory.remoteSources ??= [];
                closestColony.memory.remoteSources.push({id: sourceId, active: false, distance: closestColonyName.distance, room: remoteRoom});
            }
        }
    }

    turnOnSingleRemoteSource(): void {
        // find the best source (as determined by distance) across the colonies and set its active flag
        let bestSource = null;
        for(const colony of this.colonies){
            if(!colony.room.controller) continue;
            if(colony.room.controller.level <3) continue;
            if(colony.memory.remoteSources === undefined) continue;
            for(const remoteSource of colony.memory.remoteSources){
                if(remoteSource.active) continue;
                if(!bestSource || remoteSource.distance < bestSource.distance){
                    bestSource = remoteSource;
                }
            }
        }
        if(bestSource){
            bestSource.active = true;
            console.log(`Activated remote source ${bestSource.id} in room ${bestSource.room}`);
        }
    }

    turnOffSingleRemoteSource(): void {
        // find the worst source (as determined by distance across the colonies and set its active flag to false
        let worstSource = null;
        for(const colony of this.colonies){
            if(colony.memory.remoteSources === undefined) continue;
            for(const remoteSource of colony.memory.remoteSources){
                if(!remoteSource.active) continue;
                if(!worstSource || remoteSource.distance > worstSource.distance){
                    worstSource = remoteSource;
                }
            }
        }
        if(worstSource){
            worstSource.active = false;
            console.log(`Deactivated remote source ${worstSource.id} in room ${worstSource.room}`);
        }
    }

    turnOffAllRemoteSources(): void {
        for(const colony of this.colonies){
            if(colony.memory.remoteSources === undefined) continue;
            for(const remoteSource of colony.memory.remoteSources){
                remoteSource.active = false;
            }
        }
    }

    /**
     * Check the energy market for any inversions and deal on the arb if necessary
     */
    checkEnergyMarket(): void {
        // need to check if I have a valid pair of terminals to deal on any arb if necessary
        const terminals = Object.values(Game.rooms).map(room => room.terminal).filter(terminal => terminal);
        const terminalsAvailable = terminals.filter(terminal => terminal?.cooldown == 0 && terminal.store[RESOURCE_ENERGY] > this.minTerminalBuffer) as StructureTerminal[];
        // console.log(`Terminals available for trading: ${terminalsAvailable.length}`);
        if(terminalsAvailable.length < 2) return;

        // now need to get all energy orders in the market
        // const energyOrders = Game.market.getAllOrders().filter(order => order.resourceType === RESOURCE_ENERGY);
        const sellOrders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: RESOURCE_ENERGY});
        const buyOrders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: RESOURCE_ENERGY});

        // Check if there are any orders at all
        if(buyOrders.length === 0 || sellOrders.length === 0) return;

        // get the order with the highest buy and sell prices
        const maxPriceBuyOrder = buyOrders.reduce((max, order) => order.price > max.price ? order : max, buyOrders[0]);
        const minPriceSellOrder = sellOrders.reduce((min, order) => order.price < min.price ? order : min, sellOrders[0]);
        console.log(`Max buy order: ${maxPriceBuyOrder.price} from ${maxPriceBuyOrder.roomName}, Min sell order: ${minPriceSellOrder.price} from ${minPriceSellOrder.roomName}`);

        if(maxPriceBuyOrder && minPriceSellOrder && maxPriceBuyOrder.price > minPriceSellOrder.price) {
            // we have an arbitrage opportunity
            // console.log(`Arbitrage opportunity found! Buying energy at ${minPriceSellOrder.price} and selling at ${maxPriceBuyOrder.price}`);
            // the size of the arb
            // let amount = Math.min(maxPriceBuyOrder.amount, minPriceSellOrder.amount);
            // need to bound the amount by the amount that we have the credits to buy, and that we can deliver to the buyer, and the amount that we can accept from the seller (accounting for transaction costs)
            const creditBalance = Game.market.credits;
            // amount= Math.min(amount, Math.floor(creditBalance / minPriceSellOrder.price));

            // generate all permutations of pairs of terminals
            const permutations: [StructureTerminal, StructureTerminal][] = [];
            for(let i=0; i<terminalsAvailable.length; i++){
                for(let j=i+1; j<terminalsAvailable.length; j++){
                    permutations.push([terminalsAvailable[i], terminalsAvailable[j]]);
                    permutations.push([terminalsAvailable[j], terminalsAvailable[i]]);
                }
            }

            let profit = 0;
            let mostProfitablePair: [StructureTerminal, StructureTerminal] | null = null;
            let bestBuyingAmount: number | null = null;
            let bestSellingAmount: number | null = null;
            let sellerCosts: number | null = null;
            let buyerCosts: number | null = null;

            if(minPriceSellOrder.roomName === undefined || maxPriceBuyOrder.roomName === undefined) return;
            console.log(`Calculating profit potential for ${permutations.length} terminal pairs`);
            for(const [terminalA,terminalB] of permutations){
                // let pairAmount = amount;
                // need to find the maximum amount that we can trade, noting that we will have to cover transaction costs
                // find the maximum amount we can buy, which is limited by credits and being able to cover transaction costs and the amount of the sell order
                const buyTransactionCosts = Game.market.calcTransactionCost(1000, minPriceSellOrder.roomName, terminalA.room.name);
                const maxBuyAmount = Math.min(minPriceSellOrder.amount, Math.floor(creditBalance/minPriceSellOrder.price), terminalA.store.getUsedCapacity(RESOURCE_ENERGY)/buyTransactionCosts*1000);

                // find the maximum amount we can sell, which is limited by the amount of the buy order and the amount we have in the terminal, accounting for transaction costs
                const sellTransactionCosts = Game.market.calcTransactionCost(1000, terminalB.room.name, maxPriceBuyOrder.roomName);
                const maxSellAmount = Math.min(maxPriceBuyOrder.amount, terminalB.store.getUsedCapacity(RESOURCE_ENERGY) - Math.ceil(sellTransactionCosts*terminalB.store.getUsedCapacity(RESOURCE_ENERGY)/1000));

                // take the minimum of the two
                const maxPairAmount = Math.min(maxBuyAmount,maxSellAmount);

                // need to get the cost of sending the energy from the room we bought from to the room we sold from, so we are net neutral
                const transferCosts = Game.market.calcTransactionCost(1000, terminalA.room.name, terminalB.room.name);

                const buyingAmount = maxPairAmount;
                const amountReceivedBuy = Math.floor(buyingAmount-(buyTransactionCosts? buyTransactionCosts:0) * (buyingAmount / 1000));
                const transferAmount = Math.floor(amountReceivedBuy-(transferCosts?transferCosts:0)*(amountReceivedBuy/1000));
                const sellingAmount = Math.floor((1000*transferAmount)/(1000+sellTransactionCosts));

                const profitPotential = sellingAmount*maxPriceBuyOrder.price - buyingAmount*minPriceSellOrder.price; // this is an amount of credits

                console.log(`Pair buyer: ${terminalA.room.name}, seller: ${terminalB.room.name} can buy ${buyingAmount}, sell ${sellingAmount} for a profit of ${profitPotential}`);
                // console.log(`${terminalA.room.name} would buy ${buyingAmount} Energy at ${minPriceSellOrder.price*buyingAmount} credits and gains ${amountReceivedBuy} energy post deal based on ${buyTransactionCosts} per 1k`);
                // console.log(`${terminalB.room.name} would sell ${sellingAmount} Energy at ${maxPriceBuyOrder.price*sellingAmount} credits and loses ${sellingAmount+(sellTransactionCosts? sellTransactionCosts:0) * (sellingAmount / 1000)} energy post deal based on ${sellTransactionCosts} per 1k`);
                // console.log(`When rebalancing, ${terminalA.room.name} would send ${amountReceivedBuy} energy to ${terminalB.room.name}, who would receive ${transferAmount} energy given the cost of ${transferCosts} per 1k`);
                if(profitPotential > profit){
                    console.log(`New most profitable pair found! Profit of ${profitPotential} credits`);
                    profit = profitPotential;
                    mostProfitablePair = [terminalA,terminalB];
                    sellerCosts = sellTransactionCosts;
                    buyerCosts = buyTransactionCosts;
                    bestBuyingAmount = buyingAmount;
                    bestSellingAmount = sellingAmount;
                }
            }

            if(mostProfitablePair!== undefined && mostProfitablePair !== null){
                if(bestBuyingAmount && bestSellingAmount){
                    const pair1Name = mostProfitablePair[0].room.name;
                    const pair2Name = mostProfitablePair[1].room.name;

                    console.log(`Buying ${bestBuyingAmount} Energy at ${minPriceSellOrder.price*bestBuyingAmount} credits with transaction costs ${buyerCosts? buyerCosts:0 * bestBuyingAmount / 1000}`);
                    console.log(`Selling ${bestSellingAmount} Energy at ${maxPriceBuyOrder.price*bestSellingAmount} credits with transaction costs ${sellerCosts? sellerCosts:0 * bestSellingAmount / 1000}`);
                    Game.market.deal(minPriceSellOrder.id, bestBuyingAmount, pair1Name);
                    Game.market.deal(maxPriceBuyOrder.id, bestSellingAmount, pair2Name);
                    if(Memory.profit == undefined){
                        Memory.profit = profit;
                    }else{
                        Memory.profit+=profit;
                    }
                    if(!this.roomTerminalsToRebalance.some(pair => pair[0] === pair1Name && pair[1] === pair2Name)){
                        console.log(`Adding new terminal pair to rebalance: ${pair1Name} -> ${pair2Name}`);
                        this.roomTerminalsToRebalance.push([pair1Name, pair2Name]);
                    }
                }
            }
        }
    }
    rebalanceTerminals(): void {
        for(const pair of this.roomTerminalsToRebalance){
            const roomA = Game.rooms[pair[0]];
            const roomB = Game.rooms[pair[1]];
            if(!roomA || !roomB) continue;

            const termA = roomA.terminal;
            const termB = roomB.terminal;
            if(!termA || !termB) continue;
            if(termA.cooldown>0 || termB.cooldown>0) continue;
            if(termA.store[RESOURCE_ENERGY] >= this.minTerminalBuffer && termB.store[RESOURCE_ENERGY]>=this.minTerminalBuffer){
                this.roomTerminalsToRebalance = this.roomTerminalsToRebalance.filter(p => p !== pair);
                console.log(`Both terminals have enough energy`);
            }
            const excessA = termA.store[RESOURCE_ENERGY]-this.minTerminalBuffer;
            const deficitB = this.minTerminalBuffer - termB.store[RESOURCE_ENERGY];
            console.log(`Rebalancing terminals - have ${excessA} excess energy in ${roomA.name} and ${deficitB} deficit energy in ${roomB.name}`);

            if(excessA > 0 && deficitB > 0){
                const transferCosts = Game.market.calcTransactionCost(1000,roomA.name,roomB.name);
                const transferAmount = Math.min(excessA-Math.ceil(transferCosts*excessA/1000), deficitB);
                if(termA.send(RESOURCE_ENERGY, transferAmount, roomB.name)=== OK) {
                    console.log(`Sent ${transferAmount} energy from ${roomA.name} to ${roomB.name}`);
                    // remove the pair from the list
                    this.roomTerminalsToRebalance = this.roomTerminalsToRebalance.filter(p => p !== pair);
                }
            }
        }
    }

    updateCachedRoomData(): void {
        // get a list of all rooms that we can currently see
        if(!Memory.scoutedRooms) Memory.scoutedRooms = {};
        const visibleRooms = Object.keys(Game.rooms);
        for(const roomName of visibleRooms){
            if(Object.keys(Memory.colonies).includes(roomName)) continue;
            this.updateCachedRoomDataForRoom(roomName);

            // also determine if the room is hostile/if it should be added to hostile room
        }
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
        // filter hostiles to only hostiles which contain an attack or rangedattack body part
        const threateningHostiles = hostiles.filter(c => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0);
        const hostileStructures = Game.rooms[roomName].find(FIND_HOSTILE_STRUCTURES).filter(s=>s.structureType==STRUCTURE_TOWER && s.store[RESOURCE_ENERGY]>500);

        if (threateningHostiles.length > 0 && gameController && !gameController.my) {
            addHostileRoom(roomName);
        } else {
            removeHostileRoom(roomName);
        }
    }




}
