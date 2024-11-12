console.log('Bot script starting...')

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear, GoalBlock } } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const fs = require('fs')
const path = require('path')

function logToFile(message) {
    const logMessage = `[${new Date().toISOString()}] ${message}\n`
    console.log(message)
    fs.appendFileSync(path.join('logs', 'bot-latest.log'), logMessage)
}

function logPosition(bot, prefix = 'Position') {
    const pos = bot.entity.position
    logToFile(`${prefix}: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`)
}

function startBot() {
    logToFile('=== BOT STARTUP SEQUENCE ===')
    logToFile('Starting countdown before connection attempt...')
    
    let countdown = 10
    const timer = setInterval(() => {
        logToFile(`Connecting in ${countdown} seconds...`)
        countdown--
        if (countdown <= 0) {
            clearInterval(timer)
            createBot()
        }
    }, 1000)
}

function createBot() {
    logToFile('Attempting to connect to Minecraft server...')
    
    const bot = mineflayer.createBot({
        host: 'localhost',
        username: 'DoorBot_AI',
        port: 25565,
        auth: 'offline',
        version: '1.19.2'
    })

    bot.loadPlugin(pathfinder)

    bot.once('spawn', () => {
        logToFile('Bot has spawned in the world!')
        bot.chat('DoorBot_AI is now online and ready!')
        const mcData = require('minecraft-data')(bot.version)
        const movements = new Movements(bot, mcData)
        
        movements.canOpenDoors = true
        movements.allowFreeMotion = true
        movements.blocksCantBreak = new Set()
        movements.maxDropDown = 1
        movements.dontCreateFlow = true
        
        // Prevent breaking any blocks
        Object.keys(mcData.blocksByName).forEach(blockName => {
            movements.blocksCantBreak.add(mcData.blocksByName[blockName].id)
        })
        
        movements.allowParkour = false
        movements.canWalkOnWater = false
        movements.scafoldingBlocks = []
        
        bot.pathfinder.setMovements(movements)
        logToFile('Pathfinding configuration complete')
    })

    bot.on('login', () => {
        logToFile('Successfully logged into server!')
    })

    bot.on('error', (err) => {
        logToFile(`Connection error: ${err.message}`)
        setTimeout(startBot, 5000)
    })

    bot.on('end', () => {
        logToFile('Connection ended - attempting to reconnect...')
        setTimeout(startBot, 5000)
    })

    async function jumpCommand(seconds = 3) {
        try {
            logToFile('=== Jump Sequence Start ===')
            logPosition(bot, 'Before jump')
            bot.setControlState('jump', true)
            await new Promise(resolve => setTimeout(resolve, seconds * 1000))
            bot.setControlState('jump', false)
            logPosition(bot, 'After jump')
            logToFile('=== Jump Sequence Complete ===')
        } catch (err) {
            logToFile(`ERROR in jumpCommand: ${err.stack || err}`)
            bot.setControlState('jump', false)
        }
    }

    async function bedCommand() {
        try {
            logToFile('=== Bed Sequence Start ===')
            logPosition(bot, 'Starting position')
            
            const bed = bot.findBlock({
                matching: block => block.name.includes('bed'),
                maxDistance: 50
            })
            
            if (!bed) {
                logToFile('No bed found within range')
                bot.chat("Can't find any beds!")
                return false
            }
            
            logToFile(`Found bed at: x=${bed.position.x}, y=${bed.position.y}, z=${bed.position.z}`)
            bot.chat('Going to bed...')
            
            // Simpler bed approach
            try {
                // Get near bed first
                await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2))
                logToFile('Near bed')
                
                // Jump and move onto bed
                bot.setControlState('jump', true)
                await new Promise(resolve => setTimeout(resolve, 250))
                await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y + 0.5, bed.position.z, 0.5))
                bot.setControlState('jump', false)
                
                logPosition(bot, 'On bed')
                return true
            } catch (moveError) {
                logToFile(`Movement error: ${moveError}`)
                bot.setControlState('jump', false)
                return false
            }
        } catch (err) {
            logToFile(`CRITICAL ERROR in bedCommand: ${err.stack || err}`)
            bot.chat('Sorry, something went wrong!')
            return false
        }
    }

    async function doorCommand() {
        try {
            logToFile('=== Door Sequence Start ===')
            logPosition(bot, 'Starting position')
            
            const door = bot.findBlock({
                matching: block => block.name.includes('door'),
                maxDistance: 50
            })
            
            if (!door) {
                logToFile('No door found within range')
                bot.chat("Can't find any doors!")
                return false
            }
            
            // Get door properties
            const blockData = door.getProperties()
            logToFile(`Door data: ${JSON.stringify(blockData)}`)
            
            // Simpler door approach
            try {
                // Get in front of door
                await bot.pathfinder.goto(new GoalNear(door.position.x, door.position.y, door.position.z, 2))
                logToFile('At door position')
                
                // Open door
                await bot.activateBlock(door)
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Simple forward movement through door
                bot.setControlState('forward', true)
                bot.setControlState('sprint', false)
                await new Promise(resolve => setTimeout(resolve, 1500))
                bot.setControlState('forward', false)
                
                logPosition(bot, 'After door movement')
                return true
            } catch (moveError) {
                logToFile(`Movement error: ${moveError}`)
                bot.setControlState('forward', false)
                return false
            }
        } catch (err) {
            logToFile(`CRITICAL ERROR in doorCommand: ${err.stack || err}`)
            bot.chat('Sorry, something went wrong with the door!')
            return false
        }
    }

    async function comeToPlayer(username) {
        try {
            logToFile('=== Come To Player Sequence Start ===')
            logPosition(bot, 'Starting position')
            
            const player = bot.players[username]
            if (!player || !player.entity) {
                logToFile('Player not found or not visible')
                bot.chat("I can't see you!")
                return false
            }
            
            const playerPos = player.entity.position
            logToFile(`Player position: x=${playerPos.x.toFixed(2)}, y=${playerPos.y.toFixed(2)}, z=${playerPos.z.toFixed(2)}`)
            bot.chat('Coming to you!')
            
            try {
                await bot.pathfinder.goto(new GoalNear(playerPos.x, playerPos.y, playerPos.z, 1))
                logPosition(bot, 'Final position')
                bot.chat('Reached you!')
                return true
            } catch (moveError) {
                logToFile(`Movement error: ${moveError}`)
                bot.chat('Having trouble reaching you!')
                return false
            }
        } catch (err) {
            logToFile(`CRITICAL ERROR in comeToPlayer: ${err.stack || err}`)
            bot.chat('Sorry, something went wrong!')
            return false
        }
    }

    async function nudgeMove(direction, distance = 0.5) {
        try {
            logToFile(`=== Nudge Movement: ${direction} ===`)
            logPosition(bot, 'Starting position')
            
            let dx = 0, dz = 0
            switch(direction) {
                case 'forward': dz = -distance; break;
                case 'back': dz = distance; break;
                case 'left': dx = -distance; break;
                case 'right': dx = distance; break;
            }
            
            const startPos = bot.entity.position
            const targetPos = startPos.offset(dx, 0, dz)
            logToFile(`Target position: x=${targetPos.x.toFixed(2)}, y=${targetPos.y.toFixed(2)}, z=${targetPos.z.toFixed(2)}`)
            
            try {
                await bot.pathfinder.goto(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 0.1))
                logPosition(bot, 'Final position')
                return true
            } catch (moveError) {
                logToFile(`Movement error: ${moveError}`)
                return false
            }
        } catch (err) {
            logToFile(`CRITICAL ERROR in nudgeMove: ${err.stack || err}`)
            return false
        }
    }

    bot.on('chat', async (username, message) => {
        if (username === bot.username) return
        logToFile(`Chat command received: ${message} from ${username}`)

        try {
            switch(message) {
                case 'jump':
                    await jumpCommand()
                    break

                case 'gotobed':
                    await bedCommand()
                    break

                case 'gotodoor':
                    await doorCommand()
                    break

                case 'come':
                    await comeToPlayer(username)
                    break

                case 'test':
                    try {
                        bot.chat('Starting test sequence')
                        if (await bedCommand()) {
                            await jumpCommand()
                            if (await doorCommand()) {
                                bot.chat('Walking through door...')
                                await nudgeMove('forward', 2)
                                await doorCommand()
                                if (await bedCommand()) {
                                    await jumpCommand()
                                }
                            }
                        }
                        bot.chat('Test complete!')
                    } catch (err) {
                        logToFile(`Error during test: ${err.stack || err}`)
                        bot.chat('Error during test')
                    }
                    break

                case 'n': await nudgeMove('forward'); break;
                case 's': await nudgeMove('back'); break;
                case 'e': await nudgeMove('right'); break;
                case 'w': await nudgeMove('left'); break;
                case 'ns': await nudgeMove('forward', 0.25); break;
                case 'ss': await nudgeMove('back', 0.25); break;
                case 'es': await nudgeMove('right', 0.25); break;
                case 'ws': await nudgeMove('left', 0.25); break;

                case 'stop':
                    bot.chat('Shutting down!')
                    logToFile('Shutdown command received')
                    setTimeout(() => {
                        bot.end()
                        process.exit(0)
                    }, 1000)
                    break
            }
        } catch (err) {
            logToFile(`CRITICAL ERROR in command handler: ${err.stack || err}`)
            bot.chat('Sorry, something went wrong!')
        }
    })
}

startBot()
