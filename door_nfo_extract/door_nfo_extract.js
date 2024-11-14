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
        const version = bot.version
        const data = mcData(version)
        
        logToFile(`Bot version: ${version}`, 'INFO')
        logToFile(`Loading data for version ${version}`, 'INFO')
        
        // Create a registry object to store extracted data
        const extractedRegistry = {
            doors: {},
            trapdoors: {},
            metadata: {
                version: version,
                extractionDate: new Date().toISOString(),
                totalDoors: 0,
                totalTrapdoors: 0
            }
        }

        // Get all door and trapdoor blocks
        const doorBlocks = Object.values(data.blocks)
            .filter(block => block.name.includes('door'))
        
        logToFile(`Found ${doorBlocks.length} door/trapdoor blocks`, 'INFO')
        
        // Process each door/trapdoor
        doorBlocks.forEach(block => {
            const isTrapdoor = block.name.includes('trapdoor')
            const category = isTrapdoor ? 'trapdoors' : 'doors'
            
            // Extract detailed block information
            const blockInfo = {
                id: block.id,
                displayName: block.displayName,
                name: block.name,
                hardness: block.hardness,
                resistance: block.resistance,
                diggable: block.diggable,
                material: block.material,
                transparent: block.transparent,
                emitLight: block.emitLight,
                filterLight: block.filterLight,
                boundingBox: block.boundingBox,
                states: block.states,
                defaultState: block.defaultState,
                minStateId: block.minStateId,
                maxStateId: block.maxStateId,
                drops: block.drops,
                stackSize: block.stackSize
            }

            // Store in registry
            extractedRegistry[category][block.name] = blockInfo

            // Update counts
            if (isTrapdoor) {
                extractedRegistry.metadata.totalTrapdoors++
            } else {
                extractedRegistry.metadata.totalDoors++
            }

            // Log detailed information
            logToFile(`=== ${block.displayName} Properties ===`, 'INFO')
            Object.entries(blockInfo).forEach(([key, value]) => {
                if (value !== undefined) {
                    logToFile(`${key}: ${JSON.stringify(value)}`, 'INFO')
                }
            })
        })

        // Save the complete registry to a JSON file for reference
        const registryPath = path.join('extracted_registry.json')
        fs.writeFileSync(registryPath, JSON.stringify(extractedRegistry, null, 2))
        logToFile(`Saved complete registry to ${registryPath}`, 'INFO')

        // Test door interaction capabilities
        bot.on('blockInteract', (block) => {
            if (block.name.includes('door')) {
                logToFile('=== Door Interaction Event ===', 'INTERACTION')
                logToFile(`Block: ${block.name}`, 'INTERACTION')
                logToFile(`Position: ${JSON.stringify(block.position)}`, 'INTERACTION')
                logToFile(`State ID: ${block.stateId}`, 'INTERACTION')
                
                // Try to get current state values
                if (block.getProperties) {
                    const properties = block.getProperties()
                    logToFile(`Current Properties: ${JSON.stringify(properties)}`, 'INTERACTION')
                }
            }
        })

        logToFile('Door information extraction complete', 'INFO')
        logToFile(`Total doors found: ${extractedRegistry.metadata.totalDoors}`, 'INFO')
        logToFile(`Total trapdoors found: ${extractedRegistry.metadata.totalTrapdoors}`, 'INFO')
    })
}

module.exports = inject