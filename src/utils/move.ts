import { checkIfHostileRoom, addHostileRoom, getCostMatrixForRoom, getTaskMemory, reserveMove, getMoveReservation, getAllMoveReservations, publishIntent, getColonyIntents } from "core/memory";
import trafficManager from "utils/trafficManager";
// import { drawRoomOverview as drawRoomOverviewVisual } from "utils/movementVisuals";

// Cost to apply to tiles occupied by stationary creeps (walkable but discouraged)
const OCCUPIED_STATIC_COST = 50;

const BTM_LOG = !!((Memory as any).movementVerbose === false);

function btmLog(...args: any[]) {
    if (!BTM_LOG) return;
    try { console.log(...args); } catch (e) {}
}

// A creep is considered to be actively upgrading when it is in the real upgrade
// work range of the controller and carrying energy, regardless of whether it is
// labeled as upgrader or worker.
export function isUpgradingAtController(creep: Creep): boolean {
    try {
        const controller = creep.room && creep.room.controller ? creep.room.controller : undefined;
        if (!controller) return false;
        if (creep.pos.getRangeTo(controller) > 3) return false;
        if (!creep.store || creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return false;

        if (creep.memory && (creep.memory as any).upgrading === true) return true;
        if (creep.memory && (creep.memory as any).working === true) return true;
        if (creep.memory && (creep.memory.role === 'upgrader' || creep.memory.role === 'worker')) return true;

        if (creep.memory && creep.memory.taskId) {
            try {
                const task = getTaskMemory(creep.memory.taskId);
                if (task && (task as any).type === 'UPGRADE') return true;
            } catch (e) {}
        }

        return false;
    } catch (e) {
        return false;
    }
}

// Helper: check for an incoming reservation or colony intent to a specific tile
function incomingReservationOrIntent(reservations: {[creepName:string]: any}, roomName: string, x:number, y:number){
    const intents = getColonyIntents(roomName);
    return Object.values(reservations).find(r => r.tick === Game.time && r.to.room === roomName && r.to.x === x && r.to.y === y)
        || Object.values(intents || {}).find(i => i.tick === Game.time && i.to.room === roomName && i.to.x === x && i.to.y === y);
}

// Toggle colony-level movement coordinator. When true, creeps publish intents
// and do not call `move` themselves; the coordinator executes moves.
const USE_COLONY_MOVEMENT = true;

export {};

export interface Coord {
    x: number;
    y: number;
}

declare global {
    interface Creep {
        /**
         * Moves the creep to a target position or object, avoiding hostiles.
         * @param target The target position or object to move to.
         * @param opts Optional move options.
         * @returns Screeps return code.
         */
        safeMoveTo(target: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode;
        betterMoveTo(location: RoomPosition | RoomObject , opts?: MoveToOpts): ScreepsReturnCode;
        flee(): ScreepsReturnCode | void;
        expressTilePreference(location: any, opts?: MoveToOpts): ScreepsReturnCode;
        complexBetterMoveTo(location: RoomPosition | RoomObject | {goals: RoomPosition[]}, opts?: MoveToOpts): ScreepsReturnCode;
        registerMove: (target: DirectionConstant | RoomPosition | Coord) => void;
        _intendedPackedCoord?: number;
        _matchedPackedCoord?: number;
        _cachedMoveOptions?: Coord[];

        setWorkingArea: (target: RoomPosition, range: number) => void;
        _workingPos: RoomPosition;
        _workingRange: number;

        setAsObstacle: (isObstacle: boolean) => void;
        _isObstacle?: boolean;
    }
}

Creep.prototype.flee = function(): ScreepsReturnCode | void {
    // find the nearest hostile and move by path 4 cells away
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    const nearestHostile = this.pos.findClosestByRange(hostiles);
    if(nearestHostile !== null){
        const path = PathFinder.search(this.pos, {pos: nearestHostile.pos, range:3}, {flee: true}).path;
        return this.moveByPath(path);
    }
}

Creep.prototype.safeMoveTo = function(target: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode {
    let targetPos: RoomPosition;
    if(target instanceof RoomObject) {
        targetPos = target.pos;
    } else {
        targetPos = target;
    }



    if(opts==undefined) opts = {};

    opts.reusePath ??= 10;
    opts.maxRooms ??= 25;
    opts.plainCost ??= 2;
    opts.swampCost ??= 10;

    // opts.maxOps = 20000;
    // if(this.pos.isNearEdge()) opts.reusePath = 0;


    opts.costCallback = (roomName,costMatrix) => {
        // console.log(`checking room ${roomName}`)
        if(roomName!==targetPos.roomName){
            // console.log(`Room ${roomName} is not the target room ${targetPos.roomName} - checking if hostile:`);
            if(checkIfHostileRoom(roomName)){
                // console.log(`Room ${roomName} is hostile - setting all tiles to 255`);
                for(let i=0;i<50;i++){
                    costMatrix.set(i,49,255);
                    costMatrix.set(i,0,255);
                    costMatrix.set(0,i,255);
                    costMatrix.set(49,i,255);
                }
            }
        } else{
            // this is the target room
            // display the costmatrix
            // console.log(`Cost matrix for room ${roomName}:`);
            // for(let y=0;y<50;y++){
            //     let row = '';
            //     for(let x=0;x<50;x++){
            //         row += costMatrix.get(x,y) + ' ';
            //     }
            //     console.log(row);
            // }
        }

    }

    const pos = target instanceof RoomObject ? target.pos : target;
    // If the target is a Source, always offer adjacent goal tiles to PathFinder
    if ((target as any)?.ticksToRegeneration !== undefined) {
        const sourcePos = (target as RoomObject).pos;
        const goals: RoomPosition[] = [];
        for(let x = sourcePos.x-1; x<=sourcePos.x+1; x++){
            for(let y = sourcePos.y-1; y<=sourcePos.y+1; y++){
                if(x<0||x>49||y<0||y>49) continue;
                if(x===sourcePos.x && y===sourcePos.y) continue;
                const p = new RoomPosition(x,y, sourcePos.roomName);
                if(p.lookFor(LOOK_TERRAIN)[0] !== 'wall'){
                    goals.push(p);
                }
            }
        }
        if(goals.length>0) return this.betterMoveTo(goals[0], opts);
        return this.betterMoveTo(pos, opts);
    }
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS, {
        filter: c => c.pos.inRangeTo(this.pos, 5)
    });
    if (hostiles.length > 0&&this.memory.role!==`duo_attacker`&&this.memory.role!==`duo_healer`&&this.memory.role!==`worker`) {
        this.say('⚠️ Hostile!');
        try { addHostileRoom(this.room.name); } catch(e) {}
        this.flee();
    }
    let targetRoom = undefined;
    if(target instanceof RoomObject) {
        targetRoom = target.room?.name;
    } else{
        targetRoom = target.roomName;
    }

    if(targetRoom !== this.room.name || !this.pos.isInsideRoom()){
        opts.reusePath = 20;
        opts.maxOps = 10000;
        // the creep is pathing to a different room;
        this.say(`🚪to${targetRoom}`);
        if(this.memory.taskId !== undefined){
            let taskMem = getTaskMemory(this.memory.taskId);
            // console.log(taskMem.type);
            if(taskMem.type == `SCOUT`){
                // if the task is a scout task then just move normally
                // console.log(`${this.name} is scouting to ${pos} and is currently at ${this.pos}`);
                // let pf_ret = PathFinder.search(this.pos, pos, {plainCost:2, swampCost:10, roomCallback(roomName){
                //     if(roomName !== pos.roomName){
                //         if(checkIfHostileRoom(roomName)){
                //             return false;
                //         }
                //     }
                //     return new PathFinder.CostMatrix();
                // }})
                // console.log(`PathFinder search path length: `+pf_ret.path.length, `{incomplete?: ${pf_ret.incomplete}}`);
                let ret = this.betterMoveTo(pos,opts);
                // console.log(ret);
                return ret;
            }
        }
        // If the target is a Source, build a list of adjacent goal tiles and
        // ask PathFinder to route to any of them. This lets creeps plan to
        // approach a source's adjacent free square rather than a single point.
        // detect a Source by checking for source-specific property
        if((target as any).ticksToRegeneration !== undefined){
            const sourcePos = (target as RoomObject).pos;
            const goals: RoomPosition[] = [];
            for(let x = sourcePos.x-1; x<=sourcePos.x+1; x++){
                for(let y = sourcePos.y-1; y<=sourcePos.y+1; y++){
                    if(x<0||x>49||y<0||y>49) continue;
                    if(x===sourcePos.x && y===sourcePos.y) continue;
                    const p = new RoomPosition(x,y, sourcePos.roomName);
                    if(p.lookFor(LOOK_TERRAIN)[0] !== 'wall'){
                        goals.push(p);
                    }
                }
            }
            if(goals.length>0) return this.betterMoveTo(goals[0], opts);
            return this.betterMoveTo(pos, opts);
        }

        return this.betterMoveTo(pos, opts);
    }

    return this.betterMoveTo(pos, opts);
}

Creep.prototype.expressTilePreference = function(location: any, opts?: MoveToOpts): ScreepsReturnCode {
    // this is used by all creeps to express which tile they want to be on in the next tick.
    // if they do not call this function, then it is assumed that they have no preference for the next tick.
    // this is used to influence the movement coordinator's decisions about moving creeps.
    // stores the tile preference in memory for the next tick
    if(!Memory.moveReservations) Memory.moveReservations = {};
    Memory.moveReservations[this.name] = {
        from:{
            x: this.pos.x,
            y: this.pos.y,
            room: this.pos.roomName
        },
        to: {
            x: location.x,
            y: location.y,
            room: location.roomName
        },
        tick: Game.time
    }
    return OK
}

Creep.prototype.betterMoveTo = function(location: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode {
    if(Memory.basicMovement === true) {
        return this.moveTo(location, opts);
    }
    const reusePath = opts?.reusePath ?? 5;
    // check if the creep has a better path calculated in memory, and when it was last calculated
    // if not recent enough, then it needs to be recalculated
    let newPathNeeded = true;
    if(this.memory.betterPath &&
        this.memory.betterPath.length > 0 &&
        this.memory.tickPathFound !== undefined && this.memory.tickPathFound + reusePath > Game.time
    ){
        newPathNeeded = false;
    }

    if(newPathNeeded){
        let targetPos = undefined;
        if(location instanceof RoomObject){
            targetPos = location.pos;
        }
        else{
            targetPos = location;
        }
        const path = PathFinder.search(this.pos, targetPos, {
            roomCallback: (roomName: string) => {
                const costMatrix = getCostMatrixForRoom(roomName);
                if(!costMatrix) return false;
                return costMatrix;
            }
        });
        this.memory.betterPath = path.path;
        this.memory.tickPathFound = Game.time;
    }

    if(!this.memory.betterPath || this.memory.betterPath.length === 0) return -1;
    let nextStep = this.memory.betterPath[0];
    if(nextStep){
        if(nextStep.roomName == this.room.name && nextStep.x == this.pos.x && nextStep.y == this.pos.y) {
            this.memory.betterPath.shift();
        }
        nextStep = this.memory.betterPath[0];
        if(!nextStep) return -1;
        const nextPos = new RoomPosition(nextStep.x, nextStep.y, nextStep.roomName);
        trafficManager.registerMove(this, nextPos, 1)
        return 0;
    }
    return -1;

}

// Creep.prototype.betterMoveTo = function(location: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode {
//     //avoids going into hostile rooms and can be cached for a certain number of ticks

//     // Allow an easy global switch to fall back to Screeps' basic moveTo behavior.
//     // Set `Memory.basicMovement = true` in the Screeps console to enable.
//     try {
//         // Per-creep override (set by coordinator when a creep appears stuck):
//         const fbUntil = (this.memory as any)?.forceBasicMovementUntil;
//         if (typeof fbUntil === 'number' && fbUntil >= Game.time) {
//             try { btmLog(`[betterMoveTo] ${this.name} forceBasicMovementUntil=${fbUntil} active - delegating to moveTo`); } catch(e) {}
//             // const targetPosFb = location instanceof RoomObject ? location.pos : (location.pos || location);
//             return this.moveTo(location, opts);
//         }
//         if ((Memory as any).basicMovement === true) {
//             try { btmLog(`[betterMoveTo] ${this.name} basicMovement enabled - delegating to moveTo, with opts ${JSON.stringify(opts)}`); } catch(e) {}
//             // const targetPos = location instanceof RoomObject ? location.pos : (location.pos || location);
//             return this.moveTo(location, opts);
//         }
//     } catch (e) {}

//     // Clear any stale tempBlockedTile from a previous tick so it doesn't permanently block movement
//     try {
//         const tb = (this.memory as any).tempBlockedTile;
//         if (tb && tb.tick < Game.time) {
//             (this.memory as any).tempBlockedTile = undefined;
//         }
//     } catch (e) {}

//     // do a search to find the path from the creep position to the object
//     // only do this if it has been >=reuse ticks since the last path was found
//     let find_new_path = false;
//     const ticks_to_reuse = opts?.reusePath || 15;

//     // If the caller passed a Source object directly, convert it into a goals set
//     // (all adjacent non-wall tiles) so we can choose an approach tile.
//     let isGoals = false;
//     let goals: RoomPosition[] | undefined = undefined;
//     try {
//         if (location && (location as any).ticksToRegeneration !== undefined) {
//             const sourcePos = (location as any).pos as RoomPosition;
//             const garr: RoomPosition[] = [];
//             for (let x = sourcePos.x - 1; x <= sourcePos.x + 1; x++) {
//                 for (let y = sourcePos.y - 1; y <= sourcePos.y + 1; y++) {
//                     if (x < 0 || x > 49 || y < 0 || y > 49) continue;
//                     if (x === sourcePos.x && y === sourcePos.y) continue;
//                     const p = new RoomPosition(x, y, sourcePos.roomName);
//                     if (p.lookFor(LOOK_TERRAIN)[0] !== 'wall') garr.push(p);
//                 }
//             }
//             if (garr.length > 0) {
//                 isGoals = true;
//                 goals = garr;
//             }
//         }
//     } catch (e) {
//         // ignore
//     }
//     // If caller passed a Controller directly, offer adjacent approach tiles as goals
//     try {
//         if (!isGoals && location && (location as any).ticksToDowngrade !== undefined) {
//             const ctrlPos = (location as any).pos as RoomPosition;
//             const carr: RoomPosition[] = [];
//             for (let x = ctrlPos.x - 1; x <= ctrlPos.x + 1; x++) {
//                 for (let y = ctrlPos.y - 1; y <= ctrlPos.y + 1; y++) {
//                     if (x < 0 || x > 49 || y < 0 || y > 49) continue;
//                     if (x === ctrlPos.x && y === ctrlPos.y) continue;
//                     const p = new RoomPosition(x, y, ctrlPos.roomName);
//                     if (p.lookFor(LOOK_TERRAIN)[0] !== 'wall') carr.push(p);
//                 }
//             }
//             if (carr.length > 0) {
//                 isGoals = true;
//                 goals = carr;
//             }
//         }
//     } catch (e) {
//         // ignore
//     }
//     // If caller passed a ConstructionSite directly, offer adjacent approach tiles as goals
//     try {
//         if (!isGoals && location && (location as any).progress !== undefined && (location as any).progressTotal !== undefined) {
//             const sitePos = (location as any).pos as RoomPosition;
//             const siteGoals: RoomPosition[] = [];
//             for (let x = sitePos.x - 1; x <= sitePos.x + 1; x++) {
//                 for (let y = sitePos.y - 1; y <= sitePos.y + 1; y++) {
//                     if (x < 0 || x > 49 || y < 0 || y > 49) continue;
//                     if (x === sitePos.x && y === sitePos.y) continue;
//                     const p = new RoomPosition(x, y, sitePos.roomName);
//                     if (p.lookFor(LOOK_TERRAIN)[0] !== 'wall') siteGoals.push(p);
//                 }
//             }
//             if (siteGoals.length > 0) {
//                 isGoals = true;
//                 goals = siteGoals;
//             }
//         }
//     } catch (e) {
//         // ignore
//     }
//     // Generic: if caller passed an object with a `.pos` (structures, containers,
//     // spawns, construction sites, resources, etc), treat its adjacent
//     // walkable tiles as goals so creeps can select alternate approach
//     // tiles rather than queueing for a single square.
//     try {
//         if (!isGoals && location && (location as any).pos instanceof RoomPosition) {
//             const objPos = (location as any).pos as RoomPosition;
//             const adj: RoomPosition[] = [];
//             for (let x = objPos.x - 1; x <= objPos.x + 1; x++) {
//                 for (let y = objPos.y - 1; y <= objPos.y + 1; y++) {
//                     if (x < 0 || x > 49 || y < 0 || y > 49) continue;
//                     if (x === objPos.x && y === objPos.y) continue;
//                     const p = new RoomPosition(x, y, objPos.roomName);
//                     if (p.lookFor(LOOK_TERRAIN)[0] !== 'wall') {
//                         adj.push(p);
//                     }
//                 }
//             }
//             if (adj.length > 0) {
//                 isGoals = true;
//                 goals = adj;
//             }
//         }
//     } catch (e) {
//         // ignore
//     }
//     if (!isGoals) {
//         isGoals = location && (location as any).goals !== undefined;
//         goals = isGoals ? (location as any).goals : undefined;
//     }
//     // Defensive: ensure goals is non-empty. If empty, fall back to using the provided location
//     if (isGoals && (!goals || goals.length === 0)) {
//         isGoals = false;
//         goals = undefined;
//     }

//     // Helper to normalize various inputs into a RoomPosition or null
//     const normalizeToPos = (input: any): RoomPosition | null => {
//         try {
//             if (!input) return null;
//             if (input instanceof RoomPosition) return input;
//             if ((input as any).pos && (input as any).pos instanceof RoomPosition) return (input as any).pos;
//             if (typeof input.x === 'number' && typeof input.y === 'number' && typeof input.roomName === 'string') {
//                 return new RoomPosition(input.x, input.y, input.roomName);
//             }
//         } catch (e) {
//             // defensive: RoomPosition constructor can throw on invalid roomName; swallow and return null
//             return null;
//         }
//         return null;
//     };

//     let repTargetRaw: any = location;
//     let repTargetPos: RoomPosition | null = null;
//     if (isGoals && goals && goals.length > 0) {
//         // Prefer nearest unoccupied goal (and not already reserved), then nearest goal whose occupant will move,
//         // otherwise fallback to nearest goal.
//         const reservations = getAllMoveReservations();
//         let bestFree: {g: any, d: number} | null = null;
//         let bestWillMove: {g: any, d: number} | null = null;
//         let bestAny: {g: any, d: number} | null = null;
//         for (const g of goals) {
//             const gp = normalizeToPos(g);
//             if (!gp) continue;
//             const d = this.pos.getRangeTo(gp);
//             // check occupancy
//             const room = Game.rooms[gp.roomName];
//             let occupants: Creep[] = [];
//             if (room) occupants = room.lookForAt(LOOK_CREEPS, gp.x, gp.y) as Creep[];
//             // consider explicit reservations: an otherwise-empty tile may already be reserved
//             const reserved = incomingReservationOrIntent(reservations, gp.roomName, gp.x, gp.y);
//             if (occupants.length === 0 && !reserved) {
//                 if (!bestFree || d < bestFree.d) bestFree = {g: g, d};
//             } else {
//                 // occupant exists; only consider this goal if the occupant is expected to move
//                 try {
//                     const occ = occupants[0];
//                     const occName = occ && (occ as any).name ? (occ as any).name : undefined;
//                     const resOcc = occName ? reservations[occName] : undefined;
//                     const incoming = incomingReservationOrIntent(reservations, gp.roomName, gp.x, gp.y);
//                     const hasPlanned = !!(occ && occ.memory && Array.isArray((occ.memory as any).betterPath) && (occ.memory as any).betterPath.length > 0);
//                     const hasOutgoingIntent = !!(occ && occ.room && Object.values(getColonyIntents(occ.room.name) || {}).some(i => i.tick === Game.time && i.from.room === occ.room.name && i.from.x === occ.pos.x && i.from.y === occ.pos.y));
//                     const queued = occ && occ.memory ? (occ.memory as any).queuedMove : undefined;
//                     const queuedInFlight = !!(queued && typeof queued.tick === 'number' && queued.tick >= Game.time - 1 && queued.room === gp.roomName);
//                     const willMove = queuedInFlight || hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === gp.roomName && resOcc.from.x === gp.x && resOcc.from.y === gp.y && incoming !== undefined);
//                     if (willMove) {
//                         if (!bestWillMove || d < bestWillMove.d) bestWillMove = {g: g, d};
//                         if (!bestAny || d < bestAny.d) bestAny = {g: g, d};
//                     } else {
//                         // occupied by a stationary creep: skip as a candidate to avoid queuing
//                     }
//                 } catch (e) {
//                     // defensive: if anything goes wrong inspecting the occupant, skip this goal
//                 }
//             }
//         }
//         if (bestFree) repTargetRaw = bestFree.g;
//         else if (bestWillMove) repTargetRaw = bestWillMove.g;
//         else if (bestAny) repTargetRaw = bestAny.g;
//         else {
//             // If every adjacent goal tile is currently blocked by a stationary
//             let fallback: {g:any,d:number} | null = null;
//             for (const g of goals) {
//                 const gp = normalizeToPos(g);
//                 if (!gp) continue;
//                 const room2 = Game.rooms[gp.roomName];
//                 let occupants2: Creep[] = [];
//                 if (room2) occupants2 = room2.lookForAt(LOOK_CREEPS, gp.x, gp.y) as Creep[];
//                 const reserved2 = incomingReservationOrIntent(reservations, gp.roomName, gp.x, gp.y);
//                 if (occupants2.length === 0 && !reserved2) {
//                     const d2 = this.pos.getRangeTo(gp);
//                     if (!fallback || d2 < fallback.d) fallback = {g: g, d: d2};
//                 }
//             }
//             if (fallback) repTargetRaw = fallback.g;
//             else repTargetRaw = goals[0];
//         }
//         repTargetPos = normalizeToPos(repTargetRaw);
//         // Logging: record selection reasoning and reservation state to help debug queuing
//         try {
//             const reservedGoals = Object.values(reservations).filter(r => r.tick === Game.time && r.to.room === repTargetPos!.roomName).map(r => `${r.to.x},${r.to.y}`);
//             const reason = bestFree ? 'free' : (bestWillMove ? 'willMove' : (bestAny ? 'occupied' : 'fallback'));
//             console.log(`[betterMoveTo] ${this.name} goal-select: chosen=${repTargetPos!.x},${repTargetPos!.y},${repTargetPos!.roomName} reason=${reason} goals=${goals!.length} reservedGoals=[${reservedGoals.join(',')}]`);
//         } catch (e) {}
//         // Note: do NOT reserve the distant final goal here. Reservations must
//         // represent the immediate next-step to be meaningful for collision
//         // avoidance. The actual next-step reservation/publish happens later
//         // when a planned `betterPath` head is available.
//         try {
//             if (repTargetPos) {
//                 console.log(`[betterMoveTo] ${this.name} chosen goal ${repTargetPos.x},${repTargetPos.y},${repTargetPos.roomName}`);
//             }
//         } catch(e) {}
//     } else {
//         repTargetRaw = location;
//         repTargetPos = normalizeToPos(repTargetRaw);
//     }
//     if (!repTargetPos) {
//         // if repTarget couldn't be normalized, attempt to find any valid goal
//         if (isGoals && goals) {
//             for (const g of goals) {
//                 const gp = normalizeToPos(g);
//                 if (gp) { repTargetPos = gp; break; }
//             }
//         }
//     }
//     if (!repTargetPos) {
//         // last resort: if location has a .pos use that, else abort
//         const alt = normalizeToPos(location?.pos || location);
//         if (alt) repTargetPos = alt;
//     }
//     if (!repTargetPos) {
//         // Unable to resolve a valid RoomPosition target — fail safely
//         console.log(`betterMoveTo: invalid target passed for creep ${this.name}: ${JSON.stringify(location)}`);
//         return ERR_INVALID_TARGET;
//     }
//     const repTarget: RoomPosition = repTargetPos;
//     try {
//         console.log(`[betterMoveTo] ${this.name} enter target=${repTarget.x},${repTarget.y},${repTarget.roomName} isGoals=${isGoals}`);
//     } catch(e) {}

//     if (this.pos.isEqualTo(repTarget)) {
//         this.memory.betterPath = undefined;
//         this.memory.betterPathTargetX = undefined;
//         this.memory.betterPathTargetY = undefined;
//         this.memory.betterPathTargetRoom = undefined;
//         this.memory.tickPathFound = undefined;
//         return OK;
//     }

//     if(this.memory.betterPathTargetX == undefined || this.memory.betterPathTargetY == undefined || this.memory.betterPathTargetRoom == undefined || this.memory.betterPath==undefined || (Array.isArray(this.memory.betterPath) && this.memory.betterPath.length === 0)){
//         // console.log("didn't find existing target");
//         this.memory.betterPathTargetX = repTarget.x;
//         this.memory.betterPathTargetY = repTarget.y;
//         this.memory.betterPathTargetRoom = repTarget.roomName
//         find_new_path = true;
//     }
//     // If we already have a planned path, reserve our immediate next step
//     // early so other creeps' pathfinding can observe our intent and
//     // plan swaps accordingly.
//     try {
//         if(this.memory.betterPath !== undefined && Array.isArray(this.memory.betterPath) && this.memory.betterPath.length > 0){
//             const planned = this.memory.betterPath[0];
//             // validate planned step before constructing RoomPosition
//             if (planned && typeof planned.x === 'number' && typeof planned.y === 'number' && typeof planned.roomName === 'string') {
//                 const plannedPos = new RoomPosition(planned.x, planned.y, planned.roomName);
//                 // Check whether the planned next step is currently occupied by a
//                 // stationary creep that is not expected to move; if so, abandon
//                 // the cached path so we recompute an alternative route.
//                 try {
//                     const reservations = getAllMoveReservations();
//                     const roomObj = Game.rooms[plannedPos.roomName];
//                     const occupants: Creep[] = roomObj ? (roomObj.lookForAt(LOOK_CREEPS, plannedPos.x, plannedPos.y) as Creep[]) : [];
//                     if (occupants.length > 0) {
//                         const occ = occupants[0];
//                         const resOcc = reservations[occ.name];
//                         const incoming = incomingReservationOrIntent(reservations, plannedPos.roomName, plannedPos.x, plannedPos.y);
//                         const hasPlanned = !!(occ.memory && Array.isArray((occ.memory as any).betterPath) && (occ.memory as any).betterPath.length > 0);
//                         const hasOutgoingIntent = !!(occ && occ.room && Object.values(getColonyIntents(occ.room.name) || {}).some(i => i.tick === Game.time && i.from.room === occ.room.name && i.from.x === occ.pos.x && i.from.y === occ.pos.y));
//                         const queued = occ && occ.memory ? (occ.memory as any).queuedMove : undefined;
//                         const queuedInFlight = !!(queued && typeof queued.tick === 'number' && queued.tick >= Game.time - 1 && queued.room === plannedPos.roomName);
//                         const willMove = queuedInFlight || hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === plannedPos.roomName && resOcc.from.x === plannedPos.x && resOcc.from.y === plannedPos.y && incoming !== undefined);
//                         const isStationary = creepIsStationary(occ, reservations, plannedPos.roomName);
//                         if (!willMove && isStationary) {
//                             // clear cached path and force recompute next tick
//                             this.memory.betterPath = undefined;
//                             this.memory.betterPathTargetX = undefined;
//                             this.memory.betterPathTargetY = undefined;
//                             this.memory.betterPathTargetRoom = undefined;
//                             this.memory.tickPathFound = undefined;
//                         } else {
//                             const dx = Math.abs(this.pos.x - plannedPos.x);
//                             const dy = Math.abs(this.pos.y - plannedPos.y);
//                             if (Math.max(dx, dy) === 1 && this.pos.roomName === plannedPos.roomName) {
//                                 reserveMove(this.name, this.pos, plannedPos);
//                                 try {
//                                     const existingRes = getMoveReservation(this.name);
//                                     if (existingRes && existingRes.tick === Game.time && existingRes.to && existingRes.to.x === plannedPos.x && existingRes.to.y === plannedPos.y && existingRes.to.room === plannedPos.roomName) {
//                                         const colonyRoom = this.memory.colony || this.room.name;
//                                         publishIntent(colonyRoom, this.name, this.pos, plannedPos);
//                                     } else {
//                                         try { console.log(`[betterMoveTo] ${this.name} reservation was rejected; not publishing intent to ${plannedPos.x},${plannedPos.y},${plannedPos.roomName}`); } catch(e) {}
//                                     }
//                                 } catch (e) {}
//                             } else {
//                                 try { console.log(`[betterMoveTo] ${this.name} stale planned step is not adjacent: from=${this.pos.x},${this.pos.y},${this.pos.roomName} to=${plannedPos.x},${plannedPos.y},${plannedPos.roomName} dx=${dx} dy=${dy}; attempting realign`); } catch(e) {}
//                                 // Try to realign the cached path: if a later step within a
//                                 // small lookahead is adjacent to our current position,
//                                 // fast-forward the path to that step instead of clearing
//                                 // it immediately. This helps recover from off-by-one
//                                 // headed paths.
//                                 try {
//                                     const LOOK_REALIGN = Math.min(4, (this.memory.betterPath || []).length);
//                                     let realigned = false;
//                                     for (let ri = 1; ri < LOOK_REALIGN; ri++) {
//                                         const cand = (this.memory.betterPath as any)[ri];
//                                         if (!cand || typeof cand.x !== 'number' || typeof cand.y !== 'number' || typeof cand.roomName !== 'string') continue;
//                                         const cdx = Math.abs(this.pos.x - cand.x);
//                                         const cdy = Math.abs(this.pos.y - cand.y);
//                                         if (this.pos.roomName === cand.roomName && Math.max(cdx, cdy) === 1) {
//                                             // Shift out the preceding steps
//                                             (this.memory.betterPath as any).splice(0, ri);
//                                             realigned = true;
//                                             try { console.log(`[betterMoveTo] ${this.name} realigned path head by ${ri} steps to ${JSON.stringify((this.memory.betterPath as any)[0])}`); } catch(e) {}
//                                             break;
//                                         }
//                                     }
//                                     if (!realigned) {
//                                         this.memory.betterPath = undefined;
//                                         this.memory.betterPathTargetX = undefined;
//                                         this.memory.betterPathTargetY = undefined;
//                                         this.memory.betterPathTargetRoom = undefined;
//                                         this.memory.tickPathFound = undefined;
//                                         find_new_path = true;
//                                     }
//                                 } catch (e) {
//                                     this.memory.betterPath = undefined;
//                                     this.memory.betterPathTargetX = undefined;
//                                     this.memory.betterPathTargetY = undefined;
//                                     this.memory.betterPathTargetRoom = undefined;
//                                     this.memory.tickPathFound = undefined;
//                                     find_new_path = true;
//                                 }
//                             }
//                         }
//                     } else {
//                         const dx = Math.abs(this.pos.x - plannedPos.x);
//                         const dy = Math.abs(this.pos.y - plannedPos.y);
//                         if (Math.max(dx, dy) === 1 && this.pos.roomName === plannedPos.roomName) {
//                             reserveMove(this.name, this.pos, plannedPos);
//                             try {
//                                 const existingRes = getMoveReservation(this.name);
//                                 if (existingRes && existingRes.tick === Game.time && existingRes.to && existingRes.to.x === plannedPos.x && existingRes.to.y === plannedPos.y && existingRes.to.room === plannedPos.roomName) {
//                                     const colonyRoom = this.memory.colony || this.room.name;
//                                     publishIntent(colonyRoom, this.name, this.pos, plannedPos);
//                                 } else {
//                                     try { console.log(`[betterMoveTo] ${this.name} reservation was rejected; not publishing intent to ${plannedPos.x},${plannedPos.y},${plannedPos.roomName}`); } catch(e) {}
//                                 }
//                             } catch (e) {}
//                         } else {
//                             try { console.log(`[betterMoveTo] ${this.name} stale planned step is not adjacent: from=${this.pos.x},${this.pos.y},${this.pos.roomName} to=${plannedPos.x},${plannedPos.y},${plannedPos.roomName} dx=${dx} dy=${dy}; attempting realign`); } catch(e) {}
//                             try {
//                                 const LOOK_REALIGN = Math.min(4, (this.memory.betterPath || []).length);
//                                 let realigned = false;
//                                 for (let ri = 1; ri < LOOK_REALIGN; ri++) {
//                                     const cand = (this.memory.betterPath as any)[ri];
//                                     if (!cand || typeof cand.x !== 'number' || typeof cand.y !== 'number' || typeof cand.roomName !== 'string') continue;
//                                     const cdx = Math.abs(this.pos.x - cand.x);
//                                     const cdy = Math.abs(this.pos.y - cand.y);
//                                     if (this.pos.roomName === cand.roomName && Math.max(cdx, cdy) === 1) {
//                                         (this.memory.betterPath as any).splice(0, ri);
//                                         realigned = true;
//                                         try { console.log(`[betterMoveTo] ${this.name} realigned path head by ${ri} steps to ${JSON.stringify((this.memory.betterPath as any)[0])}`); } catch(e) {}
//                                         break;
//                                     }
//                                 }
//                                 if (!realigned) {
//                                     this.memory.betterPath = undefined;
//                                     this.memory.betterPathTargetX = undefined;
//                                     this.memory.betterPathTargetY = undefined;
//                                     this.memory.betterPathTargetRoom = undefined;
//                                     this.memory.tickPathFound = undefined;
//                                     find_new_path = true;
//                                 }
//                             } catch (e) {
//                                 this.memory.betterPath = undefined;
//                                 this.memory.betterPathTargetX = undefined;
//                                 this.memory.betterPathTargetY = undefined;
//                                 this.memory.betterPathTargetRoom = undefined;
//                                 this.memory.tickPathFound = undefined;
//                                 find_new_path = true;
//                             }
//                         }
//                     }
//                 } catch(e) {
//                     // ignore reservation errors
//                     try {
//                         const dx = Math.abs(this.pos.x - plannedPos.x);
//                         const dy = Math.abs(this.pos.y - plannedPos.y);
//                         if (Math.max(dx, dy) === 1 && this.pos.roomName === plannedPos.roomName) {
//                             reserveMove(this.name, this.pos, plannedPos);
//                             const existingRes = getMoveReservation(this.name);
//                             if (existingRes && existingRes.tick === Game.time && existingRes.to && existingRes.to.x === plannedPos.x && existingRes.to.y === plannedPos.y && existingRes.to.room === plannedPos.roomName) {
//                                 const colonyRoom = this.memory.colony || this.room.name;
//                                 publishIntent(colonyRoom, this.name, this.pos, plannedPos);
//                             } else {
//                                 try { console.log(`[betterMoveTo] ${this.name} reservation was rejected; not publishing intent to ${plannedPos.x},${plannedPos.y},${plannedPos.roomName}`); } catch(e) {}
//                             }
//                         } else {
//                             try { console.log(`[betterMoveTo] ${this.name} stale planned step is not adjacent: from=${this.pos.x},${this.pos.y},${this.pos.roomName} to=${plannedPos.x},${plannedPos.y},${plannedPos.roomName} dx=${dx} dy=${dy}; clearing path and replanning`); } catch(e) {}
//                             this.memory.betterPath = undefined;
//                             this.memory.betterPathTargetX = undefined;
//                             this.memory.betterPathTargetY = undefined;
//                             this.memory.betterPathTargetRoom = undefined;
//                             this.memory.tickPathFound = undefined;
//                             find_new_path = true;
//                         }
//                     } catch (e) {}
//                 }
//             } else {
//                 // malformed memory path entry; clear to force a recompute
//                 this.memory.betterPath = undefined;
//                 this.memory.betterPathTargetX = undefined;
//                 this.memory.betterPathTargetY = undefined;
//                 this.memory.betterPathTargetRoom = undefined;
//             }
//         }
//     } catch (e) {
//         // ignore reservation errors
//     }
//     if(this.memory.tickPathFound == undefined){
//         // console.log("didn't find existing path time");
//         this.memory.tickPathFound = Game.time;
//         find_new_path = true;
//     }

//     // If we have a cached path, proactively scan the next few steps for
//     // stationary creeps that are not expected to move. If any are found,
//     // abandon the cached path so we recompute a route that avoids the
//     // blocking creep. This prevents multiple creeps from following the
//     // same full path into a queued bottleneck.
//     try {
//         const LOOKAHEAD_STEPS = 6;
//         if (!find_new_path && this.memory.betterPath && Array.isArray(this.memory.betterPath) && this.memory.betterPath.length > 0) {
//             const reservations = getAllMoveReservations();
//             const ahead = Math.min(LOOKAHEAD_STEPS, this.memory.betterPath.length);
//             for (let i = 0; i < ahead; i++) {
//                 const step = this.memory.betterPath[i];
//                 if (!step || typeof step.x !== 'number' || typeof step.y !== 'number' || typeof step.roomName !== 'string') continue;
//                 const stepPos = new RoomPosition(step.x, step.y, step.roomName);
//                 const roomObj = Game.rooms[stepPos.roomName];
//                 if (!roomObj) continue; // can't inspect non-visible rooms
//                 const occupants: Creep[] = roomObj.lookForAt(LOOK_CREEPS, stepPos.x, stepPos.y) as Creep[];
//                 if (occupants.length === 0) continue;
//                 const occ = occupants[0];
//                 const resOcc = reservations[occ.name];
//                 const incoming = incomingReservationOrIntent(reservations, stepPos.roomName, stepPos.x, stepPos.y);
//                 const hasPlanned = !!(occ.memory && Array.isArray((occ.memory as any).betterPath) && (occ.memory as any).betterPath.length > 0);
//                 const hasOutgoingIntent = !!(occ && occ.room && Object.values(getColonyIntents(occ.room.name) || {}).some(i => i.tick === Game.time && i.from.room === occ.room.name && i.from.x === occ.pos.x && i.from.y === occ.pos.y));
//                                 const queued = occ && occ.memory ? (occ.memory as any).queuedMove : undefined;
//                                 const queuedInFlight = !!(queued && typeof queued.tick === 'number' && queued.tick >= Game.time - 1 && queued.room === stepPos.roomName);
//                                 const willMove = queuedInFlight || hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === stepPos.roomName && resOcc.from.x === stepPos.x && resOcc.from.y === stepPos.y && incoming !== undefined);
//                 const isStationary = creepIsStationary(occ, reservations, stepPos.roomName);
//                 if (!willMove && isStationary) {
//                     // Found a stationary blocker ahead; clear cached path and force recompute
//                     this.memory.betterPath = undefined;
//                     this.memory.betterPathTargetX = undefined;
//                     this.memory.betterPathTargetY = undefined;
//                     this.memory.betterPathTargetRoom = undefined;
//                     this.memory.tickPathFound = undefined;
//                     try { console.log(`[betterMoveTo] ${this.name} cleared cached path due to stationary blocker at ${stepPos.x},${stepPos.y},${stepPos.roomName} (ahead index ${i})`); } catch(e) {}
//                     find_new_path = true;
//                     break;
//                 }
//             }
//         }
//     } catch (e) {
//         // ignore any errors inspecting ahead steps
//     }
//     // console.log(this.memory.pathTarget);
//     // console.log(JSON.parse(this.memory.pathTarget));
//     // console.log(`target is ${JSON.parse(this.memory.pathTarget)}`);
//     let pathTarget: RoomPosition | undefined = undefined;
//     if (typeof this.memory.betterPathTargetX === 'number' && typeof this.memory.betterPathTargetY === 'number' && typeof this.memory.betterPathTargetRoom === 'string') {
//         pathTarget = new RoomPosition(this.memory.betterPathTargetX, this.memory.betterPathTargetY, this.memory.betterPathTargetRoom);
//     } else {
//         find_new_path = true;
//     }
//     // console.log(pathTarget);
//     // console.log(location);
//     if((!pathTarget || !pathTarget.isEqualTo(repTarget)) || (typeof this.memory.tickPathFound === 'number' && this.memory.tickPathFound < Game.time - ticks_to_reuse)){
//         // console.log("target was different");
//         this.memory.betterPathTargetX = repTarget.x;
//         this.memory.betterPathTargetY = repTarget.y;
//         this.memory.betterPathTargetRoom = repTarget.roomName;
//         this.memory.tickPathFound = Game.time;
//         find_new_path = true;
//     }
//     if(find_new_path){
//         const creepSelf = this as Creep;
//         // console.log(`Creep ${this.name} is finding a new path to ${location}`);
//         let targetPos = new RoomPosition(repTarget.x, repTarget.y, repTarget.roomName);
//         const self = this as Creep;
//         // generate a new path to the target and store it in memory
//         let betterPath;
//         if(isGoals){
//             const goalObjs = goals!.map(g => ({pos: g, range: 0}));
//             betterPath = PathFinder.search(self.pos, goalObjs, {
//                 plainCost: 2,
//                 swampCost: 10,
//                 maxRooms: 32,
//                 maxOps: opts?.maxOps,
//                 roomCallback: function(roomName){
//                     // console.log("Checking room: "+roomName);
//                     if(roomName!==targetPos.roomName){
//                         if(checkIfHostileRoom(roomName)){
//                             // console.log("Hostile room: "+roomName);
//                             //check if this room is also the target
//                             return false;
//                         }
//                     }
//                     // console.log("friendly room: "+roomName);
//                     // also exclude any exit tiles leading to those rooms
//                     // if(!Object.keys(Game.rooms).includes(roomName)) return new PathFinder.CostMatrix();
//                     let rCMat = getCostMatrixForRoom(roomName);
//                     if(rCMat !== undefined){
//                         try {
//                             // If this creep has been marked with a temporary blocked tile
//                             // (set by the coordinator when a mover's goal is occupied by
//                             // a stationary creep), ensure that tile is treated as
//                             // impassable for this creep's PathFinder run.
//                             const tb = creepSelf && (creepSelf.memory as any)?.tempBlockedTile;
//                             if (tb && tb.tick === Game.time && tb.roomName === roomName) {
//                                 rCMat.set(tb.x, tb.y, 255);
//                             }
//                         } catch (e) {}
//                         // find hostiles in the room and set any tile within 3 range to 255
//                         let room = Game.rooms[roomName];
//                         if(room){
//                             for(const hostile of room.find(FIND_HOSTILE_CREEPS)){
//                                 // set every tile in a 3x3 circle of the hostile to 255
//                                 for(let i=-3;i<4;i++){
//                                     for(let j=-3;j<4;j++){
//                                         const xpos = hostile.pos.x + i;
//                                         const ypos = hostile.pos.y + j;
//                                         if(xpos<0 || xpos>49 || ypos<0 || ypos>49) continue;
//                                         rCMat.set(xpos, ypos, 255);
//                                     }
//                                 }
//                             }
//                             if(isGoals){
//                                 // When pathfinding to adjacent goal tiles (e.g. a source),
//                                 // allow pathfinder to route through occupied tiles except
//                                 // when the occupied tile is itself one of the goal tiles and
//                                 // the occupant is *not* expected to move. This prevents
//                                 // multiple creeps planning to arrive at the same occupied
//                                 // source-adjacent square and queueing there.
//                                 const reservations = getAllMoveReservations();
//                                 const goalSet = new Set<string>(goals!.map(g => `${g.x},${g.y}`));
//                                 for(const creep of room.find(FIND_MY_CREEPS)){
//                                     if (creep.name === self.name) continue;
//                                     const key = `${creep.pos.x},${creep.pos.y}`;
//                                     const resOcc = reservations[creep.name];
//                                     const incoming = incomingReservationOrIntent(reservations, roomName, creep.pos.x, creep.pos.y);
//                                     const hasPlanned = !!(creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0);
//                                     const hasOutgoingIntent = !!(creep && creep.room && Object.values(getColonyIntents(creep.room.name) || {}).some(i => i.tick === Game.time && i.from.room === creep.room.name && i.from.x === creep.pos.x && i.from.y === creep.pos.y));
//                                     const willMove = hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === roomName && resOcc.from.x === creep.pos.x && resOcc.from.y === creep.pos.y && incoming !== undefined);
//                                     const isStationary = creepIsStationary(creep, reservations, roomName);
//                                     if (goalSet.has(key)) {
//                                         // If this occupied tile is a final goal tile, only allow it
//                                         // if the occupant is expected to move or it's not a stationary harvester.
//                                         if (willMove) {
//                                             rCMat.set(creep.pos.x, creep.pos.y, 1);
//                                         } else if (isStationary) {
//                                             rCMat.set(creep.pos.x, creep.pos.y, 255);
//                                         } else {
//                                             rCMat.set(creep.pos.x, creep.pos.y, OCCUPIED_STATIC_COST);
//                                         }
//                                     } else {
//                                         // Non-goal occupied tiles: allow routing through them only if
//                                         // the occupant plans to move or reservations indicate a move.
//                                         if (willMove) {
//                                             rCMat.set(creep.pos.x, creep.pos.y, 1);
//                                         } else if (isStationary) {
//                                             rCMat.set(creep.pos.x, creep.pos.y, 255);
//                                         } else {
//                                             rCMat.set(creep.pos.x, creep.pos.y, OCCUPIED_STATIC_COST);
//                                         }
//                                     }
//                                 }
//                             } else {
//                                 const reservations = getAllMoveReservations();
//                                 for(const creep of room.find(FIND_MY_CREEPS)){
//                                     if (creep.name === self.name) continue;
//                                     const resOcc = reservations[creep.name];
//                                     const incoming = incomingReservationOrIntent(reservations, roomName, creep.pos.x, creep.pos.y);
//                                     const hasPlanned = !!(creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0);
//                                     const hasOutgoingIntent = !!(creep && creep.room && Object.values(getColonyIntents(creep.room.name) || {}).some(i => i.tick === Game.time && i.from.room === creep.room.name && i.from.x === creep.pos.x && i.from.y === creep.pos.y));
//                                     const willMove = hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === roomName && resOcc.from.x === creep.pos.x && resOcc.from.y === creep.pos.y && incoming !== undefined);
//                                     const isStationary = creepIsStationary(creep, reservations, roomName);
//                                     if (willMove) {
//                                         rCMat.set(creep.pos.x, creep.pos.y, 1);
//                                     } else if (isStationary) {
//                                         rCMat.set(creep.pos.x, creep.pos.y, 255);
//                                     } else {
//                                         rCMat.set(creep.pos.x, creep.pos.y, OCCUPIED_STATIC_COST);
//                                     }
//                                 }
//                             }
//                         }
//                         return rCMat;
//                     }

//                     let room = Game.rooms[roomName];
//                     if(!room) return new PathFinder.CostMatrix();

//                     let costs = new PathFinder.CostMatrix();
//                     room.find(FIND_STRUCTURES).forEach(function(struct) {
//                     if (struct.structureType === STRUCTURE_ROAD) {
//                         // Favor roads over plain tiles
//                         costs.set(struct.pos.x, struct.pos.y, 1);
//                     } else if (struct.structureType !== STRUCTURE_CONTAINER &&
//                                 (struct.structureType !== STRUCTURE_RAMPART ||
//                                 !struct.my)) {
//                         // Can't walk through non-walkable buildings
//                         costs.set(struct.pos.x, struct.pos.y, 255);
//                     }
//                     });

//                     // // Avoid creeps in the room
//                     // room.find(FIND_CREEPS).forEach(function(creep) {
//                     // costs.set(creep.pos.x, creep.pos.y, 0xff);
//                     // });

//                     // //Check if any exit tiles in room lead to a hostile
//                     // //check if any side of the room leads to a hostile room

//                     return costs;

//                 }
//             });
//         } else {
//             betterPath = PathFinder.search(
//                 this.pos, targetPos, {
//                     plainCost: 2,
//                     swampCost: 10,
//                     maxRooms: 32,
//                     maxOps: opts?.maxOps,
//                     roomCallback: function(roomName){
//                         // (roomCallback body copied below)
//                         if(roomName!==targetPos.roomName){
//                             if(checkIfHostileRoom(roomName)){
//                                 return false;
//                             }
//                         }
//                         let rCMat = getCostMatrixForRoom(roomName);
//                         if(rCMat !== undefined){
//                             let room = Game.rooms[roomName];
//                             if(room){
//                                 for(const hostile of room.find(FIND_HOSTILE_CREEPS)){
//                                     for(let i=-3;i<4;i++){
//                                         for(let j=-3;j<4;j++){
//                                             const xpos = hostile.pos.x + i;
//                                             const ypos = hostile.pos.y + j;
//                                             if(xpos<0 || xpos>49 || ypos<0 || ypos>49) continue;
//                                             rCMat.set(xpos, ypos, 255);
//                                         }
//                                     }
//                                 }
//                                 // also exclude any exit tiles leading to those rooms
//                                 // if(!Object.keys(Game.rooms).includes(roomName)) return new PathFinder.CostMatrix();
//                                 const reservations = getAllMoveReservations();
//                                 for(const creep of room.find(FIND_MY_CREEPS)){
//                                     const resOcc = reservations[creep.name];
//                                     const incoming = incomingReservationOrIntent(reservations, roomName, creep.pos.x, creep.pos.y);
//                                     const hasPlanned = !!(creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0);
//                                     const hasOutgoingIntent = !!(creep && creep.room && Object.values(getColonyIntents(creep.room.name) || {}).some(i => i.tick === Game.time && i.from.room === creep.room.name && i.from.x === creep.pos.x && i.from.y === creep.pos.y));
//                                     const willMove = hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === roomName && resOcc.from.x === creep.pos.x && resOcc.from.y === creep.pos.y && (resOcc.to.x !== resOcc.from.x || resOcc.to.y !== resOcc.from.y || resOcc.to.room !== resOcc.from.room) && incoming !== undefined);
//                                     if (willMove) {
//                                         rCMat.set(creep.pos.x, creep.pos.y, 1);
//                                     } else {
//                                         rCMat.set(creep.pos.x, creep.pos.y, 255);
//                                     }
//                                 }
//                             }
//                             return rCMat;
//                         }
//                         let room = Game.rooms[roomName];
//                         if(!room) return new PathFinder.CostMatrix();

//                         let costs = new PathFinder.CostMatrix();
//                         room.find(FIND_STRUCTURES).forEach(function(struct) {
//                         if (struct.structureType === STRUCTURE_ROAD) {
//                             costs.set(struct.pos.x, struct.pos.y, 1);
//                         } else if (struct.structureType !== STRUCTURE_CONTAINER &&
//                                     (struct.structureType !== STRUCTURE_RAMPART ||
//                                     !struct.my)) {
//                             costs.set(struct.pos.x, struct.pos.y, 255);
//                         }
//                         });

//                         return costs;
//                     }
//                 }
//             )
//         }
//         if (betterPath.incomplete){
//             console.log("There was an error finding the path from " + this.pos + " to " + location);
//             // this.flee();
//         }

//         // Post-process computed path: if any step on the path is occupied by a
//         // stationary creep that is not expected to move (no reservation/intent),
//         // retry pathfinding once while marking those occupied tiles as blocked.
//         let finalPath = betterPath.path;
//         try {
//             const reservations = getAllMoveReservations();
//             const blockedTiles = new Set<string>();
//             for (const step of finalPath) {
//                 if (!step || typeof step.x !== 'number' || typeof step.y !== 'number' || typeof step.roomName !== 'string') continue;
//                 const roomObj = Game.rooms[step.roomName];
//                 if (!roomObj) continue;
//                 const occupants: Creep[] = roomObj.lookForAt(LOOK_CREEPS, step.x, step.y) as Creep[];
//                 if (occupants.length === 0) continue;
//                 const occ = occupants[0];
//                 const resOcc = reservations[occ.name];
//                 const incoming = incomingReservationOrIntent(reservations, step.roomName, step.x, step.y);
//                 const hasPlanned = !!(occ.memory && Array.isArray((occ.memory as any).betterPath) && (occ.memory as any).betterPath.length > 0);
//                 const hasOutgoingIntent = !!(occ && occ.room && Object.values(getColonyIntents(occ.room.name) || {}).some(i => i.tick === Game.time && i.from.room === occ.room.name && i.from.x === occ.pos.x && i.from.y === occ.pos.y));
//                 const queued = occ && occ.memory ? (occ.memory as any).queuedMove : undefined;
//                 const queuedInFlight = !!(queued && typeof queued.tick === 'number' && queued.tick >= Game.time - 1 && queued.room === step.roomName);
//                 const willMove = queuedInFlight || hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === step.roomName && resOcc.from.x === step.x && resOcc.from.y === step.y && incoming !== undefined);
//                 const isStationary = creepIsStationary(occ, reservations, step.roomName);
//                 if (!willMove && isStationary) {
//                     blockedTiles.add(`${step.roomName}:${step.x},${step.y}`);
//                 }
//             }
//             if (blockedTiles.size > 0) {
//                 // Re-run PathFinder with blockedTiles marked impassable
//                 const blocked = blockedTiles;
//                 const retry = PathFinder.search(this.pos, isGoals ? goals!.map(g => ({pos: g, range: 0})) : targetPos, {
//                     plainCost: 2,
//                     swampCost: 10,
//                     maxRooms: 32,
//                     maxOps: opts?.maxOps,
//                     roomCallback: function(roomName){
//                         let rCMat = getCostMatrixForRoom(roomName);
//                         if(rCMat !== undefined){
//                             let room = Game.rooms[roomName];
//                             if(room){
//                                 // mark blocked tiles impassable
//                                 for (const key of Array.from(blocked)){
//                                     const [r, xy] = key.split(':');
//                                     if(r !== roomName) continue;
//                                     const [sx, sy] = xy.split(',').map(Number);
//                                     rCMat.set(sx, sy, 255);
//                                 }
//                                 for(const hostile of room.find(FIND_HOSTILE_CREEPS)){
//                                     for(let i=-3;i<4;i++){
//                                         for(let j=-3;j<4;j++){
//                                             const xpos = hostile.pos.x + i;
//                                             const ypos = hostile.pos.y + j;
//                                             if(xpos<0 || xpos>49 || ypos<0 || ypos>49) continue;
//                                             rCMat.set(xpos, ypos, 255);
//                                         }
//                                     }
//                                 }
//                                 // also adjust creep occupancy as usual
//                                 const reservationsInner = getAllMoveReservations();
//                                 for(const creep of room.find(FIND_MY_CREEPS)){
//                                     if (creep.name === self.name) continue;
//                                     const resOcc = reservationsInner[creep.name];
//                                     const incomingInner = incomingReservationOrIntent(reservationsInner, roomName, creep.pos.x, creep.pos.y);
//                                     const hasPlannedInner = !!(creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0);
//                                     const willMoveInner = hasPlannedInner || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === roomName && resOcc.from.x === creep.pos.x && resOcc.from.y === creep.pos.y && incomingInner !== undefined);
//                                     const isStatInner = creepIsStationary(creep, reservationsInner, roomName);
//                                     if (willMoveInner) {
//                                         rCMat.set(creep.pos.x, creep.pos.y, 1);
//                                     } else if (isStatInner) {
//                                         rCMat.set(creep.pos.x, creep.pos.y, 255);
//                                     } else {
//                                         rCMat.set(creep.pos.x, creep.pos.y, OCCUPIED_STATIC_COST);
//                                     }
//                                 }
//                             }
//                             return rCMat;
//                         }
//                         return new PathFinder.CostMatrix();
//                     }
//                 });
//                 if (!retry.incomplete) {
//                     finalPath = retry.path;
//                 }
//             }
//         } catch(e) {}

//         this.memory.betterPath = finalPath;
//     }
//     // console.log("path is:"+this.memory.path);
//     // determine which stage of the path the creep has reached then move to the next step. if it matches no step then do the first move
//     let current_step = 0;
//     if (this.pos.isEqualTo(repTarget)) {
//         this.memory.betterPath = undefined;
//         this.memory.betterPathTargetX = undefined;
//         this.memory.betterPathTargetY = undefined;
//         this.memory.betterPathTargetRoom = undefined;
//         this.memory.tickPathFound = undefined;
//         return OK;
//     }
//     if(this.memory.betterPath!==undefined && this.memory.betterPath.length>0){
//         // console.log(`Path for creep ${this.name} is: ${JSON.stringify(this.memory.betterPath)}`);
//         const head = this.memory.betterPath[0];
//         if (!head || typeof head.x !== 'number' || typeof head.y !== 'number' || typeof head.roomName !== 'string'){
//             // malformed head entry, clear path to force recompute
//             this.memory.betterPath = undefined;
//             this.memory.betterPathTargetX = undefined;
//             this.memory.betterPathTargetY = undefined;
//             this.memory.betterPathTargetRoom = undefined;
//             return ERR_INVALID_TARGET;
//         }
//         let nextStep = new RoomPosition(head.x, head.y, head.roomName);
//         const dx = Math.abs(this.pos.x - nextStep.x);
//         const dy = Math.abs(this.pos.y - nextStep.y);
//         const stepIsAdjacent = this.pos.roomName === nextStep.roomName && Math.max(dx, dy) === 1;
//         if (!stepIsAdjacent) {
//             try { console.log(`[betterMoveTo] ${this.name} stale path head is not adjacent: from=${this.pos.x},${this.pos.y},${this.pos.roomName} to=${nextStep.x},${nextStep.y},${nextStep.roomName} dx=${dx} dy=${dy}; clearing path and replanning`); } catch(e) {}
//             this.memory.betterPath = undefined;
//             this.memory.betterPathTargetX = undefined;
//             this.memory.betterPathTargetY = undefined;
//             this.memory.betterPathTargetRoom = undefined;
//             this.memory.tickPathFound = undefined;
//             find_new_path = true;
//         }
//         // If the planned next step is currently occupied by a stationary
//         // creep (and there is no reservation indicating the occupant will
//         // move), abandon the cached path so we recompute and choose a
//         // different approach tile. This prevents creeps from following a
//         // stale path into a blocked square.
//         try {
//             const reservations = getAllMoveReservations();
//             const roomObj = Game.rooms[nextStep.roomName];
//             const occupants: Creep[] = roomObj ? (roomObj.lookForAt(LOOK_CREEPS, nextStep.x, nextStep.y) as Creep[]) : [];
//             if (occupants.length > 0) {
//                 const occ = occupants[0];
//                 const resOcc = reservations[occ.name];
//                 const incoming = incomingReservationOrIntent(reservations, nextStep.roomName, nextStep.x, nextStep.y);
//                 const hasPlanned = !!(occ.memory && Array.isArray((occ.memory as any).betterPath) && (occ.memory as any).betterPath.length > 0);
//                 const hasOutgoingIntent = !!(occ && occ.room && Object.values(getColonyIntents(occ.room.name) || {}).some(i => i.tick === Game.time && i.from.room === occ.room.name && i.from.x === occ.pos.x && i.from.y === occ.pos.y));
//                 const willMove = hasPlanned || hasOutgoingIntent || (resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === nextStep.roomName && resOcc.from.x === nextStep.x && resOcc.from.y === nextStep.y && incoming !== undefined);
//                 const isStationary = creepIsStationary(occ, reservations, nextStep.roomName);
//                 if (!willMove && isStationary) {
//                     // clear cached path and force recompute next tick
//                     this.memory.betterPath = undefined;
//                     this.memory.betterPathTargetX = undefined;
//                     this.memory.betterPathTargetY = undefined;
//                     this.memory.betterPathTargetRoom = undefined;
//                     this.memory.tickPathFound = undefined;
//                     return ERR_INVALID_TARGET;
//                 }
//             }

//             // Reserve our intended move for this tick so other creeps' pathfinding
//             // can see our intent and allow swaps. When using colony-level
//             // coordination the coordinator will perform the actual `move` calls,
//             // so skip calling `moveTo` here.
//             try {
//                 // Validate that nextStep is actually adjacent before attempting reservation
//                 const dx = Math.abs(this.pos.x - nextStep.x);
//                 const dy = Math.abs(this.pos.y - nextStep.y);
//                 if (Math.max(dx, dy) !== 1 || this.pos.roomName !== nextStep.roomName) {
//                     try { console.log(`[betterMoveTo] ${this.name} stale nextStep is not adjacent: from=${this.pos.x},${this.pos.y},${this.pos.roomName} to=${nextStep.x},${nextStep.y},${nextStep.roomName} dx=${dx} dy=${dy}; clearing path and replanning`); } catch(e) {}
//                     // Clear path and force replan, but do not report success for the stale step.
//                     this.memory.betterPath = undefined;
//                     this.memory.betterPathTargetX = undefined;
//                     this.memory.betterPathTargetY = undefined;
//                     this.memory.betterPathTargetRoom = undefined;
//                     this.memory.tickPathFound = undefined;
//                     find_new_path = true;
//                 }
//                 reserveMove(this.name, this.pos, nextStep);
//                 // Only publish an intent if the reservation was actually recorded.
//                 const existingRes = getMoveReservation(this.name);
//                 if (!(existingRes && existingRes.tick === Game.time && existingRes.to && existingRes.to.x === nextStep.x && existingRes.to.y === nextStep.y && existingRes.to.room === nextStep.roomName)) {
//                     try { console.log(`[betterMoveTo] ${this.name} reservation was rejected; not publishing intent to ${nextStep.x},${nextStep.y},${nextStep.roomName}`); } catch(e) {}
//                     // If reservation was rejected (likely due to tempBlockedTile), clear cached path to force a replan
//                     this.memory.betterPath = undefined;
//                     this.memory.betterPathTargetX = undefined;
//                     this.memory.betterPathTargetY = undefined;
//                     this.memory.betterPathTargetRoom = undefined;
//                     this.memory.tickPathFound = undefined;
//                     return ERR_INVALID_TARGET;
//                 }
//                 // Publish the intent so the coordinator knows about this move
//                 const colonyRoom = this.memory.colony || this.room.name;
//                 try { console.log(`[betterMoveTo] ${this.name} publishing intent; pathHead=${JSON.stringify(this.memory?.betterPath?.[0] ?? null)} pathLen=${this.memory?.betterPath?.length ?? 0}`); } catch(e) {}
//                 publishIntent(colonyRoom, this.name, this.pos, nextStep);
//             } catch (e) {
//                 // swallow any reservation errors to avoid breaking movement
//             }
//         } catch (e) {
//             // ignore reservation errors
//         }

//         if (USE_COLONY_MOVEMENT) {
//             try {
//                 console.log(`[betterMoveTo] ${this.name} intent published: from=${this.pos.x},${this.pos.y},${this.pos.roomName} -> to=${nextStep.x},${nextStep.y},${nextStep.roomName}; coordinator will execute move; pathHead=${JSON.stringify(this.memory?.betterPath?.[0] ?? null)} pathLen=${this.memory?.betterPath?.length ?? 0}`);
//             } catch(e) {}
//             return OK; // intent published; coordinator will execute the move
//         }

//         let retVal = this.moveTo(nextStep);

//         // console.log(`Creep ${this.name} is moving from ${this.pos} to ${nextStep.x}, ${nextStep.y}, ${nextStep.roomName}`);
//         // console.log(`Creep has fatigue ${this.fatigue}`);
//         if (retVal === OK) {
//             // remove the first step of the path from memory
//             if (this.memory.betterPath && Array.isArray(this.memory.betterPath) && this.memory.betterPath.length > 0) {
//                 this.memory.betterPath.shift();
//             }
//         } else {
//             // Handle movement failure
//         }
//         // console.log(`returning ${retVal}`)
//         return retVal;
//     }

//     // Fallback: if no path exists, try to publish an intent to move one step towards the target
//     if (repTarget && !this.pos.isEqualTo(repTarget)) {
//         const direction = this.pos.getDirectionTo(repTarget);
//         // Map Screeps direction to offset
//         // Direction: 1=TOP, 2=TOP_RIGHT, 3=RIGHT, 4=BOTTOM_RIGHT, 5=BOTTOM, 6=BOTTOM_LEFT, 7=LEFT, 8=TOP_LEFT
//         const directionOffsets: {[key: number]: {dx: number, dy: number}} = {
//             1: {dx: 0, dy: -1},   // TOP
//             2: {dx: 1, dy: -1},   // TOP_RIGHT
//             3: {dx: 1, dy: 0},    // RIGHT
//             4: {dx: 1, dy: 1},    // BOTTOM_RIGHT
//             5: {dx: 0, dy: 1},    // BOTTOM
//             6: {dx: -1, dy: 1},   // BOTTOM_LEFT
//             7: {dx: -1, dy: 0},   // LEFT
//             8: {dx: -1, dy: -1}   // TOP_LEFT
//         };
//         const offset = directionOffsets[direction];
//         if (offset) {
//             const nextX = this.pos.x + offset.dx;
//             const nextY = this.pos.y + offset.dy;
//             if (nextX >= 0 && nextX < 50 && nextY >= 0 && nextY < 50) {
//                 const nextPos = new RoomPosition(nextX, nextY, this.pos.roomName);
//                 try {
//                     reserveMove(this.name, this.pos, nextPos);
//                     const existingRes = getMoveReservation(this.name);
//                     if (existingRes && existingRes.tick === Game.time && existingRes.to && existingRes.to.x === nextPos.x && existingRes.to.y === nextPos.y && existingRes.to.room === nextPos.roomName) {
//                         const colonyRoom = this.memory.colony || this.room.name;
//                         try { console.log(`[betterMoveTo] ${this.name} publishing fallback intent; pathHead=${JSON.stringify(this.memory?.betterPath?.[0] ?? null)} pathLen=${this.memory?.betterPath?.length ?? 0}`); } catch(e) {}
//                         publishIntent(colonyRoom, this.name, this.pos, nextPos);
//                         if (USE_COLONY_MOVEMENT) {
//                             return OK;
//                         }
//                     }
//                 } catch (e) {}
//             }
//         }
//     }

//     return this.moveTo(this.pos);
// }

// Determine whether a creep should be treated as stationary (working in-place)
export function creepIsStationary(creep: Creep, reservations: {[creepName:string]: any}, roomName: string): boolean {
    try {
        const resOcc = reservations[creep.name];
        const intents = getColonyIntents(roomName);
        const queuedMove = (creep.memory as any)?.queuedMove;
        const queuedMoveInFlight = !!(queuedMove && typeof queuedMove.tick === 'number' && queuedMove.tick >= Game.time - 1 && queuedMove.room === roomName);
        if (queuedMoveInFlight) {
            // A queued move is still in flight; do not classify the creep as stationary
            // just because the current tick still shows it on the origin tile.
            return false;
        }
        const incoming = Object.values(reservations).find(r => r.tick === Game.time && r.to.room === roomName && r.to.x === creep.pos.x && r.to.y === creep.pos.y)
            || Object.values(intents || {}).find(i => i.tick === Game.time && i.to.room === roomName && i.to.x === creep.pos.x && i.to.y === creep.pos.y);
        const hasPlanned = !!(creep.memory && Array.isArray((creep.memory as any).betterPath) && (creep.memory as any).betterPath.length > 0);
        const hasOutgoingIntent = Object.values(intents || {}).some(i => i.tick === Game.time && i.from.room === roomName && i.from.x === creep.pos.x && i.from.y === creep.pos.y);
        // Treat a reservation as an outgoing move only when it actually reserves
        // a different destination tile than the current tile. This avoids
        // classifying creeps as 'moving' when a reservation simply mirrors the
        // current position or is otherwise non-moving.
        const hasOutgoingReservation = !!(resOcc !== undefined && resOcc.tick === Game.time && resOcc.from.room === roomName && resOcc.from.x === creep.pos.x && resOcc.from.y === creep.pos.y && (
            resOcc.to.room !== resOcc.from.room || resOcc.to.x !== resOcc.from.x || resOcc.to.y !== resOcc.from.y
        ));
        const taskType = creep.memory && creep.memory.taskId ? (() => { try { const task = getTaskMemory(creep.memory.taskId); return task && typeof (task as any).type === 'string' ? (task as any).type : undefined; } catch (e) { return undefined; } })() : undefined;
        const isStationaryWork = !!(
            isUpgradingAtController(creep) ||
            (creep.memory && (creep.memory as any).working === true) ||
            (creep.memory && creep.memory.taskId && taskType && ['HARVEST','MINE','REMOTE_MINING','UPGRADE','BUILD','REPAIR','FILL','PICKUP'].includes(taskType))
        );

        // A stale path must not override actual in-place work. If the creep is
        // standing still and is actively harvesting/upgrading/building in place,
        // it should still count as stationary.
        if (isStationaryWork && !hasOutgoingIntent && !hasOutgoingReservation) return true;

        const outgoingMove = !!(
            hasPlanned ||
            hasOutgoingReservation ||
            hasOutgoingIntent
        );
        const willMove = outgoingMove || (hasOutgoingReservation && incoming !== undefined);
        if (willMove) return false;
        if ((creep as any).fatigue && (creep as any).fatigue > 0) return false;

        // If the creep has no task and is not explicitly marked `working`, and
        // has no outgoing plan/intents/reservations, treat it as stationary.
        try {
            const hasTask = !!(creep.memory && creep.memory.taskId);
            const memoryWorking = !!(creep.memory && (creep.memory as any).working === true);
            if (!hasTask && !memoryWorking && !hasPlanned && !hasOutgoingIntent && !hasOutgoingReservation) return true;
        } catch (e) {}

        if (isStationaryWork && !hasOutgoingIntent && !hasOutgoingReservation && !hasPlanned) return true;

        // A stale cached path is not enough to override real in-place work.
        if (isStationaryWork && !hasOutgoingIntent && !hasOutgoingReservation) return true;

        if (creep.memory && (creep.memory as any).working === true) {
            if (!hasOutgoingIntent && !hasOutgoingReservation) return true;
        }

        if (creep.memory && creep.memory.taskId) {
            try {
                const t = getTaskMemory(creep.memory.taskId);
                if (t && typeof (t as any).type === 'string'){
                    const stationaryTasks = new Set(['HARVEST','MINE','REMOTE_MINING','UPGRADE','BUILD','REPAIR','FILL','PICKUP']);
                    if (!hasOutgoingIntent && !hasOutgoingReservation && stationaryTasks.has((t as any).type)) return true;
                }
            } catch(e) {}
        }

        return false;
    } catch(e) {
        return false;
    }
}


