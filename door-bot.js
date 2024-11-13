// Import required libraries
const mineflayer = require('mineflayer')                             // Import the Mineflayer library for bot creation
const { pathfinder, Movements, goals: { GoalNear, GoalBlock } } = require('mineflayer-pathfinder')  // Import pathfinding tools
const { pathfinderdoor, logToFile } = require('./mineflayer-pathfinderdoor-interact')  // Import door handling and logging
const Vec3 = require('vec3')                                         // Import Vec3 for 3D position calculations
const fs = require('fs')                                             // Import file system for logging
const path = require('path')                                         // Import path for file path handling
const { aggregateLogs, watchLogs } = require('./AI/log-aggregator')  // Import log aggregator functions

// Initialize log watching before bot creation
watchLogs()  // Start watching log files for changes

// Create bot instance
const bot = mineflayer.createBot({
  host: 'localhost',
  username: 'Door-Bot',
  port: 25565,
  auth: 'offline'
})

// Load pathfinding plugin
bot.loadPlugin(pathfinder)

// Initialize mcData
let mcData
bot.on('inject_allowed', () => {
  mcData = require('minecraft-data')(bot.version)
})

// Add log aggregation to spawn event
bot.on('spawn', () => {                     // Handler for when bot joins the game
    console.log('Bot spawned')
    bot.chat('Door-Bot is online!')         // Announce bot's presence
    aggregateLogs()                         // Aggregate logs on spawn
})

// Add log aggregation to error handler
bot.on('error', (err) => {                  // Handler for bot errors
    console.log('Bot error:', err)          // Log any bot errors
    aggregateLogs()                         // Aggregate logs on error
})

// Add log aggregation to end handler
bot.on('end', () => {                       // Handler for bot disconnection
    console.log('Bot disconnected')         // Log when bot leaves the game
    aggregateLogs()                         // Final log aggregation on disconnect
})

// Farming helper functions
function blockToSow() {
    return bot.findBlock({
        point: bot.entity.position,
        matching: mcData.blocksByName.farmland.id,
        maxDistance: 6,
        useExtraInfo: (block) => {
            const blockAbove = bot.blockAt(block.position.offset(0, 1, 0))
            return !blockAbove || blockAbove.type === 0
        }
    })
}

function blockToHarvest() {
    return bot.findBlock({
        point: bot.entity.position,
        maxDistance: 6,
        matching: (block) => {
            return block && block.type === mcData.blocksByName.wheat.id && block.metadata === 7
        }
    })
}

async function farmingLoop() {
    try {
        while (1) {
            const toHarvest = blockToHarvest()
            if (toHarvest) {
                await bot.dig(toHarvest)
            } else {
                break
            }
        }
        while (1) {
            const toSow = blockToSow()
            if (toSow) {
                await bot.equip(mcData.itemsByName.wheat_seeds.id, 'hand')
                await bot.placeBlock(toSow, new Vec3(0, 1, 0))
            } else {
                break
            }
        }
    } catch (e) {
        console.log(e)
        bot.chat('Error while farming: ' + e.message)
    }
}

