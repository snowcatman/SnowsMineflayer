// Import required libraries
const mineflayer = require('mineflayer')                             // Import the Mineflayer library for bot creation
const { pathfinder, Movements, goals: { GoalNear, GoalBlock } } = require('mineflayer-pathfinder')  // Import pathfinding tools
const { pathfinderdoor } = require('./mineflayer-pathfinderdoor-interact')  // Import our door handling
const Vec3 = require('vec3')                                         // Import Vec3 for 3D position calculations
const fs = require('fs')                                             // Import file system for logging
const path = require('path')                                         // Import path for file path handling


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

// Basic chat command handler
bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    
    switch(message) {
        case 'hello':
            bot.chat('Hi!')
            break
            
        case 'quit':
            bot.chat('Goodbye!')
            setTimeout(() => {
                bot.end()
            }, 1000)
            break

        case 'stop':
            bot.chat('I will stop now!!')
            bot.pathfinder.stop()  // Stop pathfinding movement
            bot.clearControlStates() // Clear any movement controls
            break

        case 'come':
            const player = bot.players[username]
            if (!player || !player.entity) {
                bot.chat("I can't see you!")
                return
            }
            const playerPos = player.entity.position
            bot.chat('Coming to you!')
            bot.pathfinder.goto(new GoalNear(playerPos.x, playerPos.y, playerPos.z, 2))
            break

        case 'gotobed':
            const bed = bot.findBlock({
                matching: block => bot.isABed(block),
                maxDistance: 50
            })
            
            if (!bed) {
                bot.chat("I can't find any beds nearby!")
                return
            }
            
            bot.chat('I found a bed! Moving to it...')
            bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2))
            break

        case 'sleep':
            const bedToSleep = bot.findBlock({
                matching: block => bot.isABed(block),
                maxDistance: 50
            })
            
            if (!bedToSleep) {
                bot.chat("I can't find any beds nearby!")
                return
            }
            
            bot.chat('Going to sleep...')
            try {
                // Move to bed
                await bot.pathfinder.goto(new GoalNear(bedToSleep.position.x, bedToSleep.y, bedToSleep.position.z, 2))
                // Try to sleep
                await bot.sleep(bedToSleep)
                bot.chat('Good night!')
            } catch (err) {
                bot.chat("I can't sleep right now!")
                console.log('Sleep error:', err)
            }
            break

        case 'gotodoor':
            const door = bot.findBlock({
                matching: block => block.name.includes('door'),
                maxDistance: 50
            })
            
            if (!door) {
                bot.chat("I can't find any doors nearby!")
                return
            }
            
            bot.chat('I found a door! Moving to it...')
            try {
                await bot.pathfinder.goto(new GoalNear(door.position.x, door.position.y, door.position.z, 2))
                bot.chat('Made it to the door!')
            } catch (err) {
                bot.chat("I couldn't reach the door!")
                console.log('Door movement error:', err)
            }
            break

        case 'gotocomposter':
            const composter = bot.findBlock({
                matching: block => block.name === 'composter',
                maxDistance: 50
            })
            
            if (!composter) {
                bot.chat("I can't find any composters nearby!")
                return
            }
            
            bot.chat('I found a composter! Moving to it...')
            try {
                await bot.pathfinder.goto(new GoalNear(composter.position.x, composter.position.y, composter.position.z, 2))
                bot.chat('Made it to the composter!')
            } catch (err) {
                bot.chat("I couldn't reach the composter!")
                console.log('Composter movement error:', err)
            }
            break

        case 'farm':
            bot.chat('Starting farming sequence...')
            try {
                await farmingLoop()
                bot.chat('Farming cycle complete!')
            } catch (err) {
                bot.chat('Error while farming!')
                console.log('Farming error:', err)
            }
            break

        case 'harvest':
            bot.chat('Looking for wheat to harvest...')
            try {
                const toHarvest = blockToHarvest()
                if (toHarvest) {
                    await bot.dig(toHarvest)
                    bot.chat('Harvested wheat!')
                } else {
                    bot.chat('No ready wheat found nearby!')
                }
            } catch (err) {
                bot.chat('Error while harvesting!')
                console.log('Harvest error:', err)
            }
            break

        case 'plant':
            bot.chat('Looking for farmland to plant...')
            try {
                const toSow = blockToSow()
                if (toSow) {
                    await bot.equip(mcData.itemsByName.wheat_seeds.id, 'hand')
                    await bot.placeBlock(toSow, new Vec3(0, 1, 0))
                    bot.chat('Planted wheat seeds!')
                } else {
                    bot.chat('No empty farmland found nearby!')
                }
            } catch (err) {
                bot.chat('Error while planting!')
                console.log('Planting error:', err)
            }
            break
    }
})

// Basic event handlers
bot.on('spawn', () => {
    console.log('Bot spawned')
    bot.chat('Door-Bot is online!')
})

bot.on('error', (err) => {
    console.log('Bot error:', err)
})

bot.on('end', () => {
    console.log('Bot disconnected')
}) 