// Import required libraries for bot functionality
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')                // For 3D position calculations
const fs = require('fs')                    // For file operations
const path = require('path')                // For path handling

// Add pathfinding constants
const PATHFINDING_CONSTANTS = {
    DOOR_APPROACH_DISTANCE: 3,
    DOOR_CLEARANCE_DISTANCE: 2,
    RESUME_DELAY: 500,
    TICK_LENGTH: 50
}

// Add door movement overrides
const DOOR_MOVEMENT_OVERRIDES = {
    allowDoorBreaking: false,
    doorInteractionRange: 3,
    doorApproachDistance: 2,
    pathRetryDelay: 250
}

// Add position tracking constants
const POSITION_TRACKING = {
    MAX_POSITIONS: 10,          // Maximum number of positions to keep
    MIN_DISTANCE: 0.5,          // Minimum distance between recorded positions
    CLEANUP_DISTANCE: 3         // Distance after which old positions are cleared
}

// Add door tracking system at the top after imports
const DoorRegistry = {
    doors: new Map(),
    sessionId: Date.now(), // Unique session identifier

    // Add path memory
    pathMemory: new Map(),

    lastPlayerDoorPass: new Map(), // Track when players last passed through doors

    registerDoor(door) {
        const doorId = this.generateDoorId(door)
        const doorInfo = {
            id: doorId,
            position: door.position.clone(),
            type: door.name,
            label: this.generateLabel(door),
            lastChecked: Date.now(),
            state: {
                exists: true,
                isOpen: door.getProperties().open === 'true',
                lastInteraction: null,
                interactionCount: 0
            }
        }
        this.doors.set(doorId, doorInfo)
        logToFile(`Registered door: ${JSON.stringify(doorInfo)}`, 'REGISTRY')
        return doorInfo
    },

    generateDoorId(door) {
        return `door_${door.position.x}_${door.position.y}_${door.position.z}`
    },

    generateLabel(door) {
        const cardinal = this.getCardinalDirection(door.getProperties().facing)
        const location = this.getRelativeLocation(door.position)
        return `${door.name.replace('_', ' ')} (${cardinal} facing) ${location}`
    },

    getCardinalDirection(facing) {
        const directions = {
            north: 'North',
            south: 'South',
            east: 'East',
            west: 'West'
        }
        return directions[facing] || 'Unknown'
    },

    getRelativeLocation(pos) {
        // Create a simple coordinate-based location description
        return `at (${pos.x}, ${pos.y}, ${pos.z})`
    },

    getDoor(doorId) {
        return this.doors.get(doorId)
    },

    updateDoorState(doorId, door) {
        const doorInfo = this.doors.get(doorId)
        if (doorInfo) {
            doorInfo.lastChecked = Date.now()
            doorInfo.state.isOpen = door.getProperties().open === 'true'
            doorInfo.state.exists = true
            logToFile(`Updated door state: ${JSON.stringify(doorInfo)}`, 'REGISTRY')
        }
    },

    getNearbyDoors(position, maxDistance = 50) {
        const nearbyDoors = []
        this.doors.forEach(doorInfo => {
            const distance = position.distanceTo(doorInfo.position)
            if (distance <= maxDistance) {
                nearbyDoors.push({
                    ...doorInfo,
                    distance
                })
            }
        })
        return nearbyDoors.sort((a, b) => a.distance - b.distance)
    },

    clearSession() {
        this.doors.clear()
        this.sessionId = Date.now()
        logToFile('Door registry cleared for new session', 'REGISTRY')
    },

    validateDoorPath(door, targetDoor) {
        if (!door || !targetDoor) return false
        
        const isSameDoor = this.generateDoorId(door) === this.generateDoorId(targetDoor)
        logToFile(`Door path validation:
            Current door: ${door ? this.generateLabel(door) : 'none'}
            Target door: ${targetDoor ? this.generateLabel(targetDoor) : 'none'}
            Match: ${isSameDoor}`, 'PATHFINDING')
        
        return isSameDoor
    },

    trackDoorState(door) {
        const doorId = this.generateDoorId(door)
        const doorInfo = this.getDoor(doorId)
        const currentState = door.getProperties()
        
        if (doorInfo) {
            const previousState = doorInfo.state.isOpen
            const stateChanged = previousState !== (currentState.open === 'true')
            
            if (stateChanged) {
                logToFile(`Door state changed:
                    Door: ${doorInfo.label}
                    Previous: ${previousState ? 'open' : 'closed'}
                    Current: ${currentState.open === 'true' ? 'open' : 'closed'}`, 'STATE')
            }
            
            this.updateDoorState(doorId, door)
        }
        
        return {
            id: doorId,
            info: doorInfo,
            currentState: currentState
        }
    },

    trackPathfindingTime(doorId, startTime) {
        const doorInfo = this.getDoor(doorId)
        if (doorInfo) {
            const duration = Date.now() - startTime
            logToFile(`Pathfinding duration for ${doorInfo.label}: ${duration}ms`, 'TIMING')
            return duration
        }
        return 0
    },

    storePath(doorId, originalGoal) {
        this.pathMemory.set(doorId, {
            goal: originalGoal,
            timestamp: Date.now()
        })
        logToFile(`Stored pathfinding goal for door ${doorId}`, 'PATHFINDING')
    },

    getStoredPath(doorId) {
        return this.pathMemory.get(doorId)
    },

    clearPath(doorId) {
        this.pathMemory.delete(doorId)
        logToFile(`Cleared pathfinding memory for door ${doorId}`, 'PATHFINDING')
    },

    trackPlayerDoorPass(player, door) {
        const doorId = this.generateDoorId(door)
        const doorInfo = this.getDoor(doorId) || this.registerDoor(door)
        
        // Force update door state to "open" when player passes through
        doorInfo.state.isOpen = true  // Force state to open
        doorInfo.state.lastInteraction = Date.now()
        
        this.lastPlayerDoorPass.set(doorId, {
            timestamp: Date.now(),
            playerName: player.username,
            assumedOpen: true,
            forcedOpen: true  // Flag to indicate we forced the state
        })
        
        logToFile(`Player ${player.username} passed through door at ${door.position}:
            Forced door state to open
            Actual door state: ${door.getProperties().open}
            Door ID: ${doorId}`, 'DETECTION')
    },

    isDoorLikelyOpen(door) {
        const doorId = this.generateDoorId(door)
        const lastPass = this.lastPlayerDoorPass.get(doorId)
        
        // If player recently passed through, consider door open regardless of actual state
        if (lastPass && lastPass.forcedOpen && (Date.now() - lastPass.timestamp) < 5000) {
            logToFile(`Door ${doorId} was recently passed through by ${lastPass.playerName}, forcing open state`, 'STATE')
            return true
        }
        
        // Fall back to actual state
        const currentState = door.getProperties()
        return currentState.open === 'true'
    }
}

