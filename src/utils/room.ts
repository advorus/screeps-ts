declare global {
    interface Room {
        findExits(): string[];
    }
}

Room.prototype.findExits = function(): string[] {
    // returns an array of directions (UP, DOWN, LEFT, RIGHT) which are not blocked by walls
    const roomTerrain = this.getTerrain();
    const exits: string[] = [];

    for(let i=0;i<50;i++){
        if(roomTerrain.get(i,0) != TERRAIN_MASK_WALL){
            if(!exits.includes("UP")){
                exits.push("UP");
            }
        }
        if(roomTerrain.get(0,i) != TERRAIN_MASK_WALL){
            if(!exits.includes("LEFT")){
                exits.push("LEFT");
            }
        }
        if(roomTerrain.get(49-i,49) != TERRAIN_MASK_WALL){
            if(!exits.includes("DOWN")){
                exits.push("DOWN");
            }
        }
        if(roomTerrain.get(49,49-i) != TERRAIN_MASK_WALL){
            if(!exits.includes("RIGHT")){
                exits.push("RIGHT");
            }
        }
    }

    return exits;
}

import { getScoutedRoomMemory } from "core/memory";

export function getAdjacentConnectedRooms(room: string): string[] {
    // need visibility of the room otherwise return an empty array
    // need to check if the room has been scouted before - if it hasn't (i.e. not in scouted rooms)
    // then it will need to be in Game.rooms, otherwise we can't see what the exits are
    let exits: string[] = [];
    const scoutedMemory = getScoutedRoomMemory(room)

    if(scoutedMemory != undefined){
        exits = scoutedMemory.exits;
        // need to find the list of exits

    } else{
        // console.log(`Room ${room} has not been scouted yet, rooms with visibility ${Object.keys(Game.rooms)}`);
        // console.log(`Room ${room} is in Game.rooms: ${Object.keys(Game.rooms).includes(room)}`);
        if(!(Object.keys(Game.rooms).includes(room))) {
            return [];
        }
        exits = Game.rooms[room].findExits();
    }
    // console.log(`Room ${room} has exits: ${exits}`);

    // now we have a list of the exits - add the shifted names to the adjacentRooms []
    let adjacentRooms: string[] = [];

    for(const exit of exits){
        const [dx, dy] = getDirectionOffsets(exit);
        const adjacent_room = shifted_room_name(room, dx, dy);
        adjacentRooms.push(adjacent_room);
    }

    return adjacentRooms;
}

export function getDirectionOffsets(direction: string): [number, number] {
    switch (direction) {
        case "UP":
            return [0, 1];
        case "DOWN":
            return [0, -1];
        case "LEFT":
            return [-1, 0];
        case "RIGHT":
            return [1, 0];
        default:
            throw new Error(`Unknown direction: ${direction}`);
    }
}

export function shifted_room_name(room_name: string, x_shift: number, y_shift: number): string {
    const coord_arr = room_name.match(/[a-zA-Z]+|[0-9]+/g)
    if (coord_arr===null) throw new Error(`Couldn't parse room name ${room_name}`);
    // console.log(coord_arr);
    let x_half = coord_arr[0];
    let y_half = coord_arr[2];

    let x_number = parseInt(coord_arr[1]);
    if(x_half == "E") {
        x_number+=x_shift;
        if(x_number <=1) {
            x_number = x_number * -1;
            x_number+=1;
            x_half = "W";
        }
    } else if(x_half == "W"){
        x_number-=x_shift;
        if(x_number <=1) {
            x_number = x_number * -1;
            x_number+=1;
            x_half = "E";
        }
    } else {
        console.log("Couldn't identify the X room half in "+room_name)
    }

    let y_number = parseInt(coord_arr[3]);
    if(y_half == "N") {
        y_number+=y_shift;
        if(y_number <=1) {
            y_number = y_number * -1;
            y_number+=1;
            y_half = "W";
        }
    } else if(y_half == "S"){
        y_number-=y_shift;
        if(y_number <=1) {
            y_number = y_number * -1;
            y_number+=1;
            y_half = "E";
        }
    } else {
        console.log("Couldn't identify the Y room half in "+room_name)
    }

    // y_number =

    return x_half+x_number.toString()+y_half+y_number.toString();
}

// export function get_surrounding_rooms(room_name: string) {
//     let adjacent_rooms: string[] = [];

//     for (let i=-1;i<=1;i++){
//         for(let j=-1;j<=1;j++){
//             if(i==0 && j==0){
//                 continue;
//             }
//             // console.log(central_room_name);
//             adjacent_rooms.push(shifted_room_name(room_name,i,j));
//         }
//     }

//     return adjacent_rooms;
// }
