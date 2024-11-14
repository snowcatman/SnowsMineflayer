const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear } = goals
const Vec3 = require('vec3')
const { pathfinderdoor, logToFile, PositionTracker } = require('./mineflayer-pathfinderdoor-interact.js')
const fs = require('fs')
const path = require('path')
const { watchLogs, aggregateLogs } = require('./AI/log-aggregator.js')
const GoalHandler = require('./mpi-pdh-goto.js')

// Add getDoorState function
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

// Add our own logging function for bot-specific logs
function logBotFile(message, type = 'INFO') {
    const logMessage = `[${new Date().toISOString()}] [DoorBot] [${type}] ${message}\n`
    fs.appendFileSync(path.join('logs', 'bot-latest.log'), logMessage)
}

// Add this function near the top with other utility functions
function handleStop(bot) {
    // Clear pathfinding
    bot.pathfinder.stop()
    bot.pathfinder.setGoal(null)
    
    // Clear movement states
    bot.clearControlStates()
    
    // Clear position tracking
    PositionTracker.clearPositions()
    
    // Clear any intervals
    if (bot.followIntervals) {
        bot.followIntervals.forEach(interval => clearInterval(interval))
        bot.followIntervals = []
    }
    
    // Log the stop
    logToFile('Bot stopped - all pathfinding and controls cleared', 'MOVEMENT')
}

// Add this function near other utility functions
function debugDoorPath(start, end) {
    const doors = bot.findBlocks({
        matching: block => block.name.toLowerCase().includes('door'),
        maxDistance: 20,
        count: 5
    })
    
    doors.forEach(doorPos => {
        const door = bot.blockAt(doorPos)
        logToFile(`Door found: ${door.name} at ${doorPos}, state: ${door.getProperties()}`, 'DEBUG')
    })
    
    // Log pathfinding attempt
    logToFile(`Attempting to path from ${start} to ${end}`, 'DEBUG')
}

// Initialize log watching
watchLogs()

// Create bot instance
const bot = mineflayer.createBot({
    host: 'localhost',
    username: 'Door-Bot',
    port: 25565,
    auth: 'offline'
})

// Load plugins FIRST
bot.loadPlugin(pathfinder)
bot.loadPlugin(pathfinderdoor)

// THEN initialize goal handler AFTER pathfinder is loaded
bot.once('spawn', () => {
    // Initialize goal handler after pathfinder is loaded
    const goalHandler = new GoalHandler(bot)
    goalHandler.wrapGoalHandling()
    console.log('\x1b[32m%s\x1b[0m', 'Bot spawned and ready for commands!')
})

// Initialize mcData
let mcData
bot.on('inject_allowed', () => {
    mcData = require('minecraft-data')(bot.version)
})

// Add this function before the event handlers
function logServerTime(bot) {
    const time = bot.time.timeOfDay
    const days = Math.floor(bot.time.age / 24000)
    const isDay = bot.time.isDay
    const phase = isDay ? 'Day' : 'Night'
    
    // Convert ticks to more readable time
    const hours = Math.floor((time + 6000) / 1000) % 24 // Minecraft time offset by 6000
    const minutes = Math.floor((((time + 6000) % 1000) / 1000) * 60)
    
    logToFile(`Server Time:
        Time of Day: ${time} ticks
        Minecraft Time: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}
        Day Number: ${days}
        Phase: ${phase}`, 'TIME')
}

// Add a variable to store the original tracking distance
let originalTrackingDistance = 2;  // Default tracking distance

// Add at the top with other constants
const DOOR_CHECK_COOLDOWN = {
    DURATION: 1000,  // 1 second between checks
    lastCheck: new Map()  // Store last check time for each door
}

// Add at the top with other constants
const LEADER_FOLLOW = {
    MAX_DISTANCE: 4,  // Maximum distance before bot moves to catch up
    MIN_DISTANCE: 2   // Minimum distance to maintain from leader
}

// Add at the top with other constants
const DOOR_INTERACTION = {
    COOLDOWN: 5000,  // .5 seconds between interactions with same door
    lastInteraction: new Map()  // Track last interaction time for each door
}

// Event handlers
bot.on('spawn', () => {
    bot.chat('Door-Bot is online!')
    logServerTime(bot)  // Log initial time
    aggregateLogs()
    
    // Set up periodic time logging (every minute)
    setInterval(() => {
        logServerTime(bot)
    }, 60000)  // Log every minute
})

