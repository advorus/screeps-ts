export class ConstructionManager {
    static placeConstructionSites(room: Room, plannedSites: {pos: RoomPosition, structureType: BuildableStructureConstant, priority: number}[]) {
        /**
         * Places construction sites in the room based on the planned sites in memory.
         * @param room The room to place construction sites in.
         * @param plannedSites The planned construction sites from memory.
         */

        // Sort by priority ascending (sites closest to the spawn are given lower priority)
        plannedSites.sort((a, b) => a.priority - b.priority);

        for (const site of plannedSites) {
            // check if the number of that type of structure in the room is equal to or less than the allowed amount
            const existingStructures = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === site.structureType });
            // also need to find existingConstructionSites of the same type
            const existingConstructionSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === site.structureType });
            const allowedAmount = CONTROLLER_STRUCTURES[site.structureType][room.controller?.level || 0];

            if (existingStructures.length + existingConstructionSites.length < allowedAmount) {
                site.pos.createConstructionSite(site.structureType);
                console.log(`Placing construction site for ${site.structureType} at ${site.pos} in room ${room.name}`);
            }

        }
    }
}
