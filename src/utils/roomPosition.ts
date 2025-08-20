export {};

declare global {
    interface RoomPosition {
        getFreeTiles(): RoomPosition[];
    }
}

RoomPosition.prototype.getFreeTiles = function(): RoomPosition[] {
    // Get all tiles around the current position (3x3 grid)
    // and filter out walls and the center tile

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
