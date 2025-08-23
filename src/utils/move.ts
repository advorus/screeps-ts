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
    }
}

Creep.prototype.safeMoveTo = function(target: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode {
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
            this.moveByPath(path);
        }
    }
    return this.moveTo(pos, opts);
}
