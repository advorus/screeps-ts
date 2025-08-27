import { ChildProcessWithoutNullStreams } from "child_process";
import { Colony } from "colony/colony";

export {};

type CreepRole = 'worker';

declare global {
    interface Memory {
        empire: EmpireMemory;
        colonies: {[roomName:string]:ColonyMemory};
        tasks: {[id:string]:TaskMemory};
        hostileRooms: {roomName:string, lastSeen:number}[];
        scoutedRooms: {[roomName:string]:ScoutedRoomMemory};
    }

    interface CreepMemory {
        colony?: string;
        taskId?: string;
        role?: string;
        working?: boolean;
        pathTargetX?: number;
        pathTargetY?: number;
        pathTargetRoom?: string;
        tickPathFound?: number;
        path?: RoomPosition[];
        duoPartner?: string; //this is the name of the creep which is part of the duo pair
    }

    interface ColonyMemory {
        lastPlanned?: number;
        energyHistory?: number[];
        tasks?: Record<string, any>;
        lastSeen?: number;
        spawnIds?: Id<StructureSpawn>[];
        extensionIds?: Id<StructureExtension>[];
        sourceIds?: Id<Source>[];
        fillerContainerIds?: Id<StructureContainer>[];
        upgradeContainerIds?: Id<StructureContainer>[];
        storageId?: Id<StructureStorage>;
        creepRoleCounts?: {[role:string]: number};
        taskQueue: string[];
        towerIds?: Id<StructureTower>[];
        lastStampRCL?: number;
        plannedConstructionSites?: {pos: RoomPosition, structureType: BuildableStructureConstant, priority: number}[];
        focusOnUpgrade?: boolean;
        visualisePlannedStructures?: boolean;
        creepColors?: Record<string, string>;
        wallRepairThreshold: number;
        repairTargets?: {id: string, active: boolean }[];
        haulerPartsNeeded?: number;
        remoteSources?: {id:string, active: boolean, distance: number, pos_x:number, pos_y:number, roomName: string}[];
    }

    interface EmpireMemory {
        goals?: string[];
        lastExpansion?: number;
        stats?: Record<string, any>;
        lastTick?: number;
        cpuUsage?: number[];
    }

    interface WorkerMemory extends CreepMemory {
        working?: boolean;
    }

    interface ScoutedRoomMemory {
        lastScouted: number,
        sources: string[];
        minerals: string | null;
        controller?: {
            id?: string,
            owner?: string,
            reserved?: string,
            level?: number,
            safeMode?: number
        },
        hostiles: number,
        hostileStructures: string[];
        terrainScore: number,
        exits: string[]
    }

    interface TaskMemory {
        id?: string;
        type?: 'HARVEST' | "HAUL" | "BUILD" | "UPGRADE" | "MINE" | "SCOUT" | "PICKUP" | "FILL" | "REPAIR" | "CLAIM" | "WALLREPAIR" | "DISMANTLE";
        targetId?: Id<any>;
        assignedCreep?: string;
        status?: "PENDING" | "IN_PROGRESS" | "DONE";
        colony?: string;
        priority?: number;
        role?: string;
        targetRoom?: string;
    }

    // interface GroupTaskMemory extends TaskMemory{
    //     type: `DUO_ATTACK` | `DUO_DEFEND` | `DUO_PESTER`;
    //     members: string[]; // array of creep names assigned
    //     targetRoom: string;
    //     targetPos?: RoomPosition;
    //     // objective: string;
    //     status: "PENDING" | "IN_PROGRESS" | `DONE`;
    // }

    interface Creep {
        safeMoveTo(target: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode;
    }

    type Stamp = {
        dx:number,
        dy:number,
        structureType: BuildableStructureConstant
    }[]

    interface EmpireLike {
        colonies: any[];
        memory: EmpireMemory;
        dismantleTargets: string[];
        getNearestColonyName(roomName: string): string | null;
    }

    interface ColonyLike {
        memory: ColonyMemory;
        spawns: StructureSpawn[];
        sources: Source[];
        room: Room;
        sourceContainers: StructureContainer[];
        extensions: StructureExtension[];
        upgradeContainers: StructureContainer[];
        fillerContainers: StructureContainer[];
        towers: StructureTower[];
        storage: StructureStorage | undefined;
    }
}
