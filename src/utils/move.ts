import { checkIfHostileRoom, getCostMatrixForRoom, getTaskMemory } from "core/memory";

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

    opts.reusePath = 10;
    opts.maxRooms = 25;
    opts.plainCost = 2;
    opts.swampCost = 10;
    // opts.maxOps = 20000;
    // if(this.pos.isNearEdge()) opts.reusePath = 0;


    opts.costCallback = (roomName,costMatrix) => {
        // console.log(`checking room ${roomName}`)
        if(roomName!==targetPos.roomName){
            // console.log(`Room ${roomName} is not the target room ${targetPos.roomName} - checking if hostile`);
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
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS, {
        filter: c => c.pos.inRangeTo(this.pos, 5)
    });
    if (hostiles.length > 0&&this.memory.role!==`duo_attacker`&&this.memory.role!==`duo_healer`) {
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
        return this.betterMoveTo(pos, opts);
    }

    return this.moveTo(pos, opts);
}

Creep.prototype.betterMoveTo = function(location: RoomPosition, opts?: MoveToOpts): ScreepsReturnCode {
    //avoids going into hostile rooms and can be cached for a certain number of ticks

    // do a search to find the path from the creep position to the object
    // only do this if it has been >=reuse ticks since the last path was found
    let find_new_path = false;
    const ticks_to_reuse = opts?.reusePath || 15;

    if(this.memory.betterPathTargetX == undefined || this.memory.betterPathTargetY == undefined || this.memory.betterPathTargetRoom == undefined|| this.memory.betterPath==undefined){
        // console.log("didn't find existing target");
        this.memory.betterPathTargetX = location.x;
        this.memory.betterPathTargetY = location.y;
        this.memory.betterPathTargetRoom = location.roomName
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
    let pathTarget = new RoomPosition(this.memory.betterPathTargetX, this.memory.betterPathTargetY, this.memory.betterPathTargetRoom);
    // console.log(pathTarget);
    // console.log(location);
    if((!pathTarget.isEqualTo(location)) || (this.memory.tickPathFound<Game.time-ticks_to_reuse)){
        // console.log("target was different: "+(!pathTarget.isEqualTo(location)));
        this.memory.betterPathTargetX = location.x;
        this.memory.betterPathTargetY = location.y;
        this.memory.betterPathTargetRoom = location.roomName;
        this.memory.tickPathFound = Game.time;
        find_new_path = true;
    }
    if(find_new_path){
        // console.log(`Creep ${this.name} is finding a new path to ${location}`);
        let targetPos = new RoomPosition(location.x, location.y, location.roomName);
        // generate a new path to the target and store it in memory
        let betterPath = PathFinder.search(
            this.pos, targetPos, {
                plainCost: 2,
                swampCost: 10,
                maxRooms: 32,
                maxOps: opts?.maxOps,
                roomCallback: function(roomName){
                    // console.log("Checking room: "+roomName);
                    if(roomName!==targetPos.roomName){
                        if(checkIfHostileRoom(roomName)){
                            // console.log("Hostile room: "+roomName);
                            //check if this room is also the target
                            return false;
                        }
                    }
                    // console.log("friendly room: "+roomName);
                    // also exclude any exit tiles leading to those rooms
                    // if(!Object.keys(Game.rooms).includes(roomName)) return new PathFinder.CostMatrix();
                    let rCMat = getCostMatrixForRoom(roomName);
                    if(rCMat !== undefined){
                        return rCMat;
                    }

                    let room = Game.rooms[roomName];
                    if(!room) return new PathFinder.CostMatrix();

                    let costs = new PathFinder.CostMatrix();
                    room.find(FIND_STRUCTURES).forEach(function(struct) {
                    if (struct.structureType === STRUCTURE_ROAD) {
                        // Favor roads over plain tiles
                        costs.set(struct.pos.x, struct.pos.y, 1);
                    } else if (struct.structureType !== STRUCTURE_CONTAINER &&
                                (struct.structureType !== STRUCTURE_RAMPART ||
                                !struct.my)) {
                        // Can't walk through non-walkable buildings
                        costs.set(struct.pos.x, struct.pos.y, 255);
                    }
                    });

                    // // Avoid creeps in the room
                    // room.find(FIND_CREEPS).forEach(function(creep) {
                    // costs.set(creep.pos.x, creep.pos.y, 0xff);
                    // });

                    // //Check if any exit tiles in room lead to a hostile
                    // //check if any side of the room leads to a hostile room

                    return costs;

                }
            }
        )
        if (betterPath.incomplete){
            console.log("There was an error finding the path from " + this.pos + " to " + location);
        }
        // console.log("path from"+this.pos+" to "+location+" is:"+betterPath.path+" avoiding rooms "+Memory.hostileRooms);
        this.memory.betterPath = betterPath.path;
    }
    // console.log("path is:"+this.memory.path);
    // determine which stage of the path the creep has reached then move to the next step. if it matches no step then do the first move
    let current_step = 0;
    if(this.memory.betterPath!==undefined && this.memory.betterPath.length>0){
        // console.log(`Path for creep ${this.name} is: ${JSON.stringify(this.memory.betterPath)}`);
        let nextStep = new RoomPosition(this.memory.betterPath[0].x, this.memory.betterPath[0].y, this.memory.betterPath[0].roomName);
        let retVal = this.moveTo(nextStep);

        // console.log(`Creep ${this.name} is moving from ${this.pos} to ${nextStep.x}, ${nextStep.y}, ${nextStep.roomName}`);
        // console.log(`Creep has fatigue ${this.fatigue}`);
        if (retVal === OK) {
            // remove the first step of the path from memory
            this.memory.betterPath.shift();
        } else {
            // Handle movement failure
        }
        // console.log(`returning ${retVal}`)
        return retVal;
    }

    return this.moveTo(this.pos);
}

