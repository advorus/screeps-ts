import { checkIfHostileRoom, getTaskMemory } from "core/memory";

export {};

declare global {
    interface Creep {
        /**
         * Moves the creep to a target position or object, avoiding hostiles.
         * @param target The target position or object to move to.
         * @param opts Optional move options.
         * @returns Screeps return code.
         */
        safeMoveTo(target: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode;
        betterMoveTo(location: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode;
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
    opts.reusePath = 5;
    opts.costCallback = (roomName,costMatrix) => {
        if(checkIfHostileRoom(roomName)&&roomName!==targetPos.roomName){
            for(let i=0;i<50;i++){
                for(let j=0;j<50;j++){
                    costMatrix.set(i,j,999);
                }
            }
        }
    }

    const pos = target instanceof RoomObject ? target.pos : target;
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS, {
        filter: c => c.pos.inRangeTo(this.pos, 5)
    });
    if (hostiles.length > 0) {
        this.say('⚠️ Hostile!');
        // find the nearest hostile and move by path 4 cells away\
        const nearestHostile = this.pos.findClosestByRange(hostiles);
        if(nearestHostile !== null){
            const path = PathFinder.search(this.pos, {pos: nearestHostile.pos, range:3}, {flee: true}).path;
            return this.moveByPath(path);
        }
    }
    let targetRoom = undefined;
    if(target instanceof RoomObject) {
        targetRoom = target.room?.name;
    } else{
        targetRoom = target.roomName;
    }

    if(targetRoom !== this.room.name || !this.pos.isInsideRoom()){
        // the creep is pathing to a different room;
        this.say(`🚪 to ${targetRoom}`);
        if(this.memory.taskId !== undefined){
            let taskMem = getTaskMemory(this.memory.taskId);
            // console.log(taskMem.type);
            if(taskMem.type == `SCOUT`){
                // if the task is a scout task then just move normally
                return this.moveTo(pos, opts);
            }
        }
        return this.moveTo(pos, opts);
    }

    return this.moveTo(pos, opts);
}

Creep.prototype.betterMoveTo = function(location: RoomPosition, opts?: MoveToOpts): ScreepsReturnCode {
    //avoids going into hostile rooms and can be cached for a certain number of ticks

    // do a search to find the path from the creep position to the object
    // only do this if it has been >=reuse ticks since the last path was found
    let find_new_path = false;
    const ticks_to_reuse = opts?.reusePath || 5;

    if(this.memory.pathTargetX == undefined || this.memory.pathTargetY == undefined || this.memory.pathTargetRoom == undefined){
        // console.log("didn't find existing target");
        this.memory.pathTargetX = location.x;
        this.memory.pathTargetY = location.y;
        this.memory.pathTargetRoom = location.roomName
        find_new_path = true;
    }
    if(this.memory.tickPathFound == undefined){
        // console.log("didn't find existing path time");
        this.memory.tickPathFound = Game.time;
        find_new_path = true;
    }
    // console.log(this.memory.pathTarget);
    // console.log(JSON.parse(this.memory.pathTarget));
    // console.log(`target is ${JSON.parse(this.memory.pathTarget)}`);
    let pathTarget = new RoomPosition(this.memory.pathTargetX, this.memory.pathTargetY, this.memory.pathTargetRoom);
    // console.log(pathTarget);
    // console.log(location);
    if((!pathTarget.isEqualTo(location)) || (this.memory.tickPathFound<Game.time-ticks_to_reuse)){
        // console.log("target was different: "+(!pathTarget.isEqualTo(location)));
        this.memory.pathTargetX = location.x;
        this.memory.pathTargetY = location.y;
        this.memory.pathTargetRoom = location.roomName;
        this.memory.tickPathFound = Game.time;
        find_new_path = true;
    }
    if(find_new_path){
        console.log(`Creep ${this.name} is finding a new path to ${location}`);
        let targetPos = new RoomPosition(location.x, location.y, location.roomName);
        // generate a new path to the target and store it in memory
        let path = PathFinder.search(
            this.pos, targetPos, {
                plainCost: 2,
                swampCost: 10,
                maxRooms: 64,
                roomCallback: function(roomName){
                    let room = Game.rooms[roomName]
                    if(!room) return false;
                    // exclude any hostile rooms
                    // console.log(roomName);
                    // console.log(`${roomName} is hostile: ${checkIfHostileRoom(roomName)} and is equal to the target room: ${roomName === targetPos.roomName}`);
                    if(checkIfHostileRoom(roomName)){
                        // console.log("Hostile room: "+roomName);
                        //check if this room is also the target
                        return false;
                    }
                    // console.log("friendly room: "+roomName);
                    // also exclude any exit tiles leading to those rooms
                    let costs = new PathFinder.CostMatrix;

                    room.find(FIND_STRUCTURES).forEach(function(struct) {
                    if (struct.structureType === STRUCTURE_ROAD) {
                        // Favor roads over plain tiles
                        costs.set(struct.pos.x, struct.pos.y, 1);
                    } else if (struct.structureType !== STRUCTURE_CONTAINER &&
                                (struct.structureType !== STRUCTURE_RAMPART ||
                                !struct.my)) {
                        // Can't walk through non-walkable buildings
                        costs.set(struct.pos.x, struct.pos.y, 0xff);
                    }
                    });

                    // Avoid creeps in the room
                    room.find(FIND_CREEPS).forEach(function(creep) {
                    costs.set(creep.pos.x, creep.pos.y, 0xff);
                    });

                    //Check if any exit tiles in room lead to a hostile
                    //check if any side of the room leads to a hostile room

                    return costs;

                }
            }
        )
        if (path.incomplete){
            // console.log("there was an error finding the path...")
        }
        console.log("path from"+this.pos+" to "+location+" is:"+path.path+" avoiding rooms "+Memory.hostileRooms);
        this.memory.path = path.path;
    }
    // console.log("path is:"+this.memory.path);
    // determine which stage of the path the creep has reached then move to the next step. if it matches no step then do the first move
    let current_step = 0;
    if(this.memory.path!==undefined){
        return this.moveByPath(this.memory.path);
        // for (let a=0;a<this.memory.path.length;a++){
        //     if(this.pos.isEqualTo(this.memory.path[a])){
        //         current_step = a+1;
        //     }
        // }
        // if(this.memory.path[current_step]!== undefined){
        //     return this.moveTo(this.memory.path[current_step]);
        // } else{
        //     return this.moveTo(this.memory.path[1]);
        // }
    }

    return this.moveTo(this.pos);

}
