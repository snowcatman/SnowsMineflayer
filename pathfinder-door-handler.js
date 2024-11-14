const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const DoorStateValidator = require('./pathfinder-door-handler-userWatch.js')

class PathfinderDoorHandler {
    constructor(bot) {
        this.bot = bot
        this.originalMovements = bot.pathfinder.movements
        this.stateValidator = new DoorStateValidator(bot)
        this.playerPassedDoors = new Map()  // Track doors players have passed through
        this.playerDoorPasses = new Map()  // Track recent player door passes
        this.doorQueries = new Map()       // Track door state queries to players
        this.recentInteractions = new Map()  // Add this line
        this.doorInteractions = new Map()  // Track door interactions with timestamps
        this.INTERACTION_COOLDOWN = 5000   // 5 second cooldown
        this.lastPathGoal = null  // Track last valid goal

        // Watch for players passing through doors
        this.bot.on('entityMove', (entity) => {
            if (entity.type === 'player') {
                const nearbyDoors = this.findNearestDoor(3)
                if (nearbyDoors) {
                    // If player passes through door position, mark it as passable
                    const doorPos = nearbyDoors.position
                    const playerPos = entity.position
                    if (this.isEntityPassingThrough(doorPos, playerPos)) {
                        console.log('Player passed through door - marking as passable')
                        this.playerPassedDoors.set(`${doorPos.x},${doorPos.y},${doorPos.z}`, {
                            timestamp: Date.now(),
                            player: entity.username
                        })
                    }
                }
            }
        })
    }

    isEntityPassingThrough(doorPos, entityPos) {
        // Check if entity is within door block bounds
        return Math.abs(entityPos.x - doorPos.x) <= 1 &&
               Math.abs(entityPos.y - doorPos.y) <= 2 &&
               Math.abs(entityPos.z - doorPos.z) <= 1
    }

    isDoorPassable(door) {
        const doorId = `${door.position.x},${door.position.y},${door.position.z}`
        
        // If we recently interacted, trust the current state
        if (this.doorInteractions.has(doorId)) {
            console.log('Door was recently interacted with, using current state')
            const state = this.getDoorState(door)
            return state && state.isOpen
        }

        // If a player passed through, consider it passable
        const playerPassed = this.playerPassedDoors.get(doorId)
        if (playerPassed && (Date.now() - playerPassed.timestamp) < 30000) {
            console.log('Player recently passed through door')
            return true
        }

        // Otherwise check current state
        const state = this.getDoorState(door)
        return state && state.isOpen
    }

    // Add this method to check if we can interact
    canInteractWithDoor(door) {
        const doorId = `${door.position.x},${door.position.y},${door.position.z}`
        const lastInteraction = this.doorInteractions.get(doorId)
        
        if (lastInteraction) {
            const timeSinceLastInteraction = Date.now() - lastInteraction
            if (timeSinceLastInteraction < this.INTERACTION_COOLDOWN) {
                console.log(`Door interaction on cooldown for ${(this.INTERACTION_COOLDOWN - timeSinceLastInteraction)/1000} more seconds`)
                return false
            }
        }
        return true
    }

    // Add this helper method to the PathfinderDoorHandler class
    toVec3(pos) {
        return pos.constructor.name === 'Vec3' ? pos : new Vec3(pos.x, pos.y, pos.z)
    }

