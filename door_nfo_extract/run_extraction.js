const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')
const doorExtract = require('./door_nfo_extract.js')

// Create logs directory in door_nfo_extract folder if it doesn't exist
const logDir = path.join(__dirname, 'logs')
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir)
}

// Create bot instance
const bot = mineflayer.createBot({
    host: 'localhost',
    username: 'DoorInfoBot',
    version: '1.19.2',
    port: 25565,
    auth: 'offline'
})

// Load our door extraction plugin
bot.loadPlugin(doorExtract)

// Handle bot shutdown
function cleanup() {
    console.log('Shutting down bot...')
    bot.end()
    setTimeout(() => {
        process.exit(0)
    }, 1000)
}

// Set timeout to end bot after gathering info
setTimeout(cleanup, 10000)  // Shutdown after 10 seconds

// Handle interrupts
process.on('SIGINT', cleanup) 