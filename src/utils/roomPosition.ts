import { getColonyMemory } from "core/memory";

export {};

declare global {
    interface RoomPosition {
        getFreeTiles(): RoomPosition[];
        findNearestOpenTile(maxRange?: number, minOpenAdjacent?: number, excludeConstructionSites?: boolean, excludeStructures?: boolean): RoomPosition | null;
        findNearestValidStampLocation(stamp: {dx:number, dy:number, structureType: BuildableStructureConstant}[]): RoomPosition | null;
        canPlaceStamp(stamp: Stamp) : boolean;
        isInsideRoom(): boolean;

    }
}

RoomPosition.prototype.getFreeTiles = function(): RoomPosition[] {
    /**
     * find surrounding tiles in a 3x3 grid which are not occupied by a wall, and are not the center tile
     */

    const freeTiles: RoomPosition[] = [];
    for (let x = this.x - 1; x <= this.x + 1; x++) {
        for (let y = this.y - 1; y <= this.y + 1; y++) {
            //check if the tile is within the room bounds
            if (x < 0 || x >= 50 || y < 0 || y >= 50) continue; // Skip out-of-bounds tiles
            if (x === this.x && y === this.y) continue; // Skip the center tile
            const pos = new RoomPosition(x, y, this.roomName);
            if (pos.lookFor(LOOK_TERRAIN)[0] !== 'wall') {
                freeTiles.push(pos);
            }
        }
    }
    return freeTiles;
}

RoomPosition.prototype.findNearestOpenTile = function(
    maxRange: number = 5,
    minOpenAdjacent: number = 0,
    excludeConstructionSites: boolean = false,
    excludeStructures: boolean = true
): RoomPosition | null {
    /**
     * Performs a spiral outwards search and returns a tile which is not a wall and has enough adjacent open tiles, otherwise null.
     * @param maxRange The maximum range to search from the center.
     * @param minOpenAdjacent The minimum number of adjacent open tiles required.
     * @param excludeConstructionSites Whether to exclude construction sites as available tiles from the search.
     * @param excludeStructures Whether to exclude structures as available tiles from the search.
     */

    for(let range=1;range<=maxRange;range++){
        for (let dx=-range;dx<=range;dx++){
            for(let dy=-range;dy<=range;dy++){
                if(Math.abs(dx)!==range&&Math.abs(dy)!==range) continue; // Only check the outer ring of the square
                const pos = new RoomPosition(this.x + dx, this.y + dy, this.roomName);
                if(pos.lookFor(LOOK_TERRAIN)[0] === 'wall') continue; // Skip walls
                if(excludeConstructionSites){
                    if(pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) continue; // Skip if there are construction sites
                }
                if(excludeStructures){
                    if(pos.lookFor(LOOK_STRUCTURES).length > 0) continue; // Skip if there are structures
                }
                let adjacentTiles = pos.getFreeTiles();
                if(excludeConstructionSites){
                    adjacentTiles = adjacentTiles.filter(tile => tile.lookFor(LOOK_CONSTRUCTION_SITES).length === 0);
                }
                if(excludeStructures){
                    adjacentTiles = adjacentTiles.filter(tile => tile.lookFor(LOOK_STRUCTURES).length === 0);
                }
                if(adjacentTiles.length < minOpenAdjacent) continue; // Skip if not enough adjacent open tiles
                return pos;
            }
        }
    }
    return null;
}

RoomPosition.prototype.findNearestValidStampLocation = function(stamp: {dx:number, dy:number, structureType: BuildableStructureConstant}[]): RoomPosition | null {
    /**
     *  Finds the nearest clear spot for the given stamp to this room position, spiralling outwards for search. Will go up to a radius of 50 (to cover the whole room)
     *  Returns null if none found
     */

    const maxRadius = 50;

    for(let r=0;r<maxRadius;r++){
        for(let i=-r;i<=r;i++){
            for(let j=-r;j<=r;j++){
                if(i!!==r && j!== r) continue;
                const positionToCheck = new RoomPosition(this.x+i, this.y+j, this.roomName);
                if(positionToCheck.isInsideRoom()){
                    if(positionToCheck.canPlaceStamp(stamp)){
                        return positionToCheck;
                    }
                }
            }
        }
    }

    return null;
}

RoomPosition.prototype.isInsideRoom = function(): boolean {
    /**
     * Checks that the x and y positions are inside the room
     */
    return true;
}

RoomPosition.prototype.canPlaceStamp = function(stamp: Stamp): boolean {
    /**
     * Checks if the given stamp can be placed at this room position.
     */
    // console.log(`Checking if can place stamp at ${this.x}, ${this.y}`);
    for (const {dx, dy, structureType} of stamp) {
        const pos = new RoomPosition(this.x + dx, this.y + dy, this.roomName);
        if (pos.lookFor(LOOK_TERRAIN)[0] === "wall") return false; // Can't place on walls
        // need to check whether the construction sites/structures match those in the stamp, rather than just checking for their existence
        const nonMatchingConstructionSites = pos.lookFor(LOOK_CONSTRUCTION_SITES).filter(s=>s.structureType!==structureType);
        const nonMatchingStructures = pos.lookFor(LOOK_STRUCTURES).filter(s=>s.structureType!==structureType);
        if (nonMatchingConstructionSites.length>0) return false;
        if (nonMatchingStructures.length>0) return false;

        const colonyMemory = getColonyMemory(this.roomName);
        if(colonyMemory !== undefined)
        {
            const plannedSitesAtLocation = colonyMemory.plannedConstructionSites?.filter(s=> s.structureType !== structureType && s.pos.x == pos.x && s.pos.y == pos.y);
            if(plannedSitesAtLocation?.length || -1 > 0 ) return false;

            // for(const site of plannedConstructionSites? plannedConstructionSites: []) {
            //     // check to see if the structuretype of the site matches the stamp
            //     if(site.structureType == STRUCTURE_TOWER){
            //         console.log(`Found planned tower at ${this.x}, ${this.y}`);
            //     }
            //     if (site.structureType !== structureType){
            //         // If the structure type doesn't match, we can't place the stamp
            //         // if(pos.x == 32){
            //         //     console.log(`Can't place stamp at ${this.x}, ${this.y} because of planned site ${site.structureType} at ${site.pos}`);
            //         // }
            //         return false;
            //     }

            // }
        }
    }
    return true;
}