    // Modify the inject() method to handle path positions properly
    inject() {
        const handler = this
        
        // Add goal validation to pathfinder
        const originalSetGoal = this.bot.pathfinder.setGoal
        this.bot.pathfinder.setGoal = function(goal) {
            this.lastPathGoal = handler.validateGoal(goal)
            return originalSetGoal.call(this, this.lastPathGoal)
        }

        this.bot.pathfinder.movements.getMoveForward = function(node, dir, neighbors) {
            // Convert node position to Vec3
            const nodePos = handler.toVec3(node)
            const blockC = this.getBlock(nodePos, dir.x, 0, dir.z)
            
            if (blockC.name && blockC.name.includes('door')) {
                // ONLY add as walkable if door is actually passable
                if (handler.isDoorPassable(blockC)) {
                    neighbors.push({
                        x: nodePos.x + dir.x,
                        y: nodePos.y,
                        z: nodePos.z + dir.z,
                        remainingBlocks: node.remainingBlocks,
                        cost: 1,
                        toBreak: [],
                        toPlace: []  // No interaction needed if passable
                    })
                    return
                }
                
                // Only add interaction node if door is closed and we haven't recently interacted
                if (handler.canInteractWithDoor(blockC)) {
                    // Record interaction attempt
                    const doorId = `${blockC.position.x},${blockC.position.y},${blockC.position.z}`
                    handler.doorInteractions.set(doorId, Date.now())
                    
                    neighbors.push({
                        x: nodePos.x + dir.x,
                        y: nodePos.y,
                        z: nodePos.z + dir.z,
                        remainingBlocks: node.remainingBlocks,
                        cost: 2,
                        toBreak: [],
                        toPlace: [{
                            x: nodePos.x + dir.x,
                            y: nodePos.y,
                            z: nodePos.z + dir.z,
                            dx: 0,
                            dy: 0,
                            dz: 0,
                            useOne: true
                        }]
                    })
                }
                return
            }

            return this.getBlock.call(this, nodePos, dir, neighbors)
        }.bind(this.bot.pathfinder.movements)
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

    // Add this method to PathfinderDoorHandler class
    async shouldInteractWithDoor(door) {
        const doorId = `${door.position.x},${door.position.y},${door.position.z}`
        
        // Check if a player recently passed through
        const recentPass = this.playerDoorPasses.get(doorId)
        if (recentPass && (Date.now() - recentPass.timestamp) < 5000) {  // Within last 5 seconds
            console.log(`Player ${recentPass.player} just passed through, assuming door is passable`)
            return false
        }

        // Try to physically move through first
        const canPass = await this.tryPhysicalPass(door)
        if (canPass) {
            console.log('Can physically pass through door, no interaction needed')
            return false
        }

        // If can't pass, ask player about door state
        const isOpen = await this.queryPlayerAboutDoor(door)
        if (isOpen) {
            console.log('Player confirmed door is open, investigating pathing issue')
            return false
        }

        // If all checks fail, we need to interact
        return true
    }

    async tryPhysicalPass(door) {
        // Try to move through door position
        const startPos = this.bot.entity.position.clone()
        const endPos = door.position.clone()
        
        try {
            await this.bot.pathfinder.goto(new goals.GoalNear(endPos.x, endPos.y, endPos.z, 0.5))
            return true
        } catch (err) {
            console.log('Failed to pass through door physically')
            // Return to original position
            await this.bot.pathfinder.goto(new goals.GoalNear(startPos.x, startPos.y, startPos.z, 0.5))
            return false
        }
    }

    async queryPlayerAboutDoor(door) {
        const doorId = `${door.position.x},${door.position.y},${door.position.z}`
        
        // Ask nearest player about door
        const nearestPlayer = Object.values(this.bot.players)
            .find(p => p.entity && p.entity !== this.bot.entity)
        
        if (nearestPlayer) {
            this.bot.chat(`@${nearestPlayer.username} Is this door open? (say 'yes' or 'no')`)
            
            // Wait for response
            const response = await new Promise((resolve) => {
                const handler = (username, message) => {
                    if (username === nearestPlayer.username) {
                        if (message.toLowerCase() === 'yes') resolve(true)
                        if (message.toLowerCase() === 'no') resolve(false)
                    }
                }
                
                this.bot.on('chat', handler)
                
                // Timeout after 20 seconds
                setTimeout(() => {
                    this.bot.removeListener('chat', handler)
                    resolve(null)
                }, 20000)
            })
            
            if (response === null) {
                this.bot.chat("No response received, assuming door needs checking")
            }
            return response === true
        }
        
        return false
    }

    // Door interaction handling
    async handleDoor(door) {
        try {
            const doorId = `${door.position.x},${door.position.y},${door.position.z}`
            
            // Check if we recently interacted with this door
            const lastInteraction = this.recentInteractions.get(doorId)
            if (lastInteraction && (Date.now() - lastInteraction) < 5000) {
                console.log('Recently interacted with this door, skipping')
                return true
            }

            // Only interact if door is closed and we haven't recently interacted
            if (!this.getDoorState(door).isOpen) {
                await this.bot.activateBlock(door)
                this.recentInteractions.set(doorId, Date.now())
                // Ensure path positions are Vec3
                const throughPos = this.toVec3(door.position.offset(0, 0, 1))
                await new Promise(resolve => setTimeout(resolve, 250))
                return true
            }
            
            return true
        } catch (err) {
            return false
        }
    }

    // Cleanup
    restore() {
        this.bot.pathfinder.movements = this.originalMovements
    }

    // Add this helper method
    ensureVec3Path(path) {
        return path.map(pos => this.toVec3(pos))
    }

    // Add goal validation
    validateGoal(goal) {
        if (!goal) {
            // Return a default goal if none provided
            return {
                isValid: () => true,
                hasChanged: () => false,
                heuristic: () => 0,
                isEnd: () => false,
                toString: () => 'DefaultGoal'
            }
        }

        return {
            ...goal,
            isValid: () => true,
            hasChanged: () => false,
            heuristic: (node) => typeof goal.heuristic === 'function' ? goal.heuristic(node) : 0,
            isEnd: (node) => typeof goal.isEnd === 'function' ? goal.isEnd(node) : false,
            toString: () => goal.toString ? goal.toString() : 'Goal'
        }
    }
}

module.exports = PathfinderDoorHandler 