// Add this near the top of the file after imports
const defaultInteractables = require(path.join(__dirname, 'node_modules/mineflayer-pathfinder/lib/interactable.json'))

// Add position tracking system
const PositionTracker = {
    positions: [],
    lastPosition: null,

    addPosition(position) {
        // Only add if it's significantly different from last position
        if (!this.lastPosition || position.distanceTo(this.lastPosition) > POSITION_TRACKING.MIN_DISTANCE) {
            this.positions.push({
                position: position.clone(),
                timestamp: Date.now()
            })
            this.lastPosition = position.clone()
            
            // Keep array size in check
            if (this.positions.length > POSITION_TRACKING.MAX_POSITIONS) {
                this.positions.shift()
            }
        }
    },

    clearPositions() {
        this.positions = []
        this.lastPosition = null
        logToFile('Position tracking cleared', 'MOVEMENT')
    },

    cleanupOldPositions(currentPosition) {
        // Remove positions that are too far behind
        this.positions = this.positions.filter(pos => {
            const distance = currentPosition.distanceTo(pos.position)
            return distance <= POSITION_TRACKING.CLEANUP_DISTANCE
        })
    },

    getRecentPositions() {
        return this.positions
    }
}

// Add at top of file after other requires
const PathfinderDoorHandler = require('./pathfinder-door-handler.js')

