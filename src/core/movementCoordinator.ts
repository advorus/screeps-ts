import { getColonyIntents, getAllMoveReservations, getTaskMemory, getMoveReservation } from "core/memory";
import { creepIsStationary } from "utils/move";
import { isUpgradingAtController } from "utils/move";

// Runtime toggles (set in Screeps console):
// `Memory.movementVerbose = true` enables detailed movement logs.
// `Memory.simpleMovementVisuals = true` enables simplified visuals.
const MOVEMENT_VERBOSE = !!((Memory as any).movementVerbose === true);
const SIMPLE_VISUALS = !!((Memory as any).simpleMovementVisuals === true);
const STATIONARY_REASON_TAGS_ENABLED = !!((Memory as any).debugStationaryTags ?? true);

function mvLog(...args: any[]) {
    if (!MOVEMENT_VERBOSE) return;
    try { console.log(...args); } catch (e) {}
}

function getMoveSummaryBucket(): Array<{creepName:string, from:string, to:string, ret:string, status:string}> {
    const bucket = (Memory as any).__moveSummary;
    if (!Array.isArray(bucket)) {
        (Memory as any).__moveSummary = [];
        return (Memory as any).__moveSummary;
    }
    return bucket;
}

function recordMoveAttempt(creepName: string, from: RoomPosition, to: RoomPosition, ret: ScreepsReturnCode, status: string): void {
    const summary = getMoveSummaryBucket();
    summary.push({
        creepName,
        from: `${from.x},${from.y},${from.roomName}`,
        to: `${to.x},${to.y},${to.roomName}`,
        ret: String(ret),
        status
    });
}

export function flushMoveSummary(): void {
    const summary = getMoveSummaryBucket();
    if (!summary.length) return;
    const entries = summary.map(item => `${item.creepName}:${item.status}/${item.ret} ${item.from}->${item.to}`).join(' | ');
    console.log(`[movementCoordinator] tick=${Game.time} move attempts (${summary.length}): ${entries}`);
    (Memory as any).__moveSummary = [];
}

export function isNoopMove(from: {x:number,y:number,roomName?:string} | RoomPosition, to: {x:number,y:number,roomName?:string} | RoomPosition): boolean {
    const fromRoom = from instanceof RoomPosition ? from.roomName : (from.roomName ?? '');
    const toRoom = to instanceof RoomPosition ? to.roomName : (to.roomName ?? '');
    return fromRoom === toRoom && from.x === to.x && from.y === to.y;
}

export function shouldAdvanceCachedPath(ret: ScreepsReturnCode, _beforePos: RoomPosition, _afterPos: RoomPosition): boolean {
    // A move can return OK while the creep is still on the same tile in the same tick;
    // Screeps resolves the actual positional change on the next tick. Because of that,
    // we must never interpret a same-tick `afterPos` as proof that the move completed.
    return false;
}