// Event handler for chat commands - processes messages from players
bot.on('chat', async (username, message) => {
    if (username === bot.username) return    // Ignore bot's own messages
    
    switch(message) {
        case 'hello':                       // Basic greeting command
            bot.chat('Hi!')
            break
            
        case 'quit':                        // Command to disconnect the bot
            bot.chat('Goodbye!')
            setTimeout(() => {
                bot.end()                   // Disconnect after 1 second delay
            }, 1000)
            break

        case 'stop':                        // Emergency stop command
            bot.chat('I will stop now!!')
            bot.pathfinder.stop()           // Stop any pathfinding movement
            bot.clearControlStates()        // Clear all movement controls (forward, back, etc)
            break

        case 'come':                        // Command to make bot come to player
            const player = bot.players[username]    // Get player object from username
            if (!player || !player.entity) {        // Check if player is visible to bot
                bot.chat("I can't see you!")
                return
            }
            const playerPos = player.entity.position    // Get player's position
            bot.chat('Coming to you!')
            bot.pathfinder.goto(new GoalNear(playerPos.x, playerPos.y, playerPos.z, 2))  // Move to 2 blocks from player
            break

        case 'gotobed':                     // Command to find and move to nearest bed
            const bed = bot.findBlock({
                matching: block => bot.isABed(block),   // Find block that is a bed
                maxDistance: 50                         // Search within 50 blocks
            })
            
            if (!bed) {                     // If no bed found
                bot.chat("I can't find any beds nearby!")
                return
            }
            
            bot.chat('I found a bed! Moving to it...')
            bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2))  // Move to 2 blocks from bed
            break

        case 'sleep':                       // Command to find bed and sleep in it
            const bedToSleep = bot.findBlock({
                matching: block => bot.isABed(block),   // Find block that is a bed
                maxDistance: 50                         // Search within 50 blocks
            })
            
            if (!bedToSleep) {              // If no bed found
                bot.chat("I can't find any beds nearby!")
                return
            }
            
            bot.chat('Going to sleep...')
            try {
                await bot.pathfinder.goto(new GoalNear(bedToSleep.position.x, bedToSleep.y, bedToSleep.position.z, 2))
                await bot.sleep(bedToSleep)  // Attempt to sleep in the bed
                bot.chat('Good night!')
            } catch (err) {
                bot.chat("I can't sleep right now!")
                console.log('Sleep error:', err)        // Log any errors for debugging
            }
            break

        case 'gotodoor':
            // Search for any door block within 50 blocks of the bot
            const door = bot.findBlock({
                matching: block => block.name.includes('door'),
                maxDistance: 50
            })
            
            if (!door) {
                bot.chat("I can't find any doors nearby!")
                return  // Just return, stay ready for next command
            }
            
            bot.chat('I found a door! Moving to interact...')
            try {
                // Get initial door state
                const initialProps = door.getProperties()
                logToFile('=== Door Test Sequence Start ===', 'INFO')
                logToFile(`Initial door state: ${JSON.stringify(initialProps)}`, 'INFO')
                
                // Move to door
                const movements = new Movements(bot)
                movements.canDig = false
                movements.digCost = Infinity
                movements.canOpenDoors = true
                bot.pathfinder.setMovements(movements)
                
                // Calculate approach position based on door facing
                const facing = initialProps.facing
                let approachPos
                switch(facing) {
                    case 'north': approachPos = door.position.offset(0, 0, 1); break
                    case 'south': approachPos = door.position.offset(0, 0, -1); break
                    case 'east': approachPos = door.position.offset(-1, 0, 0); break
                    case 'west': approachPos = door.position.offset(1, 0, 0); break
                }
                
                // Move to approach position
                await bot.pathfinder.goto(new GoalNear(approachPos.x, approachPos.y, approachPos.z, 1))
                
                // Start door state monitoring
                let cycleCount = 0
                const doorInterval = setInterval(async () => {
                    if (cycleCount >= 5) {  // Do 5 cycles
                        clearInterval(doorInterval)
                        logToFile('=== Door Test Complete ===', 'INFO')
                        bot.chat('Door testing complete, ready for next command!')
                        return
                    }
                    
                    try {
                        // Log current state before interaction
                        const currentProps = door.getProperties()
                        logToFile(`Cycle ${cycleCount + 1}: Current state: ${JSON.stringify(currentProps)}`, 'INFO')
                        
                        // Interact with door
                        await bot.activateBlock(door)
                        
                        // Log new state after interaction
                        const newProps = door.getProperties()
                        logToFile(`Cycle ${cycleCount + 1}: New state: ${JSON.stringify(newProps)}`, 'INFO')
                        
                        cycleCount++
                    } catch (err) {
                        logToFile(`Error in cycle ${cycleCount}: ${err.message}`, 'ERROR')
                    }
                }, 1000)  // Test every second
                
            } catch (err) {
                bot.chat("I had trouble with the door!")
                logToFile(`Door test error: ${err.message}`, 'ERROR')
                bot.pathfinder.stop()  // Stop pathfinding but don't quit
            }
            break

        case 'gotocomposter':
            const composter = bot.findBlock({
                matching: block => block.name === 'composter',  // Find composter block
                maxDistance: 50                                 // Search within 50 blocks
            })
            
            if (!composter) {               // If no composter found
                bot.chat("I can't find any composters nearby!")
                return
            }
            
            bot.chat('I found a composter! Moving to it...')
            try {
                await bot.pathfinder.goto(new GoalNear(composter.position.x, composter.position.y, composter.position.z, 2))
                bot.chat('Made it to the composter!')
            } catch (err) {
                bot.chat("I couldn't reach the composter!")
                console.log('Composter movement error:', err)   // Log any errors for debugging
            }
            break

        case 'farm':                        // Command to start complete farming cycle
            bot.chat('Starting farming sequence...')
            try {
                await farmingLoop()          // Execute the farming loop function
                bot.chat('Farming cycle complete!')
            } catch (err) {
                bot.chat('Error while farming!')
                console.log('Farming error:', err)      // Log any errors for debugging
            }
            break

        case 'harvest':                     // Command to harvest ready wheat
            bot.chat('Looking for wheat to harvest...')
            try {
                const toHarvest = blockToHarvest()      // Find fully grown wheat
                if (toHarvest) {
                    await bot.dig(toHarvest)            // Break the wheat block
                    bot.chat('Harvested wheat!')
                } else {
                    bot.chat('No ready wheat found nearby!')
                }
            } catch (err) {
                bot.chat('Error while harvesting!')
                console.log('Harvest error:', err)      // Log any errors for debugging
            }
            break

        case 'plant':                       // Command to plant wheat seeds
            bot.chat('Looking for farmland to plant...')
            try {
                const toSow = blockToSow()              // Find empty farmland
                if (toSow) {
                    await bot.equip(mcData.itemsByName.wheat_seeds.id, 'hand')  // Equip seeds
                    await bot.placeBlock(toSow, new Vec3(0, 1, 0))             // Plant seeds
                    bot.chat('Planted wheat seeds!')
                } else {
                    bot.chat('No empty farmland found nearby!')
                }
            } catch (err) {
                bot.chat('Error while planting!')
                console.log('Planting error:', err)     // Log any errors for debugging
            }
            break

        case 'gothroughdoor':
            try {
                // Find the nearest door within 50 blocks
                const targetDoor = bot.findBlock({
                    matching: block => block.name.includes('door'),
                    maxDistance: 50
                })
                
                if (!targetDoor) {
                    bot.chat("I can't find any doors nearby!")
                    return
                }
                
                bot.chat('I found a door! Moving through it...')
                
                // Configure pathfinder to handle doors
                const movements = new Movements(bot)
                movements.canOpenDoors = true                   // Tell pathfinder it can plan paths through doors
                bot.pathfinder.setMovements(movements)
                
                // Get door properties for navigation
                const doorProps = targetDoor.getProperties()
                const facing = doorProps.facing || 'north'      // Get door orientation
                
                // Calculate positions for two-step movement
                let approachPos, throughPos
                switch(facing) {
                    case 'north':
                        approachPos = targetDoor.position.offset(0, 0, 1)    // Position in front of door
                        throughPos = targetDoor.position.offset(0, 0, -2)    // Position beyond door
                        break
                    case 'south':
                        approachPos = targetDoor.position.offset(0, 0, -1)
                        throughPos = targetDoor.position.offset(0, 0, 2)
                        break
                    case 'east':
                        approachPos = targetDoor.position.offset(-1, 0, 0)
                        throughPos = targetDoor.position.offset(2, 0, 0)
                        break
                    case 'west':
                        approachPos = targetDoor.position.offset(1, 0, 0)
                        throughPos = targetDoor.position.offset(-2, 0, 0)
                        break
                }
                
                try {
                    // Step 1: Move to door
                    logToFile('Moving to door approach position', 'MOVEMENT')
                    await bot.pathfinder.goto(new GoalNear(approachPos.x, approachPos.y, approachPos.z, 1))
                    
                    // Step 2: Interact with door
                    logToFile('Attempting to open door', 'INTERACTION')
                    await bot.activateBlock(targetDoor)         // Explicitly open/close the door
                    
                    // Verify door is open
                    const updatedDoorProps = targetDoor.getProperties()
                    if (!updatedDoorProps.open) {
                        bot.chat("The door didn't open!")
                        logToFile('Door failed to open', 'WARNING')
                        return
                    }
                    
                    // Small delay to allow door animation
                    await new Promise(resolve => setTimeout(resolve, 500))  // Increase delay
                    
                    // Step 3: Move through doorway
                    logToFile('Moving through doorway', 'MOVEMENT')
                    await bot.pathfinder.goto(new GoalNear(throughPos.x, throughPos.y, throughPos.z, 1))
                    
                    // Verify success
                    const finalDistance = bot.entity.position.distanceTo(targetDoor.position)
                    if (finalDistance > 2) {
                        bot.chat('Successfully moved through the door!')
                        logToFile('Door traversal successful', 'SUCCESS')
                    } else {
                        bot.chat("I might be stuck in the doorway...")
                        logToFile('Possible doorway obstruction', 'WARNING')
                    }
                    
                } catch (moveError) {
                    bot.chat("I had trouble with the door, but I'll keep trying!")
                    logToFile(`Movement error: ${moveError.message}`, 'ERROR')
                    bot.pathfinder.stop()
                    bot.clearControlStates()
                    return
                }
                
            } catch (err) {
                bot.chat("I had trouble with the door, but I'm still here!")
                logToFile(`Door navigation error: ${err.message}`, 'ERROR')
                bot.pathfinder.stop()
            }
            break
    }
})