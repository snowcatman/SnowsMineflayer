// Import required libraries
const mineflayer = require('mineflayer')                             // Import the Mineflayer library for bot creation
const { pathfinder, Movements, goals: { GoalNear, GoalBlock } } = require('mineflayer-pathfinder')  // Import pathfinding tools
const { pathfinderdoor, logToFile } = require('./mineflayer-pathfinderdoor-interact')  // Import door handling and logging
const Vec3 = require('vec3')                                         // Import Vec3 for 3D position calculations
const fs = require('fs')                                             // Import file system for logging
const path = require('path')                                         // Import path for file path handling
const { aggregateLogs, watchLogs } = require('./AI/log-aggregator')  // Import log aggregator functions

// Initialize log watching
watchLogs()

// Create bot instance
const bot = mineflayer.createBot({
    host: 'localhost',
    username: 'Door-Bot',
    port: 25565,
    auth: 'offline'
})

// Load plugins
bot.loadPlugin(pathfinder)
bot.loadPlugin(pathfinderdoor)  // Load our door handling plugin

// Initialize mcData
let mcData
bot.on('inject_allowed', () => {
    mcData = require('minecraft-data')(bot.version)
})

// Event handlers
bot.on('spawn', () => {
    console.log('Bot spawned')
    bot.chat('Door-Bot is online!')
    aggregateLogs()
})

bot.on('error', (err) => {
    console.log('Bot error:', err)
    aggregateLogs()
})

bot.on('end', () => {
    console.log('Bot disconnected')
    aggregateLogs()
})

// Chat command handler
bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    
    switch(message) {
        case 'hello':
            bot.chat('Hi!')
            break
            
        case 'stop':
            bot.chat('I will stop now!!')
            bot.pathfinder.stop()
            bot.clearControlStates()
            break

        case 'come':
            const player = bot.players[username]
            if (!player || !player.entity) {
                bot.chat("I can't see you!")
                return
            }
            bot.chat('Coming to you!')
            bot.pathfinder.goto(new GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 2))
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
                await bot.pathfinder.goto(new GoalNear(bedToSleep.position.x, bedToSleep.y, bedToSleep.position.z, 2))
                await bot.sleep(bedToSleep)
                bot.chat('Good night!')
            } catch (err) {
                bot.chat("I can't sleep right now!")
                console.log('Sleep error:', err)
            }
            break

        // Use door plugin functions for door commands
        case 'gotodoor':
        case 'gothroughdoor':
        case 'gothroughdoormanual':
            if (bot.doorCommands[message]) {
                bot.doorCommands[message]()
            }
            break

        case 'quit':
            bot.chat('Goodbye!')
            logToFile('=== Starting Bot Shutdown Sequence ===', 'INFO')
            logToFile('Quit command received from user: ' + username, 'INFO')
            
            try {
                bot.pathfinder.stop()
                bot.clearControlStates()
                logToFile('Stopped pathfinding and cleared controls', 'INFO')
                
                bot.quit('Shutting down cleanly')
                logToFile('Disconnected from server', 'INFO')
                
                logToFile('=== Bot Shutdown Complete ===', 'INFO')
                console.log('Bot process ending by quit command')
                
                setTimeout(() => {
                    process.exit(0)
                }, 1000)
            } catch (err) {
                logToFile(`Error during shutdown: ${err.message}`, 'ERROR')
                console.error('Error during shutdown:', err)
                process.exit(1)
            }
            break

        case 'bothelp':
            bot.chat('Available commands:')
            logToFile('=== Help Command Requested ===', 'INFO')
            const commands = {
                'hello': 'Basic greeting test',
                'stop': 'Emergency stop all movement',
                'come': 'Bot comes to player position',
                'gotobed': 'Find and move to nearest bed',
                'sleep': 'Find bed and sleep in it',
                'gotodoor': 'Move to and test door interaction',
                'gothroughdoor': 'Navigate through door using pathfinder',
                'gothroughdoormanual': 'Manual step-by-step door traversal',
                'quit': 'Shut down the bot',
                'bothelp': 'Show this help message'
            }
            
            // Send commands in groups
            const commandGroups = []
            let currentGroup = []
            Object.entries(commands).forEach(([cmd, desc]) => {
                currentGroup.push(`${cmd}: ${desc}`)
                if (currentGroup.length === 3) {
                    commandGroups.push(currentGroup)
                    currentGroup = []
                }
            })
            if (currentGroup.length > 0) {
                commandGroups.push(currentGroup)
            }
            
            commandGroups.forEach((group, index) => {
                setTimeout(() => {
                    bot.chat(group.join(' | '))
                }, index * 1500)
            })
            
            logToFile('Help command executed', 'INFO')
            break
    }
})