function isQueuedMoveInFlight(creep: Creep): boolean {
    try {
        if (!creep || !creep.memory) return false;
        const queued = (creep.memory as any).queuedMove;
        if (!queued || typeof queued.tick !== 'number') return false;
        if (queued.tick < Game.time - 1) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function isStationaryCreepVisual(creep: Creep): boolean {
    try {
        if (!creep || !creep.memory) return false;
        const roomName = creep.room.name;
        const reservations = getAllMoveReservations();
        return creepIsStationary(creep, reservations, roomName);
    } catch (e) {
        return false;
    }
}

function getCreepStationaryReason(creep: Creep): string | null {
    try {
        if (!creep || !creep.memory) return null;
        const roomName = creep.room.name;
        const reservations = getAllMoveReservations();
        const intents = getColonyIntents(roomName);
        const hasPlanned = !!(creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0);
        if (isQueuedMoveInFlight(creep)) return 'queued-move';
        if ((creep as any).fatigue && (creep as any).fatigue > 0) return 'fatigue';

        if (creep.memory.taskId) {
            try {
                const task = getTaskMemory(creep.memory.taskId);
                if (task && typeof (task as any).type === 'string') {
                    const taskType = (task as any).type;
                    const stationaryTaskTypes = new Set(['HARVEST','MINE','REMOTE_MINING','UPGRADE','BUILD','REPAIR','FILL','PICKUP']);
                    if (stationaryTaskTypes.has(taskType) && !Object.values(intents || {}).some(i => i.tick === Game.time && i.from.room === roomName && i.from.x === creep.pos.x && i.from.y === creep.pos.y) && !reservations[creep.name]) {
                        return `task:${taskType}`;
                    }
                }
            } catch (e) {}
        }
        if ((creep.memory as any).working === true || creep.memory.role === 'upgrader' || creep.memory.role === 'worker' || (creep.memory as any).upgrading === true) {
            return 'working';
        }
        if (isUpgradingAtController(creep)) {
            return 'task:UPGRADE';
        }
        if (reservations[creep.name] && reservations[creep.name].tick === Game.time && reservations[creep.name].from.room === roomName && reservations[creep.name].from.x === creep.pos.x && reservations[creep.name].from.y === creep.pos.y) {
            return 'outgoing';
        }
        if (Object.values(intents || {}).some(i => i.tick === Game.time && i.from.room === roomName && i.from.x === creep.pos.x && i.from.y === creep.pos.y)) {
            return 'intent';
        }
        if (Object.values(reservations).some(r => r.tick === Game.time && r.to.room === roomName && r.to.x === creep.pos.x && r.to.y === creep.pos.y)) {
            return 'incoming';
        }
        if (Object.values(intents || {}).some(i => i.tick === Game.time && i.to.room === roomName && i.to.x === creep.pos.x && i.to.y === creep.pos.y)) {
            return 'incoming';
        }
        if (hasPlanned) return 'path';
        if (creep.memory.taskId) {
            try {
                const task = getTaskMemory(creep.memory.taskId);
                if (task && typeof (task as any).type === 'string') {
                    return `task:${(task as any).type}`;
                }
            } catch (e) {}
        }
        return 'active';
    } catch (e) {
        return null;
    }
}

function drawRoomOverview(roomName: string, intents: {[creepName:string]: {from:{x:number,y:number,room:string}, to:{x:number,y:number,room:string}, tick:number}}){
    try{
        const vis = new RoomVisual(roomName);
        // draw intents
        for(const [name, intent] of Object.entries(intents)){
            if(!intent) continue;
            // If the creep has a cached `betterPath`, draw that path instead of a straight line
            try {
                const creep = Game.creeps[name];
                if (creep && creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0) {
                    // draw path segments from current position through planned steps
                    let prevX = intent.from.x;
                    let prevY = intent.from.y;
                    const pathArr = (creep.memory as any).betterPath as Array<{x:number,y:number,roomName?:string}>;
                    for (const step of pathArr) {
                        vis.line(prevX, prevY, step.x, step.y, {color:'cyan', width:0.06, opacity:0.6});
                        prevX = step.x;
                        prevY = step.y;
                    }
                    // small marker at the final intended tile
                    vis.circle(prevX, prevY, {radius:0.12, fill:'transparent', stroke:'cyan'});
                } else {
                    vis.line(intent.from.x, intent.from.y, intent.to.x, intent.to.y, {color:'white', width:0.06, opacity:0.6});
                }
                vis.text(name, intent.from.x, intent.from.y-0.3, {color:'white', font:0.35, align:'center'});
            } catch(e) {
                try { vis.line(intent.from.x, intent.from.y, intent.to.x, intent.to.y, {color:'white', width:0.06, opacity:0.6}); } catch(e) {}
            }
        }

        // draw reservations
        const reservations = getAllMoveReservations();
        for(const [creepName, res] of Object.entries(reservations)){
            if(!res || res.tick !== Game.time) continue;
            if(res.from.room === roomName){
                vis.circle(res.from.x, res.from.y, {radius:0.25, fill:'transparent', stroke:'orange'});
            }
            if(res.to.room === roomName){
                vis.circle(res.to.x, res.to.y, {radius:0.25, fill:'transparent', stroke:'lime'});
                try { vis.text(creepName, res.to.x, res.to.y+0.4, {color:'lime', font:0.28, align:'center'}); } catch(e) {}
            }
        }

        // draw source adjacent free tiles and occupied tiles for the room
        const room = Game.rooms[roomName];
        if(room){
            for(const source of room.find(FIND_SOURCES)){
                const free = source.pos.getFreeTiles();
                for(const p of free){
                    vis.circle(p.x, p.y, {radius:0.18, fill:'transparent', stroke:'green', opacity:0.6});
                }
                // mark source center
                vis.circle(source.pos.x, source.pos.y, {radius:0.25, fill:'transparent', stroke:'yellow'});
            }

            // mark occupied tiles and highlight stationary blockers
            for(const creep of room.find(FIND_MY_CREEPS)){
                const stationary = isStationaryCreepVisual(creep);
                if (stationary) {
                    vis.rect(creep.pos.x-0.5, creep.pos.y-0.5, 1, 1, {fill:'magenta', opacity:0.28});
                    vis.circle(creep.pos.x, creep.pos.y, {radius:0.4, fill:'transparent', stroke:'magenta', opacity:0.9});
                    vis.text('S', creep.pos.x, creep.pos.y+0.1, {color:'white', font:0.36, align:'center'});
                } else {
                    vis.rect(creep.pos.x-0.5, creep.pos.y-0.5, 1, 1, {fill:'red', opacity:0.12});
                    if (STATIONARY_REASON_TAGS_ENABLED) {
                        const reason = getCreepStationaryReason(creep);
                        if (reason) {
                            vis.text(reason, creep.pos.x, creep.pos.y - 0.9, {color:'yellow', font:0.25, align:'center'});
                        }
                    }
                }
            }
        }

            // draw legend in the top-right corner (smaller, to reduce overlap)
            try {
                const lx = 42.0; // right-side anchor
                let ly = 0.6;
                const lineH = 0.42;
                const boxW = 7.8;
                const boxH = 6.0;
                // background
                vis.rect(lx - 0.8, 0.2, boxW, boxH, {fill: '#000000', opacity: 0.38});
                // layout constants for icon and text alignment
                const iconX = lx + 0.08;
                const textX = lx + 0.7;

                // Planned path
                vis.line(iconX, ly, iconX+0.5, ly, {color: 'cyan', width: 0.09});
                vis.text('Planned path', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Intent straight
                vis.line(iconX, ly, iconX+0.5, ly, {color: 'white', width: 0.09});
                vis.text('Intent (straight)', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Reservation from
                vis.circle(iconX+0.12, ly-0.05, {radius:0.15, fill:'transparent', stroke:'orange'});
                vis.text('Reserved (from)', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Reservation to
                vis.circle(iconX+0.12, ly-0.05, {radius:0.15, fill:'transparent', stroke:'lime'});
                vis.text('Reserved (to)', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Free source tile
                vis.circle(iconX+0.12, ly-0.05, {radius:0.12, fill:'transparent', stroke:'green'});
                vis.text('Free source', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Source/controller
                vis.circle(iconX+0.12, ly-0.05, {radius:0.15, fill:'transparent', stroke:'yellow'});
                vis.text('Source/Controller', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Stationary blocker
                vis.rect(iconX+0.0, ly-0.3, 0.36, 0.36, {fill:'magenta', opacity:0.28});
                vis.circle(iconX+0.18, ly-0.13, {radius:0.18, fill:'transparent', stroke:'magenta'});
                vis.text('Stationary blocker', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Non-stationary reason tag
                vis.text('R', iconX, ly-0.15, {color:'yellow', font:0.28, align:'left'});
                vis.text('Why not stationary', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH;
                // Occupied tile
                vis.rect(iconX+0.0, ly-0.3, 0.36, 0.36, {fill:'red', opacity:0.12});
                vis.text('Occupied tile', textX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH + 0.08;

                // Creep lifespan panel (fixed list)
                vis.text('Creep lifespan (ticks)', iconX, ly-0.15, {color: 'white', font: 0.28, align: 'left'});
                ly += lineH * 0.8;
                try {
                    const roomCreeps = room.find(FIND_MY_CREEPS).slice(0, 12);
                    let i = 0;
                    for (const cr of roomCreeps) {
                        const ttl = typeof cr.ticksToLive === 'number' ? cr.ticksToLive : -1;
                        const barX = iconX;
                        const barY = ly + i * 0.32;
                        // color by remaining life
                        let color = '#66ff66';
                        if (ttl < 300) color = '#ff6666';
                        else if (ttl < 1000) color = '#ffcc66';
                        vis.rect(barX, barY-0.18, 0.44, 0.28, {fill: color, opacity: 0.9});
                        vis.text(`${cr.name}: ${ttl >= 0 ? ttl : '—'}`, barX + 0.52, barY-0.18, {color: 'white', font: 0.28, align: 'left'});
                        i++;
                    }
                } catch(e) {}
            } catch(e) {}
    }catch(e){
        // ignore vis errors
    }
}

export function resolveAndExecuteAll(): void {
    if(!Memory.colonies) {
        mvLog(`[movementCoordinator] no colonies configured`);
        return;
    }
    const colonyRooms = Object.keys(Memory.colonies);
    mvLog(`[movementCoordinator] scanning ${colonyRooms.length} colonies for intents`);
    for(const roomName of colonyRooms){
        const intents = getColonyIntents(roomName);
        const intentCount = intents ? Object.keys(intents).length : 0;
        if(!intents || intentCount===0) {
            // For visibility during debugging, log empty rooms
            mvLog(`[movementCoordinator] no intents for room ${roomName}`);
            continue;
        }
        mvLog(`[movementCoordinator] found ${intentCount} intents in ${roomName}`);
        resolveAndExecuteForRoom(roomName, intents);
        try { dumpRoomPositions(roomName); } catch(e) {}
        try { mvLog(`[movementCoordinator] reservations snapshot: ${JSON.stringify(getAllMoveReservations())}`); } catch(e) {}
        try { mvLog(`[movementCoordinator] intents snapshot: ${JSON.stringify(getColonyIntents(roomName))}`); } catch(e) {}
    }
}

function logIntentSummary(label: string, creepName: string, intent?: {from?: {x:number,y:number,room:string}, to?: {x:number,y:number,room:string}, tick?: number}) {
    if (!intent) {
        console.log(`[movementCoordinator] ${label} ${creepName}: no intent`);
        return;
    }
    const from = intent.from || {x: -1, y: -1, room: 'unknown'};
    const to = intent.to || {x: -1, y: -1, room: 'unknown'};
    console.log(`[movementCoordinator] ${label} ${creepName}: from=${from.x},${from.y},${from.room} -> to=${to.x},${to.y},${to.room} tick=${intent.tick ?? Game.time}`);
}

function resolveAndExecuteForRoom(roomName: string, intents: {[creepName:string]: {from:{x:number,y:number,room:string}, to:{x:number,y:number,room:string}, tick:number}}){
    if(!SIMPLE_VISUALS) drawRoomOverview(roomName, intents);
    // Build quick maps
    const byCreep = {...intents};
    const occupiedMap: {[posKey:string]: string} = {};
    for(const name of Object.keys(Game.creeps)){
        const creep = Game.creeps[name];
        if(!creep) continue;
        if(creep.room.name !== roomName) continue;
        const key = `${creep.pos.x},${creep.pos.y}`;
        occupiedMap[key] = name;
    }

    // Diagnostic dump: per-intent details to help trace widespread stalls
    try {
        const reservationsNow = getAllMoveReservations();
        mvLog(`[movementCoordinator] intent diagnostics for room ${roomName}: intents=${Object.keys(byCreep).length} reservations=${Object.keys(reservationsNow).length}`);
        for (const [creepName, intent] of Object.entries(byCreep)) {
            if (!intent || intent.tick !== Game.time) continue;
            try {
                const mover = Game.creeps[creepName];
                const moverMem = mover && mover.memory ? mover.memory as any : {};
                const moverQueued = moverMem?.queuedMove ?? null;
                const moverRes = reservationsNow[creepName] ?? null;
                const moverMoves = mover && mover.body ? mover.body.filter(p => p.type === MOVE).length : 0;
                const moverFatigue = mover ? (mover as any).fatigue ?? 0 : -1;
                const moverPathHead = moverMem && Array.isArray(moverMem.betterPath) && moverMem.betterPath.length>0 ? moverMem.betterPath[0] : null;

                // Inspect occupant at destination
                const occRoom = Game.rooms[intent.to.room];
                const occupants = occRoom ? (occRoom.lookForAt(LOOK_CREEPS, intent.to.x, intent.to.y) as Creep[]) : [];
                const occupant = occupants && occupants.length>0 ? occupants[0] : null;
                const occMem = occupant && occupant.memory ? occupant.memory as any : {};
                const occQueued = occMem?.queuedMove ?? null;
                const occRes = reservationsNow[occupant ? occupant.name : ''] ?? null;
                const occMoves = occupant && occupant.body ? occupant.body.filter(p => p.type === MOVE).length : 0;

                mvLog(`[movementCoordinator] intent ${creepName}: from=${intent.from.x},${intent.from.y}->to=${intent.to.x},${intent.to.y} mover.pos=${mover ? mover.pos.x+','+mover.pos.y+','+mover.pos.roomName : 'missing'} moverQueued=${JSON.stringify(moverQueued)} moverRes=${JSON.stringify(moverRes)} MOVE_parts=${moverMoves} fatigue=${moverFatigue} pathHead=${JSON.stringify(moverPathHead)}`);
                if (occupant) {
                    mvLog(`[movementCoordinator]   dest occupant ${occupant.name}: pos=${occupant.pos.x},${occupant.pos.y},${occupant.pos.roomName} queued=${JSON.stringify(occQueued)} res=${JSON.stringify(occRes)} MOVE_parts=${occMoves}`);
                } else {
                    mvLog(`[movementCoordinator]   dest unoccupied`);
                }
            } catch (e) {}
        }
    } catch (e) {}

    // Detect multiple intents targeting the same tile (conflicts) and force
    // all but one mover to replan this tick. Choose the winner by MOVE parts
    // (more MOVE parts wins), then by lexicographic name as a deterministic tie-breaker.
    try {
        const targetMap: {[key:string]: string[]} = {};
        for (const [creepName, intent] of Object.entries(byCreep)) {
            if (!intent || intent.tick !== Game.time) continue;
            const key = `${intent.to.x},${intent.to.y},${intent.to.room}`;
            if (!targetMap[key]) targetMap[key] = [];
            targetMap[key].push(creepName);
        }
        for (const [key, arr] of Object.entries(targetMap)) {
            if (arr.length <= 1) continue;
            // sort by MOVE parts desc, then name asc
            arr.sort((a, b) => {
                const ca = Game.creeps[a];
                const cb = Game.creeps[b];
                const ma = ca && ca.body ? ca.body.filter(p => p.type === MOVE).length : 0;
                const mb = cb && cb.body ? cb.body.filter(p => p.type === MOVE).length : 0;
                if (ma !== mb) return mb - ma;
                return a.localeCompare(b);
            });
            const winner = arr[0];
            const losers = arr.slice(1);
            try { mvLog(`[movementCoordinator] intent conflict at ${key}: winner=${winner} losers=${losers.join(',')}`); } catch(e) {}
            for (const loser of losers) {
                const mover = Game.creeps[loser];
                if (mover && mover.memory) {
                    mover.memory.betterPath = undefined;
                    mover.memory.betterPathTargetX = undefined;
                    mover.memory.betterPathTargetY = undefined;
                    mover.memory.betterPathTargetRoom = undefined;
                    mover.memory.tickPathFound = undefined;
                }
                // remove loser intent for this tick so it doesn't get executed
                delete byCreep[loser];
            }
        }
    } catch (e) {}

    // Process any queued moves from the previous tick: if a queued move
    // resolved (the creep is now at the queued destination), advance the
    // creep's cached path and clear the queuedMove flag. If a queued move
    // is stale (older than one tick), clear it and force a replan so the
    // creep doesn't remain stuck indefinitely.
    for (const name of Object.keys(Game.creeps)) {
        const creep = Game.creeps[name];
        if (!creep) continue;
        if (creep.room.name !== roomName) continue;
        try {
            const qm = (creep.memory as any)?.queuedMove;
            if (!qm || typeof qm.tick !== 'number') continue;
            mvLog(`[movementCoordinator] queuedMove state for ${name}: qm.tick=${qm.tick}, now=${Game.time}, dest=${qm.x},${qm.y},${qm.room}, pos=${creep.pos.x},${creep.pos.y},${creep.pos.roomName}`);
            // If the queued move was set on the previous tick, check whether
            // the creep actually moved to the destination this tick.
            if (qm.tick === Game.time - 1) {
                if (creep.pos.x === qm.x && creep.pos.y === qm.y && creep.pos.roomName === qm.room) {
                    // Movement completed: advance the cached path if its head
                    // matches the tile we just moved into.
                    try { console.log(`[movementCoordinator] queuedMove resolved for ${name}: arrived at ${qm.x},${qm.y},${qm.room}`); } catch(e) {}
                    if (creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0) {
                        const head = (creep.memory as any).betterPath[0];
                        if (head && typeof head.x === 'number' && head.x === qm.x && head.y === qm.y && head.roomName === qm.room) {
                            (creep.memory as any).betterPath.shift();
                        }
                    }
                    (creep.memory as any).queuedMove = undefined;
                    // reset stuck counter on successful arrival
                    try { (creep.memory as any).moveStuckCount = 0; } catch(e) {}
                }
                // else: still queued but not yet resolved; leave it alone for now
                    else {
                        try {
                            const moveParts = creep.body ? creep.body.filter(p => p.type === MOVE).length : 0;
                            const fatigue = (creep as any).fatigue ?? 0;
                            mvLog(`[movementCoordinator] pending queuedMove diagnostics for ${name}: MOVE_parts=${moveParts}, fatigue=${fatigue}`);
                            // increment stuck counter for unresolved queued moves
                            try {
                                const prev = (creep.memory as any).moveStuckCount || 0;
                                (creep.memory as any).moveStuckCount = prev + 1;
                                mvLog(`[movementCoordinator] moveStuckCount for ${name} -> ${(creep.memory as any).moveStuckCount}`);
                                // If stuck multiple ticks in a row, force a replan and temporarily block the destination
                                if ((creep.memory as any).moveStuckCount >= 2) {
                                    try { console.log(`[movementCoordinator] ${name} appears stuck moving to ${qm.x},${qm.y},${qm.room}; forcing replan and temp-blocking destination`); } catch(e) {}
                                    (creep.memory as any).queuedMove = undefined;
                                    // Force this creep to use basic moveTo for a few ticks to escape jams
                                    try { (creep.memory as any).forceBasicMovementUntil = Game.time + 3; } catch(e) {}
                                    if (creep.memory) {
                                        creep.memory.betterPath = undefined;
                                        creep.memory.betterPathTargetX = undefined;
                                        creep.memory.betterPathTargetY = undefined;
                                        creep.memory.betterPathTargetRoom = undefined;
                                        creep.memory.tickPathFound = undefined;
                                    }
                                    // mark the destination as temporarily blocked so other creeps avoid it
                                    try { (creep.memory as any).tempBlockedTile = { x: qm.x, y: qm.y, roomName: qm.room, tick: Game.time + 2 }; } catch(e) {}
                                    (creep.memory as any).moveStuckCount = 0;
                                }
                            } catch(e) {}
                        } catch(e) {}
                    }
            } else if (qm.tick < Game.time - 1) {
                // Expired queued move (too old) -> clear it and force replan
                (creep.memory as any).queuedMove = undefined;
                if (creep.memory) {
                    creep.memory.betterPath = undefined;
                    creep.memory.betterPathTargetX = undefined;
                    creep.memory.betterPathTargetY = undefined;
                    creep.memory.betterPathTargetRoom = undefined;
                    creep.memory.tickPathFound = undefined;
                    try { console.log(`[movementCoordinator] cleared stale queuedMove for ${name} and forced replan`); } catch(e) {}
                }
            }
        } catch (e) {}
    }

    // Replan any intents that target a tile occupied by a stationary creep
    // with no intent. Do this after all intents are declared so we know the
    // full set of intents for the room. For each colliding mover, clear its
    // cached path and ask it to `betterMoveTo` its existing goal so it can
    // recompute a route avoiding stationaries; then refresh the intent map.
    try {
        const reservationsNow = getAllMoveReservations();
        for (const [creepName, intent] of Object.entries(byCreep)) {
            if (!intent || intent.tick !== Game.time) continue;
            const destRoom = Game.rooms[intent.to.room];
            if (!destRoom) continue;
            const occupants = destRoom.lookForAt(LOOK_CREEPS, intent.to.x, intent.to.y) as Creep[];
            if (occupants.length === 0) continue;
            const occ = occupants[0];
            // If occupant has no intent this tick and is stationary, the mover
            // should replan instead of trying to move into it.
            const occIntent = getColonyIntents(roomName)[occ.name];
            if (occIntent && occIntent.tick === Game.time) continue;
            if (!creepIsStationary(occ, reservationsNow, roomName)) continue;

            const mover = Game.creeps[creepName];
            if (!mover) continue;
            // Clear cached path to force recompute and attempt an immediate replan.
            if (mover.memory) {
                mover.memory.betterPath = undefined;
                mover.memory.betterPathTargetX = undefined;
                mover.memory.betterPathTargetY = undefined;
                mover.memory.betterPathTargetRoom = undefined;
                mover.memory.tickPathFound = undefined;
                    // When forcing a replan, clear any existing reservation for the
                    // mover so the coordinator does not treat the old reserved tile
                    // as still intended. Then mark the blocked tile so the mover
                    // avoids it when replanning this tick.
                    try {
                        const existing = getMoveReservation(mover.name);
                        try { console.log(`[coordinator] forcing replan for ${mover.name} due to stationary occupant at ${intent.to.x},${intent.to.y}. existingReservation=${JSON.stringify(existing)}`); } catch(e) {}
                        // Do not delete the live reservation here. A queued move is still valid
                        // until the next tick resolves it, and removing it causes the same stale
                        // path / replan loop to repeat without allowing the move to settle.
                    } catch (e) {}
                (mover.memory as any).tempBlockedTile = { x: intent.to.x, y: intent.to.y, roomName: intent.to.room, tick: Game.time };
            }
            // Attempt to replan using the mover's previous goal if available,
            // otherwise use the current intent destination as a fallback.
            let replanTarget: RoomPosition | null = null;
            try {
                if (mover.memory && typeof mover.memory.betterPathTargetX === 'number' && typeof mover.memory.betterPathTargetY === 'number' && typeof mover.memory.betterPathTargetRoom === 'string') {
                    replanTarget = new RoomPosition(mover.memory.betterPathTargetX, mover.memory.betterPathTargetY, mover.memory.betterPathTargetRoom);
                }
            } catch (e) {}
            if (!replanTarget) replanTarget = new RoomPosition(intent.to.x, intent.to.y, intent.to.room);
            try {
                mover.betterMoveTo(replanTarget);
            } catch (e) {}
            // Remove the stale intent from byCreep so chain resolution doesn't try to execute it.
            // The creep will publish a fresh intent on its next call if replanning succeeds.
            delete byCreep[creepName];
            // Refresh the byCreep mapping with any newly published intent
            try {
                const fresh = getColonyIntents(roomName)[creepName];
                if (fresh && fresh.tick === Game.time) byCreep[creepName] = fresh;
            } catch (e) {}
        }
    } catch (e) {}

    const processed: {[name:string]: boolean} = {};

    for(const creepName of Object.keys(byCreep)){
        if(processed[creepName]) continue;
        const intent = byCreep[creepName];
        if(!intent || intent.tick !== Game.time) { processed[creepName]=true; continue; }

        logIntentSummary('considering intent', creepName, intent);

        // Follow chain
        const chain: string[] = [];
        let cur = creepName;
        const seen: Set<string> = new Set();
        while(true){
            if(seen.has(cur)) break; // cycle
            seen.add(cur);
            chain.push(cur);
            const curIntent = byCreep[cur];
            if(!curIntent || curIntent.tick !== Game.time) break;
            const targetKey = `${curIntent.to.x},${curIntent.to.y}`;
            const occupant = occupiedMap[targetKey];
            if(!occupant) { // chain ends in empty tile
                // execute backwards
                executeChain(chain.reverse(), byCreep);
                for(const n of chain) processed[n]=true;
                break;
            } else {
                const occ = Game.creeps[occupant];
                const occIntent = byCreep[occupant];
                const reservations = getAllMoveReservations();
                const isBlockedStationary = !!(occ && (!occIntent || occIntent.tick !== Game.time) && creepIsStationary(occ, reservations, roomName));
                if (isBlockedStationary) {
                    const mover = Game.creeps[cur];
                    if (mover && mover.memory) {
                        mover.memory.betterPath = undefined;
                        mover.memory.betterPathTargetX = undefined;
                        mover.memory.betterPathTargetY = undefined;
                        mover.memory.betterPathTargetRoom = undefined;
                        mover.memory.tickPathFound = undefined;
                    }
                    for(const n of chain) processed[n]=true;
                    break;
                }
                // continue chain
                cur = occupant;
                if(processed[cur]){ // occupant already processed
                    for(const n of chain) processed[n]=true;
                    break;
                }
                // if occupant has no intent, cannot progress
                const occIntent2 = byCreep[cur];
                if(!occIntent2 || occIntent2.tick !== Game.time){
                    for(const n of chain) processed[n]=true;
                    break;
                }
                // if this forms a swap of length 2, handle specially
                if(chain.length>=2 && cur === chain[0]){
                    // cycle detected
                    if(chain.length===2){
                        // pairwise swap A <-> B: execute both moves
                        executeSwap(chain[0], chain[1], byCreep);
                        processed[chain[0]] = processed[chain[1]] = true;
                    } else {
                        // larger cycle: skip to avoid deadlocks
                        for(const n of chain) processed[n]=true;
                    }
                    break;
                }
                // otherwise loop continues
            }
        }
    }
}

    // After executing moves for a room, dump current creep positions for visibility
    function dumpRoomPositions(roomName: string){
        try{
            const room = Game.rooms[roomName];
            if(!room) return;
            const parts: string[] = [];
            for(const cr of room.find(FIND_MY_CREEPS)){
                parts.push(`${cr.name}:${cr.pos.x},${cr.pos.y}`);
            }
            if(parts.length>0) console.log(`[movementCoordinator] room ${roomName} positions: ${parts.join(' | ')}`);
        }catch(e){}
    }

function executeChain(chain: string[], byCreep: {[creepName:string]: any}){
    // chain is ordered from far->near (destination chain end first)
    for(const name of chain){
        const intent = byCreep[name];
        if(!intent) continue;
        const creep = Game.creeps[name];
        if(!creep) continue;
        try{
            logIntentSummary('executing chain intent', name, intent);
            // The current intent is authoritative for this tick. A cached path may
            // legitimately lag behind the current plan while still being valid;
            // clearing it simply because the head doesn't exactly match the
            // published intent causes the same creep to keep replanning and can
            // stop movement entirely.

            // If the intended destination is occupied by a creep that has no
            // intent (i.e. is not moving), skip executing this move and
            // clear the creep's cached path so it will recompute an alternate
            // route next tick. This prevents moving into tiles blocked by
            // stationary upgraders/harvesters.
            const destRoom = Game.rooms[intent.to.room];
            let destOccupied = false;
            let blockerName: string | undefined;
            if(destRoom){
                const occupants = destRoom.lookForAt(LOOK_CREEPS, intent.to.x, intent.to.y) as Creep[];
                if(occupants && occupants.length>0){
                    const occ = occupants[0];
                    blockerName = occ && occ.name ? occ.name : undefined;
                    const occIntent = byCreep[occ.name];
                    if(!occIntent || occIntent.tick !== Game.time){
                        // occupant is not moving this tick -> treat as stationary blocker
                        destOccupied = true;
                    }
                }
            }
            if(destOccupied){
                console.log(`[movementCoordinator] skipping chain move for ${name}: destination ${intent.to.x},${intent.to.y},${intent.to.room} is occupied by stationary blocker ${blockerName ?? 'unknown'}`);
                // clear cached path to force recompute next tick
                if(creep.memory){
                    creep.memory.betterPath = undefined;
                    creep.memory.betterPathTargetX = undefined;
                    creep.memory.betterPathTargetY = undefined;
                    creep.memory.betterPathTargetRoom = undefined;
                    creep.memory.tickPathFound = undefined;
                }
                continue;
            }

            if (creep.pos.x === intent.to.x && creep.pos.y === intent.to.y && creep.pos.roomName === intent.to.room) {
                console.log(`[movementCoordinator] skipping no-op move for ${name}: already at ${creep.pos.x},${creep.pos.y},${creep.pos.roomName}`);
                if (creep.memory) {
                    creep.memory.betterPath = undefined;
                    creep.memory.betterPathTargetX = undefined;
                    creep.memory.betterPathTargetY = undefined;
                    creep.memory.betterPathTargetRoom = undefined;
                    creep.memory.tickPathFound = undefined;
                }
                continue;
            }
            const beforePos = new RoomPosition(creep.pos.x, creep.pos.y, creep.pos.roomName);
            const targetPos = new RoomPosition(intent.to.x, intent.to.y, intent.to.room);
            const dx = Math.abs(beforePos.x - targetPos.x);
            const dy = Math.abs(beforePos.y - targetPos.y);
            const isAdjacent = beforePos.roomName === targetPos.roomName && Math.max(dx, dy) === 1;
            if (!isAdjacent) {
                console.log(`[movementCoordinator] skipping non-adjacent move for ${name}: from=${beforePos.x},${beforePos.y},${beforePos.roomName} -> to=${targetPos.x},${targetPos.y},${targetPos.roomName} dx=${dx} dy=${dy}`);
                if (creep.memory) {
                    creep.memory.betterPath = undefined;
                    creep.memory.betterPathTargetX = undefined;
                    creep.memory.betterPathTargetY = undefined;
                    creep.memory.betterPathTargetRoom = undefined;
                    creep.memory.tickPathFound = undefined;
                }
                continue;
            }
            const direction = beforePos.getDirectionTo(targetPos) as DirectionConstant;
            const ret = creep.move(direction) as ScreepsReturnCode;
            const retStatus = ret === OK ? 'queued' : 'failed';
            console.log(`[movementCoordinator] move result for ${name}: ${ret} from=${beforePos.x},${beforePos.y},${beforePos.roomName} -> to=${targetPos.x},${targetPos.y},${targetPos.roomName} dir=${direction}`);
            recordMoveAttempt(name, beforePos, targetPos, ret, retStatus);

            // Screeps can report OK while the creep still appears stationary in the same tick
            // because the movement has only been queued. Never use a same-tick `afterPos` check
            // as proof of a completed move; keep the cached path intact until the next tick
            // proves the creep actually left the tile.
            if (ret === OK) {
                // Mark queued move. Do NOT advance the cached path optimistically;
                // wait until the next tick confirms the move to avoid off-by-one
                // discrepancies between cached paths and actual positions.
                (creep.memory as any).queuedMove = { x: targetPos.x, y: targetPos.y, room: targetPos.roomName, tick: Game.time };
                try { console.log(`[movementCoordinator] move queued for ${name}: accepted by Screeps this tick; queuedMove=${JSON.stringify((creep.memory as any).queuedMove)}`); } catch(e) {}
                continue;
            }
            (creep.memory as any).queuedMove = undefined;

            // A failed move is not a valid state to keep retrying the same intent.
            // Clear the path so the creep can re-plan on the next tick instead of
            // publishing a lime-green intent forever while staying stationary.
            if(creep.memory){
                creep.memory.betterPath = undefined;
                creep.memory.betterPathTargetX = undefined;
                creep.memory.betterPathTargetY = undefined;
                creep.memory.betterPathTargetRoom = undefined;
                creep.memory.tickPathFound = undefined;
            }
            console.log(`[movementCoordinator] failed move for ${name}: ${ret}; clearing stale path and intent so it can replan`);
        }catch(e){
            console.log(`[movementCoordinator] executeChain error for ${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

function executeSwap(a: string, b: string, byCreep: {[creepName:string]: any}){
    const ia = byCreep[a];
    const ib = byCreep[b];
    const ca = Game.creeps[a];
    const cb = Game.creeps[b];
    if(!ca || !cb || !ia || !ib) return;
    try{
        logIntentSummary('considering swap intent', a, ia);
        logIntentSummary('considering swap intent', b, ib);
        // Attempt both moves in the same tick. Call both `moveTo` without
        // letting one block the other, then adjust cached paths based on
        // the results. If a move fails (not OK), clear the mover's cached
        // path so it will replan next tick — this avoids persistent
        // stalls when a swap cannot complete.
        const destA = new RoomPosition(ia.to.x, ia.to.y, ia.to.room);
        const destB = new RoomPosition(ib.to.x, ib.to.y, ib.to.room);
        let ra: ScreepsReturnCode = ERR_NOT_FOUND;
        let rb: ScreepsReturnCode = ERR_NOT_FOUND;
        console.log(`[movementCoordinator] executing swap move for ${a}: from=${ca.pos.x},${ca.pos.y},${ca.pos.roomName} -> to=${ia.to.x},${ia.to.y},${ia.to.room}`);
        console.log(`[movementCoordinator] executing swap move for ${b}: from=${cb.pos.x},${cb.pos.y},${cb.pos.roomName} -> to=${ib.to.x},${ib.to.y},${ib.to.room}`);
        const aAdjacent = ca.pos.roomName === destA.roomName && Math.max(Math.abs(ca.pos.x - destA.x), Math.abs(ca.pos.y - destA.y)) === 1;
        const bAdjacent = cb.pos.roomName === destB.roomName && Math.max(Math.abs(cb.pos.x - destB.x), Math.abs(cb.pos.y - destB.y)) === 1;
        if (!aAdjacent || !bAdjacent) {
            console.log(`[movementCoordinator] skipping swap because one or both destinations are not adjacent: ${a}=${aAdjacent} ${b}=${bAdjacent}`);
            return;
        }
        try { ra = ca.move(ca.pos.getDirectionTo(destA) as DirectionConstant) as ScreepsReturnCode; } catch(e) { ra = ERR_INVALID_TARGET; }
        try { rb = cb.move(cb.pos.getDirectionTo(destB) as DirectionConstant) as ScreepsReturnCode; } catch(e) { rb = ERR_INVALID_TARGET; }
        console.log(`[movementCoordinator] swap result ${a}->${ra} ${b}->${rb}`);
        if (ra === OK) (ca.memory as any).queuedMove = { x: destA.x, y: destA.y, room: destA.roomName, tick: Game.time }; else (ca.memory as any).queuedMove = undefined;
        if (rb === OK) (cb.memory as any).queuedMove = { x: destB.x, y: destB.y, room: destB.roomName, tick: Game.time }; else (cb.memory as any).queuedMove = undefined;
        recordMoveAttempt(a, ca.pos, destA, ra, ra === OK ? 'queued' : 'failed');
        recordMoveAttempt(b, cb.pos, destB, rb, rb === OK ? 'queued' : 'failed');

        // Visualize the swap attempt
        try {
            const vis = new RoomVisual(ca.room.name);
            vis.line(ca.pos.x, ca.pos.y, destA.x, destA.y, {color: ra === OK ? 'lime' : 'red', width: 0.1, opacity: 0.6});
            vis.line(cb.pos.x, cb.pos.y, destB.x, destB.y, {color: rb === OK ? 'lime' : 'red', width: 0.1, opacity: 0.6});
            vis.text(`${a}->${ra}`, ca.pos.x, ca.pos.y-0.4, {color: 'white', font: 0.35, align: 'center'});
            vis.text(`${b}->${rb}`, cb.pos.x, cb.pos.y-0.4, {color: 'white', font: 0.35, align: 'center'});
        } catch(e) {}

        if(ra === OK){
            if(ca.memory.betterPath && Array.isArray(ca.memory.betterPath) && ca.memory.betterPath.length>0) ca.memory.betterPath.shift();
        } else {
            // Clear cached path so the creep replans instead of being stuck
            if(ca.memory){ ca.memory.betterPath = undefined; ca.memory.betterPathTargetX = undefined; ca.memory.betterPathTargetY = undefined; ca.memory.betterPathTargetRoom = undefined; ca.memory.tickPathFound = undefined; }
        }

        if(rb === OK){
            if(cb.memory.betterPath && Array.isArray(cb.memory.betterPath) && cb.memory.betterPath.length>0) cb.memory.betterPath.shift();
        } else {
            if(cb.memory){ cb.memory.betterPath = undefined; cb.memory.betterPathTargetX = undefined; cb.memory.betterPathTargetY = undefined; cb.memory.betterPathTargetRoom = undefined; cb.memory.tickPathFound = undefined; }
        }
    }catch(e){}
}

export default { resolveAndExecuteAll, flushMoveSummary };
