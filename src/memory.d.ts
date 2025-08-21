import { Colony } from "colony/colony";

export {};

type CreepRole = 'worker';

declare global {
    interface Memory {
        empire: EmpireMemory;
        colonies: {[roomName:string]:ColonyMemory};
        tasks: {[id:string]:TaskMemory};
    }

    interface CreepMemory {
        colony?: string;
        taskId?: string;
        role?: string;
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

    }

    interface EmpireMemory {
        goals?: string[];
        lastExpansion?: number;
        stats?: Record<string, any>;
        lastTick?: number;
    }

    interface WorkerMemory extends CreepMemory {
        working?: boolean;
    }

    interface TaskMemory {
        id?: string;
        type?: 'HARVEST' | "HAUL" | "BUILD" | "UPGRADE" | "MINE" | "SCOUT" | "PICKUP" | "FILL";
        targetId?: Id<any>;
        assignedCreep?: string;
        status?: "PENDING" | "IN_PROGRESS" | "DONE";
        colony?: string;
        priority?: number;
        role?: string;
    }

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
    }
}
