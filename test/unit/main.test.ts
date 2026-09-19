import {assert} from "chai";
import {publishIntent, reserveMove} from "../../src/core/memory";
import { isNoopMove, shouldAdvanceCachedPath } from "../../src/core/movementCoordinator";
import {Game, Memory} from "./mock"

const { loop } = require("../../src/main");

describe("main", () => {
  before(() => {
    // runs before all test in this block
  });

  beforeEach(() => {
    // runs before each test in this block
    // @ts-ignore : allow adding Game to global
    global.Game = _.clone(Game);
    // @ts-ignore : allow adding Memory to global
    global.Memory = _.clone(Memory);
  });

  it("should export a loop function", () => {
    assert.isTrue(typeof loop === "function");
  });

  it("should return void when called with no context", () => {
    assert.isUndefined(loop());
  });

  it("Automatically delete memory of missing creeps", () => {
    Memory.creeps.persistValue = "any value";
    Memory.creeps.notPersistValue = "any value";

    Game.creeps.persistValue = "any value";

    loop();

    assert.isDefined(Memory.creeps.persistValue);
    assert.isUndefined(Memory.creeps.notPersistValue);
  });

  it("ignores same-tile move reservations and intents", () => {
    (global as any).RoomPosition = class RoomPosition {
      x: number;
      y: number;
      roomName: string;
      constructor(x: number, y: number, roomName: string) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
      }
    };

    Game.time = 42;
    Game.creeps.worker = { name: "worker", fatigue: 0 };
    (global as any).Memory = {
      ...Memory,
      moveReservations: {},
      colonies: {
        W1N1: { taskQueue: [], wallRepairThreshold: 100000, moveIntents: {} }
      }
    };

    const pos = new (global as any).RoomPosition(12, 12, "W1N1");
    reserveMove("worker", pos, pos);
    publishIntent("W1N1", "worker", pos, pos);

    assert.isUndefined((global as any).Memory.moveReservations.worker);
    assert.isUndefined((global as any).Memory.colonies.W1N1.moveIntents.worker);
  });

  it("detects no-op movement results that leave a creep on the same tile", () => {
    (global as any).RoomPosition = class RoomPosition {
      x: number;
      y: number;
      roomName: string;
      constructor(x: number, y: number, roomName: string) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
      }
    };

    const before = new (global as any).RoomPosition(10, 10, "W1N1");
    const sameTile = new (global as any).RoomPosition(10, 10, "W1N1");
    const movedTile = new (global as any).RoomPosition(10, 11, "W1N1");

    assert.isTrue(isNoopMove(before, sameTile));
    assert.isFalse(isNoopMove(before, movedTile));
  });

  it("does not advance a cached path when a move is only queued on the same tile", () => {
    (global as any).RoomPosition = class RoomPosition {
      x: number;
      y: number;
      roomName: string;
      constructor(x: number, y: number, roomName: string) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
      }
    };

    const before = new (global as any).RoomPosition(10, 10, "W1N1");
    const queuedSameTile = new (global as any).RoomPosition(10, 10, "W1N1");
    const movedTile = new (global as any).RoomPosition(10, 11, "W1N1");

    assert.isFalse(shouldAdvanceCachedPath(OK, before, queuedSameTile));
    assert.isFalse(shouldAdvanceCachedPath(OK, before, movedTile));
  });
});
