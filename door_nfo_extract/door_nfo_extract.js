const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const registry = require('prismarine-registry')
const mcData = require('minecraft-data')
const fs = require('fs')
const path = require('path')
const Vec3 = require('vec3')

function logToFile(message, type = 'INFO') {
    const logMessage = `[${new Date().toISOString()}] [DoorInteract] [${type}] ${message}\n`
    console.log(logMessage)
    fs.appendFileSync(path.join('logs', 'door-interact.log'), logMessage)
}

function inject(bot) {
    bot.once('spawn', () => {
        // Get minecraft data with explicit version string
        const version = bot.version
        const data = mcData(version)
        const mcRegistry = registry(version)  // Initialize registry with version
        
        // Log what we're working with
        logToFile(`Bot version: ${version}`, 'INFO')
        logToFile(`Loading data for version ${version}`, 'INFO')
        
        // Get block states directly from mcData
        const doorBlocks = Object.values(data.blocks)
            .filter(block => block.name.includes('door'))
        
        logToFile(`Found ${doorBlocks.length} door blocks`, 'INFO')
        
        // Log door block information
        doorBlocks.forEach(door => {
            logToFile(`=== Door Type: ${door.name} ===`, 'INFO')
            logToFile(`ID: ${door.id}`, 'INFO')
            logToFile(`Display Name: ${door.displayName}`, 'INFO')
            if (door.states) {
                logToFile(`States: ${JSON.stringify(door.states)}`, 'INFO')
            }
            if (door.boundingBox) {
                logToFile(`Bounding Box: ${door.boundingBox}`, 'INFO')
            }
            logToFile('=== End Door Type ===', 'INFO')
        })

        // Get door shapes from registry if available
        try {
            const oakDoorId = data.blocksByName.oak_door.id
            const doorBlock = data.blocks[oakDoorId]
            
            if (doorBlock) {
                logToFile('=== Door Block Data ===', 'INFO')
                logToFile(`Block ID: ${doorBlock.id}`, 'INFO')
                logToFile(`Name: ${doorBlock.name}`, 'INFO')
                logToFile(`Display Name: ${doorBlock.displayName}`, 'INFO')
                
                // Get states from the block data
                if (doorBlock.states) {
                    logToFile('=== Door States ===', 'INFO')
                    doorBlock.states.forEach(state => {
                        logToFile(`State Name: ${state.name}`, 'INFO')
                        logToFile(`Possible Values: ${JSON.stringify(state.values)}`, 'INFO')
                        logToFile(`Default Value: ${state.default}`, 'INFO')
                    })
                }
                
                // Get properties if available
                if (doorBlock.properties) {
                    logToFile('=== Door Properties ===', 'INFO')
                    logToFile(JSON.stringify(doorBlock.properties, null, 2), 'INFO')
                }
                
                // Get bounding box
                if (doorBlock.boundingBox) {
                    logToFile('=== Door Bounding Box ===', 'INFO')
                    logToFile(`Type: ${doorBlock.boundingBox}`, 'INFO')
                }
            }
        } catch (err) {
            logToFile(`Error getting door data: ${err.message}`, 'WARNING')
        }

        logToFile('Door information extraction complete', 'INFO')
    })

    bot.on('blockInteract', (block) => {
        if (block.name.includes('door')) {
            logToFile('=== Door Interaction Event ===', 'INTERACTION')
            const doorState = bot.doorStates[block.name]
            if (doorState) {
                logToFile(`Available door states: ${JSON.stringify(doorState)}`, 'INTERACTION')
                logToFile(`Current door state: ${block.stateId}`, 'INTERACTION')
            }
            // ... rest of existing logging ...
        }
    })

    // ... rest of existing code ...
}

module.exports = inject