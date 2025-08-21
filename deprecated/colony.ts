    // createTasks() {
    //     //here we create the tasks to mine, upgrade and haul
    //     for(const source of this.sources){
    //         // get the free tiles around a source and create a harvest task for each one
    //         const freeTiles = source.pos.getFreeTiles();
    //         for(const tile of freeTiles) {
    //             const existingHarvestTasks = Object.values(Memory.tasks).filter(task =>
    //                 task.type === 'HARVEST' &&
    //                 task.targetId === source.id &&
    //                 task.colony === this.room.name &&
    //                 task.status !== 'DONE'
    //             );
    //             if (existingHarvestTasks.length >= freeTiles.length) continue; // Skip if there's already a harvest task for this source
    //             TaskManager.createTask(`HARVEST`, source, this.room.name);
    //         }
    //     }

    //     let existingUpgradeTasks = Object.values(Memory.tasks).filter(task =>
    //         task.type === 'UPGRADE' &&
    //         task.colony === this.room.name &&
    //         task.status !== 'DONE'
    //     ).length;

    //     if (!(existingUpgradeTasks > 5)){ // Skip if there's already an upgrade task for this colony
    //         TaskManager.createTask(`UPGRADE`, this.room.controller as StructureController, this.room.name);
    //         existingUpgradeTasks++;
    //     }

    //     // create some low priority upgrade tasks to fall back on
    //     while (existingUpgradeTasks < 5) {
    //         TaskManager.createTask(`UPGRADE`, this.room.controller as StructureController, this.room.name, -1);
    //         existingUpgradeTasks++;
    //     }

    //     // create a haul task for each spawn
    //     for(const spawn of this.spawns) {
    //         const existingHaulTasks = Object.values(Memory.tasks).filter(task =>
    //             task.type === 'HAUL' &&
    //             task.targetId === spawn.id &&
    //             task.colony === this.room.name &&
    //             task.status !== 'DONE'
    //         );
    //         if (existingHaulTasks.length >= 1) continue; // Skip if there's already a haul task for this spawn
    //         TaskManager.createTask(`HAUL`, spawn, this.room.name, 10); // Priority 10 for hauling to spawn
    //     }

    //     this.createBuildingTasks();
    // }

    // createBuildingTasks() : void {
    //     const construction_sites = this.room.find(FIND_CONSTRUCTION_SITES);

    //     for (const site of construction_sites) {
    //         const existingBuildTasks = Object.values(Memory.tasks).filter(task =>
    //             task.type === 'BUILD' &&
    //             task.targetId == site.id &&
    //             task.colony === this.room.name &&
    //             task.status !== 'DONE'
    //         );
    //         if (existingBuildTasks.length >= 1) continue; // Skip if there's already a build task for this site

    //         let priority = TaskManager.getBuildPriority(site);
    //         // Check if there is an existing build task of the same type in the colony
    //         const existingBuildTaskOfType = Object.values(Memory.tasks).find(task => {
    //             if (!task.targetId) return false;
    //             else return task.type === 'BUILD' &&
    //             task.colony === this.room.name &&
    //             task.status !== 'DONE' &&
    //             Game.getObjectById(task.targetId)?.structureType === site.structureType;
    //         });
    //         // If there is not one, increase the priority
    //         if (!existingBuildTaskOfType) {
    //             priority += 1;
    //         }
    //         console.log(`Creating build task for ${site.id} in colony ${this.room.name} with priority ${priority}`);
    //         TaskManager.createTask(`BUILD`, site, this.room.name, priority);
    //     }
    // }
