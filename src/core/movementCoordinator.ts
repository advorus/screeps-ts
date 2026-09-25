import { getColonyIntents, getAllMoveReservations, getTaskMemory, getMoveReservation } from "core/memory";
import { creepIsStationary } from "utils/move";
import { isUpgradingAtController } from "utils/move";
// import { drawRoomOverview as drawRoomOverviewVisual } from "utils/movementVisuals";
import {profile} from "Profiler";

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


export function flushMoveSummary(): void {
    Memory.moveReservations = {};
}

export function resolveAndExecuteAll(): void {
    // list of reservations of spots that creeps want to move to
    // for any cells 'to' which are unique, execute the moves
    // then we need a conflict handler if two creeps want to move into the same cell
}

export default { resolveAndExecuteAll, flushMoveSummary};
