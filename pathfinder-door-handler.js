const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

class PathfinderDoorHandler {
    constructor(bot) {
        this.bot = bot
        this.originalMovements = bot.pathfinder.movements
    }

    // Initialize and inject door handling
    inject() {
        // Store original functions for patching
        const originalGetMoveForward = this.bot.pathfinder.movements.getMoveForward
        const originalCanWalkThrough = this.bot.pathfinder.movements.canWalkThrough

        // Patch physics to handle doors
        this.bot.pathfinder.movements.canWalkThrough = (block) => {
            if (this.isDoor(block)) return true
            return originalCanWalkThrough.call(this.bot.pathfinder.movements, block)
        }

        // Patch pathfinding to handle doors
        this.bot.pathfinder.movements.getMoveForward = function(node, dir, neighbors) {
            const blockC = this.getBlock(node, dir.x, 0, dir.z)
            
            if (blockC.name && blockC.name.includes('door')) {
                const doorCost = blockC.getProperties().open === 'true' ? 1 : 2
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
                        useOne: true
                    }]
                })
                return
            }

            return originalGetMoveForward.call(this, node, dir, neighbors)
        }

        // Add door handling to path updates
        this.bot.on('path_update', async (results) => {
            if (results.status === 'noPath') {
                const door = this.findNearestDoor()
                if (door && !this.getDoorState(door).isOpen) {
                    await this.handleDoor(door)
                    if (results.path.length > 0) {
                        this.bot.pathfinder.setGoal(results.path[results.path.length - 1])
                    }
                }
            }
        })
    }

    // Core door utilities
    isDoor(block) {
        return block && block.name && block.name.toLowerCase().includes('door')
    }

    getDoorState(door) {
        if (!door) return null
        const props = door.getProperties()
        return {
            isOpen: props.open === 'true',
            facing: props.facing,
            half: props.half,
            hinge: props.hinge,
            powered: props.powered === 'true'
        }
    }

    findNearestDoor(maxDistance = 5) {
        const doors = this.bot.findBlocks({
            matching: block => this.isDoor(block),
            maxDistance,
            count: 1
        })
        return doors.length > 0 ? this.bot.blockAt(doors[0]) : null
    }

    // Door interaction handling
    getApproachPosition(door, targetPos) {
        const props = door.getProperties()
        const pos = door.position
        const botPos = this.bot.entity.position

        // Calculate which side of door to approach from
        const isTargetBeyondDoor = (props.facing === 'east' && targetPos.x > pos.x) ||
                                  (props.facing === 'west' && targetPos.x < pos.x) ||
                                  (props.facing === 'north' && targetPos.z < pos.z) ||
                                  (props.facing === 'south' && targetPos.z > pos.z)

        const isBotBeyondDoor = (props.facing === 'east' && botPos.x > pos.x) ||
                               (props.facing === 'west' && botPos.x < pos.x) ||
                               (props.facing === 'north' && botPos.z < pos.z) ||
                               (props.facing === 'south' && botPos.z > pos.z)

        const offset = isBotBeyondDoor === isTargetBeyondDoor ? 2 : -2

        switch(props.facing) {
            case 'north': return new Vec3(pos.x, pos.y, pos.z + offset)
            case 'south': return new Vec3(pos.x, pos.y, pos.z - offset)
            case 'east': return new Vec3(pos.x - offset, pos.y, pos.z)
            case 'west': return new Vec3(pos.x + offset, pos.y, pos.z)
            default: return null
        }
    }

    async handleDoor(door) {
        try {
            const initialState = this.getDoorState(door)
            if (!initialState.isOpen) {
                await this.bot.activateBlock(door)
                
                // Wait for door state to actually change
                const maxAttempts = 10
                let attempts = 0
                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100))
                    const newState = this.getDoorState(door)
                    if (newState.isOpen !== initialState.isOpen) {
                        // Door state has changed, we can proceed
                        return true
                    }
                    attempts++
                }
                
                // If we get here, door state didn't change
                return false
            }
            return true // Door was already open
        } catch (err) {
            return false
        }
    }

    // Cleanup
    restore() {
        this.bot.pathfinder.movements = this.originalMovements
    }
}

module.exports = PathfinderDoorHandler 