// Chat command handler
bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    
    // Handle gotodestination with coordinates
    if (message.startsWith('gotodestination ')) {
        const coords = message.split(' ').slice(1)
        if (coords.length === 3) {
            const [x, y, z] = coords.map(Number)
            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                bot.doorCommands.gotodestination(x, y, z)
                return
            }
        }
        bot.chat('Usage: gotodestination <x> <y> <z>')
        return
    }
    
    switch(message) {
        case 'hello':
            bot.chat('Hi!')
            break
            
        case 'come':
            const player = bot.players[username]
            if (!player || !player.entity) {
                bot.chat("I can't see you!")
                return
            }
            bot.chat('Coming to you!')
            debugDoorPath(bot.entity.position, player.entity.position)
            bot.pathfinder.goto(new GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 2))
            break

        case 'stop':
            bot.chat('Stopping!')
            handleStop(bot)  // Use the new handler that includes position clearing
            
            // Restore the original tracking distance
            bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: originalTrackingDistance,  // Restore to original distance
                count: 1
            })
            break

        case 'follow':
            const target = bot.players[username]
            if (!target || !target.entity) {
                bot.chat("I can't see you!")
                return
            }
            bot.chat('Following you! Use "stop" to make me stop.')
            
            // Change tracking distance to 5
            originalTrackingDistance = 2;  // Store the original distance
            const trackingDistance = 5;    // New tracking distance

            // Start following loop
            const followInterval = setInterval(() => {
                if (!bot.players[username]?.entity) {
                    clearInterval(followInterval)
                    return
                }
                
                const playerPos = bot.players[username].entity.position
                const botPos = bot.entity.position
                
                // Only move if we're more than 2 blocks away
                if (botPos.distanceTo(playerPos) > 2) {
                    const doors = bot.findBlocks({
                        matching: block => block.name.toLowerCase().includes('door'),
                        maxDistance: trackingDistance,  // Use the new tracking distance
                        count: 3
                    })
                    
                    // Log nearby doors during following
                    doors.forEach(doorPos => {
                        const door = bot.blockAt(doorPos)
                        const doorState = getDoorState(door)
                        logToFile(`During follow - Door nearby:
                            Position: ${doorPos}
                            State: ${JSON.stringify(doorState)}
                            Distance to player: ${doorPos.distanceTo(playerPos)}
                            Distance to bot: ${doorPos.distanceTo(botPos)}`, 'DEBUG')
                    })
                    
                    bot.pathfinder.setGoal(new GoalNear(playerPos.x, playerPos.y, playerPos.z, 2))
                }
            }, 1000)
            
            // Store interval for cleanup
            bot.followIntervals = bot.followIntervals || []
            bot.followIntervals.push(followInterval)
            break

        case 'gotodoor':
        case 'gothroughdoor':
        case 'gothroughdoormanual':
            if (bot.doorCommands[message]) {
                bot.doorCommands[message]()
            }
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
        case 'bothelp1':
            bot.chat('=== Basic Commands (Page 1/2) ===')
            const basicCommands = {
                'hello': 'Greet the bot',
                'come': 'Bot comes to your location',
                'follow': 'Bot follows you (use stop to end)',
                'leader': 'Bot follows while avoiding obstacles (use stop to end)',
                'stop': 'Stop all bot movement',
                'gotobed': 'Find and move to nearest bed',
                'sleep': 'Find bed and sleep in it',
                'bothelp1': 'Show basic commands',
                'bothelp2': 'Show door commands'
            }
            
            Object.entries(basicCommands).forEach(([cmd, desc], index) => {
                setTimeout(() => {
                    bot.chat(`${cmd} - ${desc}`)
                }, index * 500)
            })
            
            setTimeout(() => {
                bot.chat('Use "bothelp2" for door-related commands')
            }, Object.keys(basicCommands).length * 500)
            break

        case 'bothelp2':
            bot.chat('=== Door Commands (Page 2/2) ===')
            const doorCommands = {
                'gotodoor': 'Find and move to nearest door',
                'gothroughdoor': 'Navigate through nearest door',
                'gothroughdoormanual': 'Step-by-step door traversal',
                'listdoors': 'List all nearby doors and their distances',
                'gotodestination <x> <y> <z>': 'Navigate to coordinates, handling doors along the way',
                'quit': 'Shutdown bot safely'
            }
            
            Object.entries(doorCommands).forEach(([cmd, desc], index) => {
                setTimeout(() => {
                    bot.chat(`${cmd} - ${desc}`)
                }, index * 500)
            })
            
            setTimeout(() => {
                bot.chat('Use "bothelp1" for basic commands')
            }, Object.keys(doorCommands).length * 500)
            break

        case 'leader':
            const leader = bot.players[username]
            if (!leader || !leader.entity) {
                bot.chat("I can't see you!")
                return
            }
            bot.chat('Following your path! Use "stop" to make me stop.')
            
            // Add position tracking alongside existing functionality
            PositionTracker.addPosition(bot.entity.position.clone())
            PositionTracker.addPosition(leader.entity.position.clone())
            logToFile(`Starting position tracking for leader command - Bot at: ${bot.entity.position}, Leader at: ${leader.entity.position}`, 'MOVEMENT')
            
            const recordInterval = setInterval(() => {
                if (!leader.entity) {
                    logToFile('Lost sight of leader, stopping follow', 'WARNING')
                    clearInterval(recordInterval)
                    return
                }
                
                // Only log when actually near doors AND approaching them
                const nearbyDoors = bot.findBlocks({
                    matching: block => block.name.toLowerCase().includes('door'),
                    maxDistance: 5,
                    count: 3
                })
                
                if (nearbyDoors.length > 0) {
                    const closestDoor = bot.blockAt(nearbyDoors[0])
                    const doorId = `${closestDoor.position.x},${closestDoor.position.y},${closestDoor.position.z}`
                    const lastInteractTime = DOOR_INTERACTION.lastInteraction.get(doorId) || 0
                    const timeSinceLastInteract = Date.now() - lastInteractTime
                    
                    if (timeSinceLastInteract > DOOR_INTERACTION.COOLDOWN) {
                        const distanceToLeader = nearbyDoors[0].distanceTo(leader.entity.position)
                        
                        if (distanceToLeader < 3 && !getDoorState(closestDoor)?.isOpen) {
                            DOOR_INTERACTION.lastInteraction.set(doorId, Date.now())
                            logToFile(`Door state during leader follow:
                                Type: ${closestDoor.name}
                                Distance to leader: ${distanceToLeader}
                                Needs interaction: true`, 'INFO')
                        }
                    }
                }
                
                const playerPos = leader.entity.position.clone()
                const botPos = bot.entity.position.clone()
                const distance = botPos.distanceTo(playerPos)
                
                // Check positions behind and in front of player
                const playerDirection = leader.entity.velocity
                const behindPos = playerPos.offset(-playerDirection.x * 2, 0, -playerDirection.z * 2)
                const frontPos = playerPos.offset(playerDirection.x * 2, 0, playerDirection.z * 2)
                
                // Check for obstacles in potential positions
                const checkPosition = (pos) => {
                    const blocks = []
                    for (let y = -1; y <= 2; y++) {
                        for (let x = -1; x <= 1; x++) {
                            for (let z = -1; z <= 1; z++) {
                                const block = bot.blockAt(pos.offset(x, y, z))
                                if (block && !block.boundingBox === 'empty') {
                                    blocks.push(block)
                                }
                            }
                        }
                    }
                    return blocks.length === 0
                }
                
                // Choose best position
                let targetPos
                if (checkPosition(behindPos)) {
                    targetPos = behindPos
                    logToFile('Positioning behind player', 'MOVEMENT')
                } else if (checkPosition(frontPos)) {
                    targetPos = frontPos
                    logToFile('Positioning in front of player', 'MOVEMENT')
                } else {
                    // Find nearest clear position
                    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                        const testPos = playerPos.offset(
                            Math.cos(angle) * 2,
                            0,
                            Math.sin(angle) * 2
                        )
                        if (checkPosition(testPos)) {
                            targetPos = testPos
                            logToFile(`Found clear position at angle ${angle}`, 'MOVEMENT')
                            break
                        }
                    }
                }
                
                if (targetPos && distance > LEADER_FOLLOW.MAX_DISTANCE) {
                    logToFile(`Moving to position: ${JSON.stringify(targetPos)}`, 'MOVEMENT')
                    bot.pathfinder.setGoal(new GoalNear(
                        targetPos.x,
                        targetPos.y,
                        targetPos.z,
                        LEADER_FOLLOW.MIN_DISTANCE
                    ))
                }
            }, 1000)
            
            // Store interval for cleanup
            bot.followIntervals = bot.followIntervals || []
            bot.followIntervals.push(recordInterval)
            break
    }
})

// Add this near your other event handlers
bot.on('path_update', (results) => {
    if (results.status === 'noPath') {
        // Log when pathfinding fails
        logToFile('Pathfinding failed - checking if door is blocking', 'INFO')
        
        // Check if there's a door nearby that might be causing the issue
        const door = bot.findBlock({
            matching: block => {
                return block.name.toLowerCase().includes('door')
            },
            maxDistance: 5
        })
        
        if (door) {
            logToFile(`Found door at ${door.position}, attempting to interact`, 'INFO')
            // You could add custom door handling logic here
        }
    } else if (results.path) {
        // Analyze path for doors
        const pathPoints = results.path
        pathPoints.forEach((point, index) => {
            // Convert point to Vec3 if it isn't already
            const pos = point.constructor.name === 'Vec3' ? point : new Vec3(point.x, point.y, point.z)
            const block = bot.blockAt(pos)
            if (block && block.name.toLowerCase().includes('door')) {
                const doorState = getDoorState(block)
                logToFile(`Path includes door at ${pos}:
                    - Type: ${block.name}
                    - Open: ${doorState.isOpen}
                    - Facing: ${doorState.facing}
                    - Position in path: ${index}/${pathPoints.length}`, 'DEBUG')
            }
        })
    }
})