// Modify the inject function to handle door registration
function inject(bot) {
    // Single door handler instance
    const doorHandler = new PathfinderDoorHandler(bot)

    bot.once('spawn', () => {
        // Configure movements
        const movements = new Movements(bot)
        
        // Add ALL door types to interactables and openable sets
        const doorTypes = Object.keys(bot.registry.blocksByName)
            .filter(name => (name.includes('door') || name.includes('gate')) && !name.includes('trapdoor'))
        
        // Add door types to interactables if not present
        doorTypes.forEach(doorType => {
            if (!defaultInteractables.includes(doorType)) {
                defaultInteractables.push(doorType)
            }
        })

        // Configure movements
        movements.canDig = false
        movements.digCost = Infinity
        movements.canOpenDoors = true
        movements.allowFreeMotion = false
        
        // Add doors to openable set
        movements.openable = new Set()
        doorTypes.forEach(doorType => {
            const block = bot.registry.blocksByName[doorType]
            if (block) {
                movements.openable.add(block.id)
                movements.blocksCantBreak.add(block.id)  // Also prevent breaking
            }
        })

        // Make door interaction preferred
        movements.placeCost = 1
        
        // Configure pathfinder
        bot.pathfinder.setMovements(movements)
        
        logToFile('Door interaction plugin loaded', 'DoorInteract')
        logToFile(`canOpenDoors set to: ${movements.canOpenDoors}`, 'DoorInteract')

        // Add door-specific movement overrides
        const originalMovements = bot.pathfinder.movements
        bot.pathfinder.movements.canDig = false
        bot.pathfinder.movements.digCost = Infinity
        bot.pathfinder.movements.blocksToAvoid = new Set([
            ...Array.from(bot.pathfinder.movements.blocksToAvoid || []),
            ...doorTypes.map(name => bot.registry.blocksByName[name]?.id).filter(Boolean)
        ])
        
        // Override door interaction distance
        bot.pathfinder.movements.maxDropDown = 4  // Allow larger drops near doors
        bot.pathfinder.movements.canOpenDoors = true
        
        logToFile('Added door movement overrides', 'PATHFINDING')

        // Inject unified door handling
        doorHandler.inject()
        
        logToFile('Door pathfinding modifications applied', 'PATHFINDING')
    })

    // Add clean shutdown handling
    function cleanShutdown() {
        logToFile('=== Starting Clean Shutdown ===', 'INFO')
        
        // Clear any ongoing pathfinding
        if (bot.pathfinder) {
            bot.pathfinder.stop()
        }
        
        // Clear any control states
        bot.clearControlStates()
        
        // Log shutdown
        logToFile('Pathfinding stopped and controls cleared', 'INFO')
        
        // Disconnect from server gracefully
        bot.quit('Shutting down cleanly')
        
        // Final log
        logToFile('=== Clean Shutdown Complete ===', 'INFO')
        
        // Give time for logs to write
        setTimeout(() => {
            process.exit(0)
        }, 1000)
    }

    // Add shutdown handlers
    bot.on('end', cleanShutdown)
    bot.on('error', (err) => {
        logToFile(`Error occurred: ${err.message}`, 'ERROR')
        cleanShutdown()
    })
    
    // Handle process signals
    process.on('SIGINT', cleanShutdown)
    process.on('SIGTERM', cleanShutdown)

    // Enhanced door interaction handler
    bot.on('blockInteract', (block) => {
        if (block.name.includes('door')) {
            const props = block.getProperties()
            logToFile('=== Door Interaction Event ===', 'INTERACTION')
            
            // Only interact if door is closed
            if (props.open === 'true') {
                logToFile('Door is already open, skipping interaction', 'INTERACTION')
                return
            }

            // Log complete door state
            logToFile(`Door position: x=${block.position.x}, y=${block.position.y}, z=${block.position.z}`, 'INTERACTION')
            logToFile(`Door type: ${block.name}`, 'INTERACTION')
            logToFile(`Facing: ${props.facing}`, 'INTERACTION')
            logToFile(`Half: ${props.half}`, 'INTERACTION')
            logToFile(`Hinge: ${props.hinge}`, 'INTERACTION')
            logToFile(`Open: ${props.open}`, 'INTERACTION')

            // Try to open door
            try {
                bot.activateBlock(block)
                logToFile('Door interaction successful', 'INTERACTION')
            } catch (err) {
                logToFile(`Failed to interact with door: ${err.message}`, 'ERROR')
            }

            logToFile('=== End Door Interaction Event ===', 'INTERACTION')
        }
    })

    function calculateDoorApproachPositions(block, props) {
        const positions = []
        const pos = block.position
        
        // Add positions based on door facing
        switch(props.facing) {
            case 'north':
                positions.push(new Vec3(pos.x, pos.y, pos.z + 1))  // South side
                positions.push(new Vec3(pos.x, pos.y, pos.z - 1))  // North side
                break
            case 'south':
                positions.push(new Vec3(pos.x, pos.y, pos.z - 1))  // North side
                positions.push(new Vec3(pos.x, pos.y, pos.z + 1))  // South side
                break
            case 'east':
                positions.push(new Vec3(pos.x - 1, pos.y, pos.z))  // West side
                positions.push(new Vec3(pos.x + 1, pos.y, pos.z))  // East side
                break
            case 'west':
                positions.push(new Vec3(pos.x + 1, pos.y, pos.z))  // East side
                positions.push(new Vec3(pos.x - 1, pos.y, pos.z))  // West side
                break
        }
        
        return positions
    }

    // Track movement near doors
    bot.on('move', () => {
        const currentBlock = bot.blockAt(bot.entity.position)
        const nearbyPlayers = Object.values(bot.players)
            .filter(p => p.entity && p.entity !== bot.entity)
        
        // Track position
        PositionTracker.addPosition(bot.entity.position)
        PositionTracker.cleanupOldPositions(bot.entity.position)
        
        // Log all nearby players and their positions
        nearbyPlayers.forEach(player => {
            logToFile(`Detected player ${player.username}:
                Position: ${JSON.stringify(player.entity.position)}
                Distance to bot: ${player.entity.position.distanceTo(bot.entity.position)}`, 'DETECTION')
            
            const playerPos = player.entity.position
            const nearbyDoors = bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: 2,
                count: 1
            })
            
            // Log all found doors and distances
            nearbyDoors.forEach(doorPos => {
                const door = bot.blockAt(doorPos)
                if (door) {
                    const distanceToDoor = playerPos.distanceTo(doorPos)
                    logToFile(`Door check for player ${player.username}:
                        Door position: ${JSON.stringify(doorPos)}
                        Door type: ${door.name}
                        Door state: ${JSON.stringify(door.getProperties())}
                        Distance to player: ${distanceToDoor}
                        Will track: ${distanceToDoor < 2 ? 'yes' : 'no'}`, 'DETECTION')
                    
                    if (distanceToDoor < 2) {
                        logToFile(`Triggering door pass tracking for ${player.username}`, 'DETECTION')
                        DoorRegistry.trackPlayerDoorPass(player, door)
                    }
                }
            })
        })
    })

    // Monitor pathfinding failures
    bot.on('path_update', (results) => {
        if (results.status === 'noPath') {
            logToFile('=== Pathfinding Failure Analysis ===', 'PATHFINDING')
            logToFile(`Bot state during pathfinding failure:
                Position: ${JSON.stringify(bot.entity.position)}
                Velocity: ${JSON.stringify(bot.entity.velocity)}
                On Ground: ${bot.entity.onGround}
                Is Collidable: ${bot.entity.isCollidedHorizontally}`, 'PATHFINDING')
            
            // Check movement state near doors
            const nearbyDoors = bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: 5,
                count: 3
            })
            
            nearbyDoors.forEach(doorPos => {
                const door = bot.blockAt(doorPos)
                if (door) {
                    logToFile(`Door blocking path:
                        Type: ${door.name}
                        Position: ${JSON.stringify(doorPos)}
                        State: ${JSON.stringify(getDoorState(door))}
                        Distance: ${bot.entity.position.distanceTo(doorPos)}
                        In openable set: ${bot.pathfinder.movements.openable.has(door.type)}`, 'PATHFINDING')
                }
            })
            logToFile('=== End Pathfinding Analysis ===', 'PATHFINDING')
            
            // Add door interaction analysis
            const interactionDoors = bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: 5,
                count: 3
            })
            
            if (interactionDoors.length > 0) {
                logToFile('=== Door Interaction Analysis ===', 'PATHFINDING')
                interactionDoors.forEach(doorPos => {
                    const door = bot.blockAt(doorPos)
                    if (door) {
                        const doorState = getDoorState(door)
                        const canInteract = bot.entity.position.distanceTo(doorPos) <= DOOR_MOVEMENT_OVERRIDES.doorInteractionRange
                        logToFile(`Door interaction check:
                            Type: ${door.name}
                            Position: ${JSON.stringify(doorPos)}
                            State: ${JSON.stringify(doorState)}
                            Can interact: ${canInteract}
                            Interaction range: ${DOOR_MOVEMENT_OVERRIDES.doorInteractionRange}
                            Distance: ${bot.entity.position.distanceTo(doorPos)}
                            Movement allowed: ${bot.pathfinder.movements.canOpenDoors}
                            Is in openable set: ${bot.pathfinder.movements.openable.has(door.type)}`, 'PATHFINDING')
                    }
                })
                logToFile('=== End Door Analysis ===', 'PATHFINDING')
            }
        }
    })

    // Add to existing event handlers
    bot.on('diggingCompleted', (block) => {
        if (block.name.includes('door')) {
            logToFile('=== Door Break Event ===', 'WARNING')
            logToFile(`Door was broken at: x=${block.position.x}, y=${block.position.y}, z=${block.position.z}`, 'WARNING')
            logToFile(`Door type: ${block.name}`, 'WARNING')
            logToFile('This indicates the bot broke through instead of using the door properly', 'WARNING')
            logToFile('=== End Door Break Event ===', 'WARNING')
        }
    })

    bot.on('diggingStarted', (block) => {
        if (block.name.includes('door')) {
            logToFile('=== Door Break Attempt Started ===', 'WARNING')
            logToFile(`Attempting to break door at: x=${block.position.x}, y=${block.position.y}, z=${block.position.z}`, 'WARNING')
            logToFile('=== End Door Break Attempt ===', 'WARNING')
        }
    })

    // Monitor ALL door state changes with enhanced tracking
    bot.on('blockUpdate', (oldBlock, newBlock) => {
        if (oldBlock?.name?.includes('door') || newBlock?.name?.includes('door')) {
            logToFile('=== Door State Change Event ===', 'DETECTION')
            
            // Get current time for timing reference
            const timestamp = new Date().toISOString()
            
            // Track who initiated the change
            const initiator = {
                type: 'unknown',
                name: 'unknown',
                distance: null
            }
            
            // Check nearby entities for potential initiators
            const nearbyEntities = Object.values(bot.entities)
            const doorPos = newBlock ? newBlock.position : oldBlock.position
            
            nearbyEntities.forEach(entity => {
                const distance = entity.position.distanceTo(doorPos)
                if (distance < 4) {  // Within interaction range
                    if (entity === bot.entity) {
                        initiator.type = 'bot'
                        initiator.name = bot.username
                        initiator.distance = distance
                    } else if (entity.type === 'player') {
                        initiator.type = 'player'
                        initiator.name = entity.username || entity.name
                        initiator.distance = distance
                    }
                }
                logToFile(`Nearby entity: ${entity.name || entity.username || 'unknown'} at ${distance.toFixed(2)} blocks`, 'DETECTION')
            })
            
            // Log detailed state changes
            if (oldBlock?.name?.includes('door')) {
                const oldProps = oldBlock.getProperties()
                logToFile('Previous state:', 'DETECTION')
                logToFile(`Time: ${timestamp}`, 'DETECTION')
                logToFile(`Position: x=${oldBlock.position.x}, y=${oldBlock.position.y}, z=${oldBlock.position.z}`, 'DETECTION')
                logToFile(`Type: ${oldBlock.name}`, 'DETECTION')
                logToFile(`Open: ${oldProps.open}`, 'DETECTION')
                logToFile(`Facing: ${oldProps.facing}`, 'DETECTION')
            }
            
            if (newBlock?.name?.includes('door')) {
                const newProps = newBlock.getProperties()
                logToFile('New state:', 'DETECTION')
                logToFile(`Time: ${timestamp}`, 'DETECTION')
                logToFile(`Position: x=${newBlock.position.x}, y=${newBlock.position.y}, z=${newBlock.position.z}`, 'DETECTION')
                logToFile(`Type: ${newBlock.name}`, 'DETECTION')
                logToFile(`Open: ${newProps.open}`, 'DETECTION')
                logToFile(`Facing: ${newProps.facing}`, 'DETECTION')
            }

            // Log who likely interacted with the door
            logToFile(`Interaction initiated by: ${initiator.type} (${initiator.name}) at distance ${initiator.distance?.toFixed(2) || 'unknown'}`, 'DETECTION')
            logToFile('=== End Door State Change Event ===', 'DETECTION')
        }
    })

    // Add new door movement function
    function addDoorMovements(movements) {
        // Store original getMoveForward
        const originalGetMoveForward = movements.getMoveForward

        // Override getMoveForward to handle doors
        movements.getMoveForward = function(node, dir, neighbors) {
            const blockC = this.getBlock(node, dir.x, 0, dir.z)
            
            // If block is a door, use manual traversal sequence
            if (blockC.name && blockC.name.includes('door')) {
                logToFile('=== Door Movement Sequence Start ===', 'MOVEMENT')
                
                // Calculate approach position
                const approachPos = {
                    x: node.x + (dir.x * 2),  // 2 blocks away
                    y: node.y,
                    z: node.z + (dir.z * 2)
                }
                
                // Add movement sequence
                neighbors.push({
                    x: approachPos.x,
                    y: approachPos.y,
                    z: approachPos.z,
                    remainingBlocks: node.remainingBlocks,
                    cost: 1,  // Base movement cost
                    toBreak: [],
                    toPlace: [],
                    returnPos: node.pos,  // Store original position
                    isDoorSequence: true,  // Mark as door sequence
                    doorBlock: blockC     // Store door reference
                })
                
                logToFile('Added door movement sequence', 'MOVEMENT')
                return
            }
            
            // Use original movement for non-door blocks
            return originalGetMoveForward.call(this, node, dir, neighbors)
        }

        // Add door sequence handler
        movements.handleDoorSequence = async function(node) {
            if (!node.isDoorSequence) return false
            
            try {
                logToFile('Executing door movement sequence', 'MOVEMENT')
                
                // Step 1: Approach door
                await this.bot.lookAt(node.doorBlock.position)
                
                // Step 2: Open door
                await this.bot.activateBlock(node.doorBlock)
                
                // Step 3: Move through
                await this.bot.setControlState('forward', true)
                await new Promise(resolve => setTimeout(resolve, 1000))
                await this.bot.setControlState('forward', false)
                
                logToFile('Door sequence complete', 'SUCCESS')
                return true
            } catch (err) {
                logToFile(`Door sequence failed: ${err.message}`, 'ERROR')
                return false
            }
        }
    }

    // Add pathfinding integration
    function addDoorPathfinding(movements) {
        const originalGetMoveForward = movements.getMoveForward

        movements.getMoveForward = function(node, dir, neighbors) {
            const blockC = this.getBlock(node, dir.x, 0, dir.z)
            
            if (blockC.name && blockC.name.includes('door')) {
                // Found door in path, switch to smart pathfinding
                const currentGoal = this.bot.pathfinder.goal
                
                logToFile(`Door detected in path:
                    Position: ${JSON.stringify(blockC.position)}
                    Current goal: ${JSON.stringify(currentGoal)}`, 'PATHFINDING')
                
                // Queue smart pathfinding
                setTimeout(() => {
                    smartPathfindThroughDoor(this.bot, currentGoal)
                }, 0)
                
                return
            }
            
            return originalGetMoveForward.call(this, node, dir, neighbors)
        }
    }

    // Apply door pathfinding to bot's movements
    const movements = new Movements(bot)
    addDoorPathfinding(movements)
    bot.pathfinder.setMovements(movements)

    // Add door commands to bot
    bot.doorCommands = {
        gotodoor: async function() {
            const door = bot.findBlock({
                matching: block => block.name.includes('door'),
                maxDistance: 50
            })
            
            if (!door) {
                bot.chat("I can't find any doors nearby!")
                return
            }
            
            bot.chat('I found a door! Moving to interact...')
            try {
                // Get initial door state
                const initialProps = door.getProperties()
                logToFile('=== Door Test Sequence Start ===', 'INFO')
                logToFile(`Initial door state: ${JSON.stringify(initialProps)}`, 'INFO')
                
                // Move to door first
                const movements = new Movements(bot)
                movements.canDig = false
                movements.digCost = Infinity
                movements.canOpenDoors = true
                bot.pathfinder.setMovements(movements)
                
                // Calculate approach position
                const pos = door.position
                const approachPos = new Vec3(pos.x + 1, pos.y, pos.z)  // Start with east side
                
                // Move to position
                await bot.pathfinder.goto(new GoalNear(approachPos.x, approachPos.y, approachPos.z, 1))
                bot.chat('Starting door interaction test...')
                
                // Start door interaction cycle
                let cycleCount = 0
                const doorInterval = setInterval(async () => {
                    if (cycleCount >= 5) {
                        clearInterval(doorInterval)
                        logToFile('Door interaction test complete', 'INFO')
                        bot.chat('Door testing complete!')
                        return
                    }
                    
                    try {
                        // Log current state
                        const currentProps = door.getProperties()
                        logToFile(`Cycle ${cycleCount + 1}: Current state: ${JSON.stringify(currentProps)}`, 'INFO')
                        
                        // Interact with door
                        await bot.activateBlock(door)
                        logToFile(`Cycle ${cycleCount + 1}: Door activated`, 'INTERACTION')
                        
                        // Wait 1 second then close
                        setTimeout(async () => {
                            await bot.activateBlock(door)
                            logToFile(`Cycle ${cycleCount + 1}: Door toggled`, 'INTERACTION')
                        }, 1000)
                        
                        cycleCount++
                    } catch (err) {
                        logToFile(`Error in cycle ${cycleCount}: ${err.message}`, 'ERROR')
                    }
                }, 2000)
                
            } catch (err) {
                bot.chat("I had trouble with the door!")
                logToFile(`Door test error: ${err.message}`, 'ERROR')
                bot.pathfinder.stop()
            }
        },
        
        gothroughdoor: async function() {
            let targetDoor = null
            let pathfindingAttempts = 0
            const MAX_ATTEMPTS = 3

            const findDoorAndValidate = async () => {
                const result = findAndRegisterDoor(bot, targetDoor)
                if (!result) return null

                if (!targetDoor) {
                    targetDoor = result.door // Set initial target
                }

                return result
            }

            const attemptPathfinding = async () => {
                const startTime = Date.now()
                pathfindingAttempts++
                
                logToFile(`Starting pathfinding attempt ${pathfindingAttempts}`, 'TIMING')
                
                const result = await findDoorAndValidate()
                if (!result) {
                    const duration = Date.now() - startTime
                    logToFile(`No door found after ${duration}ms on attempt ${pathfindingAttempts}`, 'TIMING')
                    return false
                }

                const { door, doorInfo, state } = result

                try {
                    // Set timeout based on distance
                    const distance = bot.entity.position.distanceTo(door.position)
                    const estimatedTicks = Math.ceil(distance * 20) // Rough estimate of ticks needed
                    const timeout = Math.max(
                        PATHFINDING_CONSTANTS.DEFAULT_TIMEOUT,
                        estimatedTicks * PATHFINDING_CONSTANTS.TICK_LENGTH
                    )

                    logToFile(`Pathfinding parameters:
                        Distance: ${distance.toFixed(2)} blocks
                        Estimated ticks: ${estimatedTicks}
                        Timeout: ${timeout}ms`, 'TIMING')

                    // Create a promise that times out
                    const pathfindingPromise = new Promise(async (resolve, reject) => {
                        try {
                            // Your movement code here
                            // Example:
                            await bot.pathfinder.goto(new goals.GoalNear(door.position.x, door.position.y, door.position.z, 2), timeout)
                            resolve()
                        } catch (err) {
                            reject(err)
                        }
                    })

                    await pathfindingPromise

                    const duration = Date.now() - startTime
                    DoorRegistry.trackPathfindingTime(doorInfo.id, startTime)
                    
                    logToFile(`Successful pathfinding:
                        Attempt: ${pathfindingAttempts}
                        Duration: ${duration}ms
                        Door: ${doorInfo.label}`, 'TIMING')
                    
                    return true

                } catch (err) {
                    const duration = Date.now() - startTime
                    logToFile(`Pathfinding failed after ${duration}ms:
                        Attempt: ${pathfindingAttempts}
                        Error: ${err.message}
                        Door: ${doorInfo.label}`, 'TIMING')
                    return false
                }
            }

            while (pathfindingAttempts < MAX_ATTEMPTS) {
                if (await attemptPathfinding()) {
                    break
                }
                // Wait one tick length between attempts
                await new Promise(resolve => setTimeout(resolve, PATHFINDING_CONSTANTS.TICK_LENGTH))
            }

            if (pathfindingAttempts >= MAX_ATTEMPTS) {
                bot.chat("I'm having trouble reaching the door after multiple attempts.")
                logToFile('Maximum pathfinding attempts reached', 'ERROR')
            }
        },
        
        gothroughdoormanual: async function() {
            const door = bot.findBlock({
                matching: block => block.name.includes('door'),
                maxDistance: 50
            })
            
            if (!door) {
                bot.chat("I can't find any doors nearby!")
                return
            }
            
            bot.chat('Found door! Starting manual traversal sequence...')
            logToFile('=== Manual Door Traversal Start ===', 'MOVEMENT')
            
            try {
                logToFile('=== Manual Door Traversal Start ===', 'MOVEMENT')
                logBotPosition(bot, 'Starting position')  // Initial position
                
                // Step 1: Initial approach and face door
                logToFile('Step 1: Moving to initial door position', 'MOVEMENT')
                const approachVector = new Vec3(
                    door.position.x + (bot.entity.position.x < door.position.x ? -2 : 2),
                    door.position.y,
                    door.position.z
                )
                logToFile(`Calculated approach vector: x=${approachVector.x}, y=${approachVector.y}, z=${approachVector.z}`, 'MOVEMENT')
                
                // Wait for initial approach to complete before continuing
                await bot.pathfinder.goto(new goals.GoalNear(approachVector.x, approachVector.y, approachVector.z, 1))
                await new Promise(resolve => setTimeout(resolve, 500))  // Small delay to ensure stability
                
                // Step 2: Move forward 3 blocks
                bot.chat('Moving into position...')
                logToFile('Step 2: Moving forward 3 blocks', 'MOVEMENT')
                bot.setControlState('forward', true)
                await new Promise(resolve => setTimeout(resolve, 1500))  // Time to move 3 blocks
                bot.setControlState('forward', false)
                logToFile(`Position after move: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 3: Turn to face door
                bot.chat('Turning to face door...')
                logToFile('Step 3: Turning to face door', 'MOVEMENT')
                await bot.look(bot.entity.yaw + Math.PI, bot.entity.pitch)
                logToFile(`Final facing yaw: ${bot.entity.yaw.toFixed(2)}`, 'MOVEMENT')
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 4: Check and handle door
                bot.chat('Checking door...')
                logToFile('Step 4: Checking door state', 'INTERACTION')
                const doorState = door.getProperties()
                logToFile(`Bot thinks door state is: ${JSON.stringify(doorState)}`, 'STATE')
                
                // Ask for user validation
                bot.chat(`Is the door currently open? (say 'yes' or 'no')`)
                
                // Wait for user response
                const response = await new Promise(resolve => {
                    const responseHandler = (username, message) => {
                        if (message.toLowerCase() === 'yes' || message.toLowerCase() === 'no') {
                            bot.removeListener('chat', responseHandler)
                            resolve(message.toLowerCase() === 'yes')
                        }
                    }
                    bot.on('chat', responseHandler)
                })
                
                // Log the validation
                logToFile(`User validated door state - Door is ${response ? 'open' : 'closed'}`, 'VALIDATION')
                logToFile(`Comparison - Bot thought: ${doorState.open}, User confirmed: ${response}`, 'VALIDATION')
                
                // Handle door based on validated state
                if (!response) {  // Door is closed according to user
                    bot.chat('Opening door...')
                    logToFile('Door is closed, opening...', 'INTERACTION')
                    await bot.activateBlock(door)
                    await new Promise(resolve => setTimeout(resolve, 500))
                }
                
                // Step 5: Move through doorway
                bot.chat('Walking through door...')
                logToFile('Step 5: Walking through doorway', 'MOVEMENT')
                bot.setControlState('forward', true)
                await new Promise(resolve => setTimeout(resolve, 2000))  // Time to move 4 blocks
                bot.setControlState('forward', false)
                
                // Check if we need to close door behind us
                const finalState = door.getProperties()
                if (finalState.open === 'true') {
                    logToFile('Closing door behind us...', 'INTERACTION')
                    await bot.activateBlock(door)
                }
                
                logToFile(`Final position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                
                bot.chat('Manual door traversal complete!')
                logToFile('=== Manual Door Traversal Complete ===', 'SUCCESS')
                
                // After walking through door first time
                logToFile(`Position after first traversal: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                await new Promise(resolve => setTimeout(resolve, 1000))  // Pause at destination
                
                try {
                    // Turn around to face door again
                    bot.chat('Turning to return...')
                    logToFile('Turning to face door for return trip', 'MOVEMENT')
                    await bot.look(bot.entity.yaw + Math.PI, bot.entity.pitch)
                    await new Promise(resolve => setTimeout(resolve, 500))
                    
                    // Check door state before return
                    const returnDoorState = door.getProperties()
                    logToFile(`Door state before return: ${JSON.stringify(returnDoorState)}`, 'STATE')
                    
                    if (returnDoorState.open === 'false') {
                        bot.chat('Opening door for return...')
                        logToFile('Door is closed, opening for return trip', 'INTERACTION')
                        await bot.activateBlock(door)
                        await new Promise(resolve => setTimeout(resolve, 500))
                        
                        // Verify door opened
                        const verifyState = door.getProperties()
                        if (verifyState.open === 'false') {
                            logToFile('Door failed to open for return, retrying...', 'WARNING')
                            await bot.activateBlock(door)
                            await new Promise(resolve => setTimeout(resolve, 500))
                        }
                    }
                    
                    // Walk back through
                    bot.chat('Returning through door...')
                    logToFile('Walking back through doorway', 'MOVEMENT')
                    bot.setControlState('forward', true)
                    await new Promise(resolve => setTimeout(resolve, 2000))  // Move 4 blocks
                    bot.setControlState('forward', false)
                    
                    logToFile(`Final return position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                    bot.chat('Return trip complete!')
                    
                } catch (err) {
                    bot.chat('Error during return trip!')
                    logToFile(`Return trip error: ${err.message}`, 'ERROR')
                    logToFile(`Error stack: ${err.stack}`, 'ERROR')
                    bot.clearControlStates()
                }
            } catch (err) {
                bot.chat('Error during manual traversal!')
                logToFile(`Manual traversal error: ${err.message}`, 'ERROR')
                logToFile(`Error stack: ${err.stack}`, 'ERROR')
                bot.clearControlStates()
            }
        },
        
        listdoors: function() {
            const nearbyDoors = DoorRegistry.getNearbyDoors(bot.entity.position)
            if (nearbyDoors.length === 0) {
                bot.chat("I don't see any doors nearby!")
                return
            }

            bot.chat(`I found ${nearbyDoors.length} doors:`)
            nearbyDoors.forEach((doorInfo, index) => {
                bot.chat(`${index + 1}. ${doorInfo.label} (${doorInfo.distance.toFixed(1)} blocks away)`)
            })
        },
        
        gotodestination: async function(x, y, z) {
            const goal = new goals.GoalNear(x, y, z, 1)
            
            logToFile(`Starting pathfinding to destination: ${x}, ${y}, ${z}`, 'PATHFINDING')
            
            try {
                await bot.pathfinder.goto(goal)
                bot.chat('Reached destination!')
            } catch (err) {
                if (err.message.includes('door')) {
                    // Door detected in path, try smart pathfinding
                    const success = await smartPathfindThroughDoor(bot, goal)
                    if (success) {
                        bot.chat('Made it through the door and reached destination!')
                    } else {
                        bot.chat('Had trouble with the door along the way.')
                    }
                } else {
                    bot.chat('Could not reach destination!')
                    logToFile(`Pathfinding failed: ${err.message}`, 'ERROR')
                }
            }
        }
    }

    // Add command handler to bot's chat event
    bot.on('chat', (username, message) => {
        if (username === bot.username) return
        
        // Check if it's a door command
        if (bot.doorCommands[message]) {
            bot.doorCommands[message]()
        }
    })

    // Add to the inject function to initialize registry on spawn
    bot.once('spawn', () => {
        DoorRegistry.clearSession()
        logToFile('Started new door tracking session', 'REGISTRY')
    })

    // Add to the inject function after the movement overrides
    bot.on('path_update', (results) => {
        if (results.status === 'noPath') {
            logToFile('=== Pathfinding State Analysis ===', 'PATHFINDING')
            logToFile(`Current pathfinding status: ${results.status}`, 'PATHFINDING')
            logToFile(`Bot position: ${JSON.stringify(bot.entity.position)}`, 'PATHFINDING')
            
            // Check for doors in path
            const nearbyDoors = bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: 5,
                count: 3
            })
            
            if (nearbyDoors.length > 0) {
                nearbyDoors.forEach(doorPos => {
                    const door = bot.blockAt(doorPos)
                    if (door) {
                        const doorState = getDoorState(door)
                        const canPass = bot.pathfinder.movements.openable.has(door.type)
                        logToFile(`Door analysis:
                            Type: ${door.name}
                            Position: ${JSON.stringify(doorPos)}
                            State: ${JSON.stringify(doorState)}
                            Can pass through: ${canPass}
                            Distance: ${bot.entity.position.distanceTo(doorPos)}
                            Movement settings: {
                                canOpenDoors: ${bot.pathfinder.movements.canOpenDoors},
                                allowFreeMotion: ${bot.pathfinder.movements.allowFreeMotion}
                            }`, 'PATHFINDING')
                    }
                })
            }
        }
    })

    // Add after the existing path_update event handlers
    bot.on('path_update', async (results) => {
        if (results.status === 'noPath') {
            const nearbyDoors = bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: 5,
                count: 3
            })

            if (nearbyDoors.length > 0) {
                const door = bot.blockAt(nearbyDoors[0])
                if (door) {
                    const doorState = getDoorState(door)
                    if (!doorState.isOpen) {
                        logToFile('Found closed door in path, attempting to handle', 'PATHFINDING')
                        
                        // Get leader position for door traversal
                        const leader = Object.values(bot.players).find(p => p.entity && p.entity !== bot.entity)
                        if (leader && leader.entity) {
                            try {
                                const success = await doorHandler.handleDoor(door, leader.entity.position)
                                if (success) {
                                    logToFile('Successfully handled door, retrying path', 'PATHFINDING')
                                    // Small delay to let door finish opening
                                    await new Promise(resolve => setTimeout(resolve, 250))
                                    // Retry original path
                                    bot.pathfinder.setGoal(results.path[results.path.length - 1])
                                }
                            } catch (err) {
                                logToFile(`Failed to handle door: ${err.message}`, 'ERROR')
                            }
                        }
                    }
                }
            }
        }
    })
}

