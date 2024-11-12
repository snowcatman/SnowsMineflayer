const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const fs = require('fs')
const path = require('path')

function logToFile(message) {
    const logMessage = `[${new Date().toISOString()}] [DoorInteract] ${message}\n`
    console.log(logMessage)
    fs.appendFileSync(path.join('logs', 'door-interact.log'), logMessage)
}

function inject(bot) {
    // Force door interaction to be enabled
    const movements = new Movements(bot)
    movements.canOpenDoors = true
    
    logToFile('Door interaction plugin loaded')
    logToFile('canOpenDoors set to: true')

    bot.on('blockInteract', (block) => {
        if (block.name.includes('door')) {
            logToFile(`Interacting with door at: x=${block.position.x}, y=${block.position.y}, z=${block.position.z}`)
            logToFile(`Door type: ${block.name}`)
            logToFile(`Door state: ${JSON.stringify(block.getProperties())}`)
        }
    })

    bot.on('move', () => {
        const currentBlock = bot.blockAt(bot.entity.position)
        if (currentBlock && currentBlock.name.includes('door')) {
            logToFile(`Bot position in door: x=${bot.entity.position.x.toFixed(2)}, y=${bot.entity.position.y.toFixed(2)}, z=${bot.entity.position.z.toFixed(2)}`)
        }
    })
}

module.exports = {
    pathfinderdoor: inject
} 