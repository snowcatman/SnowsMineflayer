const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const DoorStateValidator = require('./pathfinder-door-handler-userWatch.js')

// Add these constants at the top
const MAX_DOOR_ATTEMPTS = 3
const DOOR_STATE = {
    attempts: new Map(),  // Track attempts per door
    playerPassed: new Map(),  // Track if player passed through
    lastInteraction: new Map()  // Track last interaction time
}

// Update timing constants to use ticks
const INTERACTION_DELAYS = {
    DOOR_COOLDOWN: 20 * 5,    // 5 seconds in ticks (was 5000ms)
    PLAYER_MEMORY: 20 * 30,   // 30 seconds in ticks (was 30000ms)
    ATTEMPT_DELAY: 20         // 1 second in ticks (was 1000ms)
}

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
        this.pathBlocked = new Map()  // Add this to track blocked paths

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
        
        // First priority: Has a player recently passed through?
        const playerPassed = this.playerPassedDoors.get(doorId)
        if (playerPassed && (Date.now() - playerPassed.timestamp) < 30000) {
            console.log('Player recently passed through door - should be passable')
            return true
        }

        // Second priority: Try to physically pass through
        const canPhysicallyPass = this.bot.entity.position.distanceTo(door.position) < 2 && 
                                 !this.bot.entity.isCollidedHorizontally
        if (canPhysicallyPass) {
            console.log('Can physically pass through door')
            return true
        }

        // Last resort: Check door state
        const state = this.getDoorState(door)
        if (state && state.isOpen) {
            console.log('Door is open by state')
            return true
        }

        console.log('Door is not passable - needs interaction')
        return false
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

    // Modify the inject() method to properly handle door states
    inject() {
        const handler = this
        
        // Override the movement's walkability check
        const originalCanWalkThrough = this.bot.pathfinder.movements.canWalkThrough
        this.bot.pathfinder.movements.canWalkThrough = function(block) {
            if (block && block.name && block.name.includes('door')) {
                // If a player passed through OR door is open, space is walkable
                const doorId = `${block.position.x},${block.position.y},${block.position.z}`
                const playerPassed = handler.playerPassedDoors.get(doorId)
                
                if (playerPassed && (Date.now() - playerPassed.timestamp) < 30000) {
                    console.log('Space is walkable - player recently passed')
                    return true
                }
                
                // Check door state
                const state = handler.getDoorState(block)
                if (state && state.isOpen) {
                    console.log('Space is walkable - door is open')
                    return true
                }
            }
            return originalCanWalkThrough.call(this, block)
        }

        this.bot.pathfinder.movements.getMoveForward = function(node, dir, neighbors) {
            const blockC = this.getBlock(node, dir.x, 0, dir.z)
            
            if (blockC.name && blockC.name.includes('door')) {
                const doorId = `${blockC.position.x},${blockC.position.y},${blockC.position.z}`
                const attempts = DOOR_STATE.attempts.get(doorId) || 0
                
                // Check attempt limit before adding to path
                if (attempts >= MAX_DOOR_ATTEMPTS) {
                    console.log(`Maximum attempts (${MAX_DOOR_ATTEMPTS}) reached for door at ${doorId}`)
                    return  // Don't add to path
                }
                
                // Rest of door handling...
                if (handler.canInteractWithDoor(blockC)) {
                    console.log(`Door attempt ${attempts + 1}/${MAX_DOOR_ATTEMPTS}`)
                    DOOR_STATE.attempts.set(doorId, attempts + 1)
                    neighbors.push({
                        x: node.x + dir.x,
                        y: node.y,
                        z: node.z + dir.z,
                        remainingBlocks: node.remainingBlocks,
                        cost: 2,
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
                }
            }
            
            return this.getBlock.call(this, node, dir, neighbors)
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
            const state = this.getDoorState(door)
            
            // Communicate door state first
            this.bot.chat(`I see a ${state.isOpen ? 'open' : 'closed'} door`)
            await new Promise(resolve => setTimeout(resolve, 1000))  // Wait 1 second
            
            // Check attempt count
            const attempts = DOOR_STATE.attempts.get(doorId) || 0
            if (attempts >= MAX_DOOR_ATTEMPTS) {
                this.bot.chat("I've tried this door several times. I can't get through.")
                return false
            }

            // Try to move through first if door is open
            if (state.isOpen) {
                this.bot.chat("The door is open, trying to walk through...")
                await new Promise(resolve => setTimeout(resolve, 1000))
                
                // Try to physically move through
                const canPass = await this.tryPhysicalPass(door)
                if (!canPass) {
                    this.bot.chat("Something is blocking me from walking through the open door")
                    return false
                }
                return true
            }

            // Door interaction logic
            DOOR_STATE.attempts.set(doorId, attempts + 1)
            this.bot.chat(`Attempting to open the door (try ${attempts + 1}/${MAX_DOOR_ATTEMPTS})`)
            await new Promise(resolve => setTimeout(resolve, 1000))
            
            await this.bot.activateBlock(door)
            await new Promise(resolve => setTimeout(resolve, 20 * 50))  // Wait 20 ticks
            
            return true
        } catch (err) {
            this.bot.chat("I had trouble with the door")
            return false
        }
    }

    // Add this method to check physical movement
    async tryPhysicalPass(door) {
        // Get positions
        const startPos = this.bot.entity.position.clone()
        const doorPos = door.position.clone()
        const direction = this.getDoorDirection(door)
        
        // Calculate position on other side of door
        const targetPos = doorPos.offset(direction.x, 0, direction.z)
        
        try {
            // Try to move to the other side
            await this.bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1))
            return true
        } catch (err) {
            console.log('Failed to pass through door:', err.message)
            return false
        }
    }

    // Add helper to get door direction
    getDoorDirection(door) {
        const state = this.getDoorState(door)
        switch(state.facing) {
            case 'north': return new Vec3(0, 0, -1)
            case 'south': return new Vec3(0, 0, 1)
            case 'east': return new Vec3(1, 0, 0)
            case 'west': return new Vec3(-1, 0, 0)
            default: return new Vec3(0, 0, 0)
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

    // Add this method to PathfinderDoorHandler class
    wrapPathfinderGoal() {
        const originalSetGoal = this.bot.pathfinder.setGoal.bind(this.bot.pathfinder)
        const Vec3 = require('vec3')  // Make sure Vec3 is available

        // Wrap the setGoal to ensure all positions are Vec3
        this.bot.pathfinder.setGoal = (goal) => {
            if (goal && goal.path) {
                // Convert all path positions to Vec3
                goal.path = goal.path.map(pos => {
                    if (!pos.minus || typeof pos.minus !== 'function') {
                        return new Vec3(pos.x, pos.y, pos.z)
                    }
                    return pos
                })
            }
            return originalSetGoal(goal)
        }
    }

    // Add this method to ensure path points are always Vec3
    ensurePathFormat(path) {
        if (!path) return path
        return path.map(point => {
            // If it's already a Vec3 with minus function, return as is
            if (point && typeof point.minus === 'function') return point
            
            // If it's our custom path point, convert to Vec3
            if (point && typeof point.x === 'number') {
                return new Vec3(point.x, point.y, point.z)
            }
            
            // If it's something else entirely, log and return null
            console.log('Unexpected path point format:', point)
            return null
        }).filter(point => point !== null)
    }

    // Add method to track player door passages
    onPlayerNearDoor(player, door) {
        const doorId = `${door.position.x},${door.position.y},${door.position.z}`
        DOOR_STATE.playerPassed.set(doorId, {
            timestamp: Date.now(),
            player: player.username
        })
        console.log(`Tracked player ${player.username} passing through door at ${doorId}`)
    }

    // Add this method to PathfinderDoorHandler class
    async handleDoorPathfinding(door) {
        try {
            const doorId = `${door.position.x},${door.position.y},${door.position.z}`
            
            // Check if this path is already blocked
            if (this.pathBlocked.get(doorId)) {
                console.log('Path through this door is blocked - waiting for new command')
                this.bot.pathfinder.setGoal(null)  // Clear the goal
                this.bot.pathfinder.stop()
                this.bot.chat("I need help with this door. Please give me a new command.")
                return false
            }

            // Check attempt limit
            const attempts = DOOR_STATE.attempts.get(doorId) || 0
            if (attempts >= MAX_DOOR_ATTEMPTS) {
                console.log(`Maximum attempts (${MAX_DOOR_ATTEMPTS}) reached - stopping pathfinding`)
                this.bot.chat("I can't get through this door after several attempts. Please help!")
                this.bot.pathfinder.setGoal(null)  // Clear the goal
                this.bot.pathfinder.stop()
                this.pathBlocked.set(doorId, true)
                DOOR_STATE.attempts.clear()
                return false
            }

            // Try to handle the door
            const success = await this.handleDoor(door)
            return success

        } catch (err) {
            console.log('Door pathfinding error:', err.message)
            this.bot.pathfinder.setGoal(null)  // Clear the goal
            this.bot.pathfinder.stop()
            return false
        }
    }
}

module.exports = PathfinderDoorHandler 