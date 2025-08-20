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
        return ERR_NO_PATH; // Or implement flee logic
    }
    return this.moveTo(pos, opts);
}
