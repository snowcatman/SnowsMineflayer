const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

class DoorPathfinder {
    constructor(bot) {
        this.bot = bot
        this.originalMovements = bot.pathfinder.movements
    }

    // Patch the pathfinder to handle doors
    injectDoorHandling() {
        const self = this
        const originalGetMoveForward = this.bot.pathfinder.movements.getMoveForward
        const originalCanWalkThrough = this.bot.pathfinder.movements.canWalkThrough

        // Add physics override for doors
        this.bot.pathfinder.movements.canWalkThrough = function(block) {
            if (block && block.name && block.name.includes('door')) {
                return true // Consider doors as walkable
            }
            return originalCanWalkThrough.call(this, block)
        }

        // Override getMoveForward to handle doors specially
        this.bot.pathfinder.movements.getMoveForward = function(node, dir, neighbors) {
            const blockC = this.getBlock(node, dir.x, 0, dir.z)
            
            // If it's a door, add it as a traversable node with interaction cost
            if (blockC.name && blockC.name.includes('door')) {
                const doorCost = 2 // Extra cost for door interaction
                neighbors.push({
                    x: node.x + dir.x,
                    y: node.y,
                    z: node.z + dir.z,
                    remainingBlocks: node.remainingBlocks,
                    cost: doorCost,
                    toBreak: [],
                    toPlace: [{
                        x: node.x + dir.x,
                        y: node.y,
                        z: node.z + dir.z,
                        dx: 0,
                        dy: 0,
                        dz: 0,
                        useOne: true // Signal this is an interaction not placement
                    }]
                })
                return
            }

            // Use original behavior for non-door blocks
            return originalGetMoveForward.call(this, node, dir, neighbors)
        }
    }

    // Restore original pathfinder behavior
    restoreOriginal() {
        this.bot.pathfinder.movements = this.originalMovements
    }

    // Check if a block is a valid door we can pass through
    isDoorPassable(block) {
        return block && 
               block.name && 
               block.name.includes('door') && 
               this.bot.pathfinder.movements.openable.has(block.type)
    }

    // Get path cost for door traversal
    getDoorPathCost(door) {
        const state = door.getProperties()
        return state.open === 'true' ? 1 : 2 // Higher cost for closed doors
    }
}

module.exports = DoorPathfinder 