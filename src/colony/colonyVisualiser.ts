import { getAllTaskMemory } from "core/memory";
import { Colony } from "./colony";
import {profile} from "Profiler";

@profile
export class ColonyVisualizer {
    colony: Colony;

    constructor(colony: Colony){
        this.colony = colony;
    }

    init() {

    }

    run() {
        const visual = new RoomVisual(this.colony.room.name);
        visual.text(`Colony: ${this.colony.room.name}, RCL: ${this.colony.room.controller?.level}`, 1, 1,
            {
                align: 'left',
                color: 'white',
                font: 'bold 2px Arial'
            }
        );
        // show energy available/energy capacity
        visual.text(`Energy: ${this.colony.room.energyAvailable}/${this.colony.room.energyCapacityAvailable}`, 1, 3,
            {
                align: 'left',
                color: 'white',
                font: 'bold 2px Arial'
            }
        );

        // show the number of creeps doing each role
        const roleCounts = this.colony.creeps.reduce((counts: Record<string, number>, creep: Creep) => {
            const role = creep.memory.role;
            if (!role) return counts; // Skip if no role is defined
            counts[role] = (counts[role] || 0) + 1;
            return counts;
        }, {});

        let y = 5;
        for (const [role, count] of Object.entries(roleCounts)) {
            visual.text(`${role}: ${count}`, 1, y,
                {
                    align: 'left',
                    color: 'white',
                    font: 'bold 2px Arial'
                }
            );
            y++;
        }

        //show the number of active tasks of each type in this colony
        const tasks = getAllTaskMemory().filter(task => task.colony === this.colony.room.name);
        const taskCounts = tasks.reduce((counts: Record<string, number>, task: TaskMemory) => {
            const type = task.type;
            if (type === undefined) return counts; // Skip if no type is defined
            counts[type] = (counts[type] || 0) + 1;
            return counts;
        }, {});

        // show the location, type and target of the 5 highest priority tasks
        const highestPriorityTasks = tasks
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .slice(0, 5);

        y = 7;
        for (const task of highestPriorityTasks) {
            visual.text(`${task.type} with priority ${task.priority} and target ${task.targetId}, status: ${task.status}, assigned to ${task.assignedCreep}`, 1, y,
                {
                    align: 'left',
                    color: 'white',
                    font: 'bold 2px Arial'
                }
            );
            y++;
        }

        y+=2;

        // show the counts of each type of task
        for (const [type, count] of Object.entries(taskCounts)) {
            visual.text(`${type}: ${count}`, 1, y,
                {
                    align: 'left',
                    color: 'white',
                    font: 'bold 2px Arial'
                }
            );
            y++;
        }

        //circle the upgrade container in orange
        for(const container of this.colony.upgradeContainers) {
            visual.circle(container.pos, {radius: 0.5, fill: 'orange'});
        }

        //circle the filler containers in blue
        for(const container of this.colony.fillerContainers) {
            visual.circle(container.pos, {radius: 0.5, fill: 'blue'});
        }

        //circle the storage containers in green
        for(const container of this.colony.sourceContainers) {
            visual.circle(container.pos, {radius: 0.5, fill: 'green'});
        }
    }
}