// Add smart pathfinding function
async function smartPathfindThroughDoor(bot, originalGoal) {
    try {
        const startPosition = bot.entity.position.clone()
        PositionTracker.addPosition(startPosition)

        const doorResult = findAndRegisterDoor(bot)
        if (!doorResult) {
            logToFile('No door found in path', 'ERROR')
            return false
        }

        const { door, doorInfo } = doorResult
        
        // Track positions during door traversal
        const doorPosition = door.position.clone()
        PositionTracker.addPosition(doorPosition)

        await handleDoorTraversal(bot, door, doorInfo)
        
        // Track position after traversal
        PositionTracker.addPosition(bot.entity.position.clone())
        
        await resumePathfinding(bot, doorInfo, originalGoal)
        return true

    } catch (err) {
        logToFile(`Smart pathfinding failed: ${err.message}`, 'ERROR')
        return false
    }
}

// Add door traversal handler
async function handleDoorTraversal(bot, door, doorInfo) {
    try {
        // Calculate approach position
        const approachPos = calculateDoorApproach(bot, door)
        
        // Move to approach position
        await bot.pathfinder.goto(new goals.GoalNear(
            approachPos.x, 
            approachPos.y, 
            approachPos.z, 
            PATHFINDING_CONSTANTS.DOOR_APPROACH_DISTANCE
        ))

        // Handle door interaction
        await interactWithDoor(bot, door, doorInfo)

        // Move through doorway
        const throughPos = calculateThroughPosition(door)
        await moveThrough(bot, throughPos)

    } catch (err) {
        logToFile(`Door traversal failed: ${err.message}`, 'ERROR')
        throw err
    }
}

