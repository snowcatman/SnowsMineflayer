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

    // Monitor ALL door state changes
    bot.on('blockUpdate', (oldBlock, newBlock) => {
        if (oldBlock?.name?.includes('door') || newBlock?.name?.includes('door')) {
            logToFile('=== Door State Change Event ===', 'DETECTION')
            
            // Get current time for timing reference
            const timestamp = new Date().toISOString()
            
            // Log all nearby entities with more detail
            const nearbyEntities = Object.values(bot.entities)
            logToFile('Entities at time of door state change:', 'DETECTION')
            nearbyEntities.forEach(entity => {
                if (newBlock) {
                    const distance = entity.position.distanceTo(newBlock.position)
                    logToFile(`Entity: ${entity.name || entity.username || 'unknown'}`, 'DETECTION')
                    logToFile(`Type: ${entity.type}`, 'DETECTION')
                    logToFile(`Distance: ${distance.toFixed(2)} blocks`, 'DETECTION')
                    logToFile(`Position: x=${entity.position.x.toFixed(2)}, y=${entity.position.y.toFixed(2)}, z=${entity.position.z.toFixed(2)}`, 'DETECTION')
                }
            })
            
            // Log detailed door state changes
            if (oldBlock?.name?.includes('door')) {
                const oldProps = oldBlock.getProperties()
                logToFile('Previous door state:', 'DETECTION')
                logToFile(`Time: ${timestamp}`, 'DETECTION')
                logToFile(`Position: x=${oldBlock.position.x}, y=${oldBlock.position.y}, z=${oldBlock.position.z}`, 'DETECTION')
                logToFile(`Type: ${oldBlock.name}`, 'DETECTION')
                logToFile(`Properties: ${JSON.stringify(oldProps)}`, 'DETECTION')
            }
            
            if (newBlock?.name?.includes('door')) {
                const newProps = newBlock.getProperties()
                logToFile('New door state:', 'DETECTION')
                logToFile(`Time: ${timestamp}`, 'DETECTION')
                logToFile(`Position: x=${newBlock.position.x}, y=${newBlock.position.y}, z=${newBlock.position.z}`, 'DETECTION')
                logToFile(`Type: ${newBlock.name}`, 'DETECTION')
                logToFile(`Properties: ${JSON.stringify(newProps)}`, 'DETECTION')
            }

            // Log if this was a bot interaction or external
            const botDistance = bot.entity.position.distanceTo(newBlock.position)
            logToFile(`Bot distance to door: ${botDistance.toFixed(2)} blocks`, 'DETECTION')
            logToFile(`Interaction likely by: ${botDistance <= 4 ? 'bot' : 'other entity'}`, 'DETECTION')

            logToFile('=== End Door State Change Event ===', 'DETECTION')
        }
    })
}

// Export both the plugin function and logging function
module.exports = {
    pathfinderdoor: inject,
    logToFile: logToFile
} 