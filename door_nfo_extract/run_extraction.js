const mineflayer = require('mineflayer')
const fs = require('fs')
const path = require('path')
const doorExtract = require('./door_nfo_extract.js')

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, 'logs')
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir)
}

// Backup existing log file if it exists
const logFile = path.join(logDir, 'door-interact.log')
if (fs.existsSync(logFile)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = path.join(logDir, `door-interact.${timestamp}.backup.log`)
    fs.copyFileSync(logFile, backupFile)
    console.log(`Backed up existing log to: ${backupFile}`)
    
    // Clear the current log file
    fs.writeFileSync(logFile, '')
    console.log('Cleared current log file')
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