// Add pathfinding resume function
async function resumePathfinding(bot, doorInfo, originalGoal) {
    // Wait for bot to stabilize after door traversal
    await new Promise(resolve => setTimeout(resolve, PATHFINDING_CONSTANTS.RESUME_DELAY))
    
    logToFile(`Resuming pathfinding after door ${doorInfo.label}`, 'PATHFINDING')
    
    // Clear door from memory
    DoorRegistry.clearPath(doorInfo.id)
    
    // Resume original pathfinding
    return bot.pathfinder.goto(originalGoal)
}

// Add near the top with other utility functions
function getDoorState(door) {
    if (!door) return null
    const properties = door.getProperties()
    return {
        isOpen: properties.open === 'true',
        facing: properties.facing,
        half: properties.half,
        hinge: properties.hinge,
        powered: properties.powered === 'true'
    }
}

// At the top of the file, add logging utility
function logToFile(message, type = 'INFO') {
    const logMessage = `[${new Date().toISOString()}] [DoorInteract] [${type}] ${message}\n`
    
    // Only log critical events to console
    if (type === 'ERROR' || 
        type === 'CRITICAL' || 
        (type === 'PATHFINDING' && message.includes('Failed to'))) {
        console.log(logMessage)
    }
    
    // Write to log file
    fs.appendFileSync(path.join('logs', 'door-interact.log'), logMessage)
}

// At the end of the file, modify exports
module.exports = {
    pathfinderdoor: inject,
    getDoorState: getDoorState,
    PositionTracker: PositionTracker,
    logToFile: logToFile
} 