import { getAllMoveReservations, getColonyIntents, getTaskMemory } from "core/memory";
import { creepIsStationary, isUpgradingAtController } from "utils/move";

// Runtime toggles (match coordinator flags)
const STATIONARY_REASON_TAGS_ENABLED = !!((Memory as any).debugStationaryTags ?? true);

export function drawRoomOverview(roomName: string, intents: {[creepName:string]: {from:{x:number,y:number,room:string}, to:{x:number,y:number,room:string}, tick:number}}){
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
                try { vis.text(creepName.split(`_`)[1].slice(4), res.to.x, res.to.y+0.4, {color:'lime', font:0.28, align:'center'}); } catch(e) {}
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

    // Helpers below: these are lightweight wrappers mirroring the coordinator's
    // heuristics so the visuals module can be used independently.
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
}

export default { drawRoomOverview };
