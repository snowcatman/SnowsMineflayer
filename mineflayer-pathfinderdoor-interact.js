// Import required libraries for bot functionality
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')                // For 3D position calculations
const fs = require('fs')                    // For file operations
const path = require('path')                // For path handling

// Function to write logs to file with timestamp and type
function logToFile(message, type = 'INFO') {
    const logMessage = `[${new Date().toISOString()}] [DoorInteract] [${type}] ${message}\n`
    console.log(logMessage)                 // Show in console
    fs.appendFileSync(path.join('logs', 'door-interact.log'), logMessage)  // Write to log file
}

// Main function to inject door functionality into bot
function inject(bot) {
    // Wait for registry to be ready
    bot.once('spawn', () => {
        // Configure door-specific movements
        const movements = new Movements(bot)
        
        // Critical changes to prevent door breaking
        movements.canDig = false            // Disable ALL block breaking
        movements.digCost = Infinity        // Make breaking impossibly expensive
        movements.canOpenDoors = true       // Enable door interaction
        movements.allowFreeMotion = false   // Prevent unwanted movements
        
        // Add doors to openable set
        movements.openable = new Set()
        Object.keys(bot.registry.blocksByName).forEach(blockName => {
            if (blockName.includes('door') && !blockName.includes('trap')) {
                movements.openable.add(bot.registry.blocksByName[blockName].id)
            }
        })

        // Make door interaction preferred
        movements.placeCost = 1             // Keep door interaction cost low
        
        // Configure pathfinder
        bot.pathfinder.setMovements(movements)
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
        if (currentBlock && currentBlock.name.includes('door')) {
            logToFile('=== Door Movement Event ===', 'MOVEMENT')
            logToFile(`Bot position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
            logToFile(`Bot velocity: x=${bot.entity.velocity.x.toFixed(2)}, y=${bot.entity.velocity.y.toFixed(2)}, z=${bot.entity.velocity.z.toFixed(2)}`, 'MOVEMENT')
            logToFile(`Door state: ${JSON.stringify(currentBlock.getProperties())}`, 'MOVEMENT')
            logToFile('=== End Door Movement Event ===', 'MOVEMENT')
        }
    })

    // Monitor pathfinding failures
    bot.on('path_update', (results) => {
        if (results.status === 'noPath') {
            logToFile('Failed to find path - May indicate door navigation issue', 'PATHFINDING')
            if (results.path.length > 0) {
                logToFile(`Target position: ${JSON.stringify(results.path[0])}`, 'PATHFINDING')
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
        // Store original getMoveForward
        const originalGetMoveForward = movements.getMoveForward

        movements.getMoveForward = function(node, dir, neighbors) {
            const blockC = this.getBlock(node, dir.x, 0, dir.z)
            
            // If block is a door, handle door traversal
            if (blockC.name && blockC.name.includes('door')) {
                logToFile('Found door in path', 'PATHFINDING')
                
                // Check door state
                const doorState = blockC.getProperties()
                const doorPos = blockC.position
                
                // Calculate approach position
                const approachPos = {
                    x: node.x,
                    y: node.y,
                    z: node.z
                }
                
                // Calculate through position
                const throughPos = {
                    x: node.x + (dir.x * 2),
                    y: node.y,
                    z: node.z + (dir.z * 2)
                }
                
                // Add door traversal sequence
                neighbors.push({
                    x: throughPos.x,
                    y: throughPos.y,
                    z: throughPos.z,
                    remainingBlocks: node.remainingBlocks,
                    cost: 2,  // Higher cost for door traversal
                    toBreak: [],
                    toPlace: [],
                    isDoorMove: true,
                    doorBlock: blockC,
                    approachPos: approachPos
                })
                
                logToFile('Added door traversal to path options', 'PATHFINDING')
                return
            }
            
            // Use original movement for non-door blocks
            return originalGetMoveForward.call(this, node, dir, neighbors)
        }

        // Add door movement handler
        movements.handleDoorMove = async function(node) {
            if (!node.isDoorMove) return false
            
            try {
                // 1. Move to approach position
                await bot.lookAt(node.doorBlock.position)
                
                // 2. Check and handle door state
                const doorState = node.doorBlock.getProperties()
                if (doorState.open === 'false') {
                    await bot.activateBlock(node.doorBlock)
                    await new Promise(resolve => setTimeout(resolve, 500))
                }
                
                // 3. Move through while facing forward
                await bot.lookAt(new Vec3(node.x, node.y, node.z))
                await bot.pathfinder.goto(new goals.GoalNear(node.x, node.y, node.z, 1))
                
                return true
            } catch (err) {
                logToFile(`Door movement failed: ${err.message}`, 'ERROR')
                return false
            }
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
            const door = bot.findBlock({
                matching: block => block.name.includes('door'),
                maxDistance: 50
            })
            
            if (!door) {
                bot.chat("I can't find any doors nearby!")
                return
            }
            
            bot.chat('I found a door! Moving through it...')
            logToFile('=== Door Traversal Start ===', 'MOVEMENT')
            
            try {
                // Log initial state
                const initialProps = door.getProperties()
                logToFile(`Initial door state: ${JSON.stringify(initialProps)}`, 'INFO')
                logToFile(`Initial bot position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                
                // Configure movements
                const movements = new Movements(bot)
                movements.canDig = false
                movements.digCost = Infinity
                movements.canOpenDoors = true
                movements.allowFreeMotion = false
                bot.pathfinder.setMovements(movements)
                
                // Calculate approach position based on door facing
                const doorPos = door.position
                const facing = initialProps.facing
                
                // Calculate positions on both sides of door
                const positions = {
                    north: new Vec3(doorPos.x, doorPos.y, doorPos.z - 1),
                    south: new Vec3(doorPos.x, doorPos.y, doorPos.z + 1),
                    east: new Vec3(doorPos.x + 1, doorPos.y, doorPos.z),
                    west: new Vec3(doorPos.x - 1, doorPos.y, doorPos.z)
                }
                
                // Find closest valid approach position
                const botPos = bot.entity.position
                let bestDistance = Infinity
                let approachPos
                
                Object.entries(positions).forEach(([dir, pos]) => {
                    const distance = botPos.distanceTo(pos)
                    logToFile(`Distance to ${dir} approach: ${distance.toFixed(2)}`, 'MOVEMENT')
                    if (distance < bestDistance) {
                        bestDistance = distance
                        approachPos = pos
                    }
                })
                
                // Move to approach position and face door
                logToFile(`Moving to approach position: x=${approachPos.x}, y=${approachPos.y}, z=${approachPos.z}`, 'MOVEMENT')
                await bot.pathfinder.goto(new goals.GoalNear(approachPos.x, approachPos.y, approachPos.z, 1))
                await bot.lookAt(doorPos, true)  // true parameter ensures bot looks at exact position
                logToFile('Positioned and facing door', 'MOVEMENT')
                
                // Check door state before interacting
                const doorState = door.getProperties()
                if (doorState.open === 'false') {  // Only open if explicitly closed
                    logToFile('Door is closed, opening...', 'INTERACTION')
                    await bot.activateBlock(door)
                    await new Promise(resolve => setTimeout(resolve, 500))  // Wait for door animation
                    
                    // Verify door opened
                    const newState = door.getProperties()
                    if (newState.open === 'false') {
                        logToFile('Door failed to open!', 'ERROR')
                        bot.chat("The door didn't open!")
                        return
                    }
                } else {
                    logToFile('Door is already open, proceeding through', 'INTERACTION')
                }
                
                // Calculate position on other side of door
                const throughPos = new Vec3(
                    doorPos.x + (facing === 'east' ? 2 : facing === 'west' ? -2 : 0),
                    doorPos.y,
                    doorPos.z + (facing === 'south' ? 2 : facing === 'north' ? -2 : 0)
                )
                
                // Move through doorway while maintaining forward orientation
                logToFile('Moving through doorway...', 'MOVEMENT')
                await bot.lookAt(throughPos, true)  // Look where we're going
                await bot.pathfinder.goto(new goals.GoalNear(throughPos.x, throughPos.y, throughPos.z, 1))
                
                // Log final position
                logToFile(`Final position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                logToFile('=== Door Traversal Complete ===', 'SUCCESS')
                bot.chat('Made it through the door!')
                
            } catch (err) {
                bot.chat("I had trouble with the door!")
                logToFile(`Door traversal error: ${err.message}`, 'ERROR')
                logToFile(`Error stack: ${err.stack}`, 'ERROR')
                bot.pathfinder.stop()
                bot.clearControlStates()
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
                // Log initial positions
                logToFile(`Initial bot position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                logToFile(`Door position: x=${door.position.x}, y=${door.position.y}, z=${door.position.z}`, 'MOVEMENT')
                logToFile(`Initial door state: ${JSON.stringify(door.getProperties())}`, 'STATE')
                
                // Step 1: Initial approach
                logToFile('Step 1: Moving to initial door position', 'MOVEMENT')
                await bot.pathfinder.goto(new goals.GoalNear(door.position.x, door.position.y, door.position.z, 2))
                logToFile(`Approach position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                
                // Step 2: Turn 180°
                bot.chat('Turning around...')
                logToFile('Step 2: Turning 180 degrees', 'MOVEMENT')
                const initialYaw = bot.entity.yaw
                await bot.look(initialYaw + Math.PI, bot.entity.pitch)
                logToFile(`Yaw changed from ${initialYaw.toFixed(2)} to ${bot.entity.yaw.toFixed(2)}`, 'MOVEMENT')
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 3: Back up 3 blocks
                bot.chat('Backing up...')
                logToFile('Step 3: Backing up 3 blocks', 'MOVEMENT')
                bot.setControlState('back', true)
                await new Promise(resolve => setTimeout(resolve, 1500))
                bot.setControlState('back', false)
                logToFile(`Position after backup: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 4: Turn to face door
                bot.chat('Turning to face door...')
                logToFile('Step 4: Turning to face door', 'MOVEMENT')
                await bot.look(bot.entity.yaw + Math.PI, bot.entity.pitch)
                logToFile(`Final facing yaw: ${bot.entity.yaw.toFixed(2)}`, 'MOVEMENT')
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 5: Open door
                bot.chat('Opening door...')
                logToFile('Step 5: Opening door', 'INTERACTION')
                const doorStateBefore = door.getProperties()
                logToFile(`Door state before opening: ${JSON.stringify(doorStateBefore)}`, 'STATE')
                await bot.activateBlock(door)
                const doorStateAfter = door.getProperties()
                logToFile(`Door state after opening: ${JSON.stringify(doorStateAfter)}`, 'STATE')
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Step 6: Walk through
                bot.chat('Walking through door...')
                logToFile('Step 6: Walking through doorway', 'MOVEMENT')
                bot.setControlState('forward', true)
                await new Promise(resolve => setTimeout(resolve, 2000))
                bot.setControlState('forward', false)
                logToFile(`Final position: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`, 'MOVEMENT')
                
                bot.chat('Manual door traversal complete!')
                logToFile('=== Manual Door Traversal Complete ===', 'SUCCESS')
                
            } catch (err) {
                bot.chat('Error during manual traversal!')
                logToFile(`Manual traversal error: ${err.message}`, 'ERROR')
                logToFile(`Error stack: ${err.stack}`, 'ERROR')
                bot.clearControlStates()
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
}

// Export both the plugin function and logging function
module.exports = {
    pathfinderdoor: inject,
    logToFile: logToFile
} 