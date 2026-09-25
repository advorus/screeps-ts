import { ErrorMapper } from "utils/ErrorMapper";
import { Empire } from "core/empire";
import { clearMoveReservations, clearAllIntents } from "core/memory";
import movementCoordinator from "core/movementCoordinator";
import * as Profiler from "Profiler";
import trafficManager from "utils/trafficManager";


global.Profiler = Profiler.init();
// Memory.tasks = {};
//
declare global {
  /*
    Example types, expand on these or remove them and add your own.
    Note: Values, properties defined here do no fully *exist* by this type definiton alone.
          You must also give them an implemention if you would like to use them. (ex. actually setting a `role` property in a Creeps memory)

    Types added in this `global` block are in an ambient, global context. This is needed because `main.ts` is a module file (uses import or export).
    Interfaces matching on name from @types/screeps will be merged. This is how you can extend the 'built-in' interfaces from @types/screeps.
  */
  // Memory extension samples
  interface Memory {
    uuid: number;
    log: any;
  }



  // Syntax for adding proprties to `global` (ex "global.log")
  namespace NodeJS {
    interface Global {
      log: any;
      Profiler: any;
      __PROFILER_ENABLED__: boolean;
    }
  }
}

// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code

module.exports.loop = function() { //ErrorMapper.wrapLoop(() => {
  // Clear per-tick move reservations and intents so old intents don't persist across ticks
  clearMoveReservations();
  clearAllIntents();
  // console.log(`CPU used at start of loop is ${Game.cpu.getUsed()}`);

  const empire = new Empire();
  empire.init();
  empire.run();

  // If `Memory.basicMovement` is set, skip colony coordinator and let creeps
  // call their own `moveTo`/`betterMoveTo` directly (useful for debugging).
  if ((Memory as any).basicMovement === true) {
    if (Game.time % 50 === 0) console.log(`[main] basicMovement mode enabled; skipping movementCoordinator`);
  } else {
    // After colonies/creeps have published intents during their ticks,
    // resolve and execute coordinated moves.
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName]
      trafficManager.run(room)
    }
    movementCoordinator.resolveAndExecuteAll();
    movementCoordinator.flushMoveSummary();
  }

  empire.post();


  if(Game.time%20==0){
    console.log(`-----------------------------------`);
    console.log(`Current game tick is ${Game.time}`);
    console.log(`CPU used at end of loop is ${Game.cpu.getUsed()}`);
    console.log(`Current CPU bucket is ${Game.cpu.bucket}`);
    console.log(`-----------------------------------`);
  }
  // // Automatically delete memory of missing creeps
  // for (const name in Memory.creeps) {
  //   if (!(name in Game.creeps)) {
  //     delete Memory.creeps[name];
  //   }
  // }
};
