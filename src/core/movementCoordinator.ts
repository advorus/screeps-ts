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

    let moveReservations = getAllMoveReservations();
    // this can be simplified into all the chains of movement
    // where creeps want to move into another creep's position,
    // and so on
    let chains: Record<string, string[]> = {};



    // get a count of all the to positions
    let fromPositions: Record<string, string[]> = {};
    let toPositions: Record<string, string[]> = {};
    for (const [creepName, reservation] of Object.entries(moveReservations)) {
        const toPosString = reservation.to.x+"_"+reservation.to.y+reservation.to.room;
        const fromPosString = reservation.from.x+"_"+reservation.from.y+reservation.from.room;
        if (!toPositions[toPosString]) {
            toPositions[toPosString] = [];
        }
        toPositions[toPosString].push(creepName);
        if (!fromPositions[fromPosString]) {
            fromPositions[fromPosString] = [];
        }
        fromPositions[fromPosString].push(creepName);
    }


    for (const [creepName, reservation] of Object.entries(getAllMoveReservations())) {
        // case where nobody else wants to go to where the creep wants to move
        // and nobody else is currently at the target position who has expressed a preference
        if(toPositions[reservation.to.x+"_"+reservation.to.y+reservation.to.room].length === 1) {
            if(fromPositions[reservation.to.x+"_"+reservation.to.y+reservation.to.room].length === 0) {
            // execute the move for this creep
            const creep = Game.creeps[creepName];
                if (creep) {
                    mvLog(`Creep ${creepName} moving from ${reservation.from.x},${reservation.from.y} to ${reservation.to.x},${reservation.to.y}`);
                    const targetPos = new RoomPosition(reservation.to.x, reservation.to.y, reservation.to.room);
                    const getDirection = creep.pos.getDirectionTo(targetPos);
                    // check if there is a creep on the target position
                    // if there is, then move it onto the FROM spot
                    const creepOnTarget = Game.rooms[reservation.to.room].lookForAt(LOOK_CREEPS, reservation.to.x, reservation.to.y)[0];
                    if (creepOnTarget) {
                        const fromPos = new RoomPosition(reservation.from.x, reservation.from.y, reservation.from.room);
                        const directionToFrom = creepOnTarget.pos.getDirectionTo(fromPos);
                        creepOnTarget.move(directionToFrom);
                    }
                    creep.move(getDirection);
                    // shift the path for the creep that got moved
                    if (creep.memory.betterPath) {
                        creep.memory.betterPath.shift();
                    }
                }
            }
            else{
                // this is the case where only one creep wants to move to the cell
                // and the creep that is on that cell has expressed a preference also to move
            }
        }
        else{
            // this is the case that two creeps have expressed a preference to move to the same cell
        }
    }
}

function findChains(toPositions: Record<string, string[]>, fromPositions: Record<string, string[]>): Record<string, string[]> {
    let chains: Record<string, string[]> = {};
    // logic to find chains of movements

    return chains;
}

export default { resolveAndExecuteAll, flushMoveSummary};
