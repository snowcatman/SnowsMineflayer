const fs = require('fs')
const path = require('path')

class ServerTiming {
    constructor() {
        this.logFile = 'logs/server-timing.json'
        this.timings = this.loadTimings()
    }

    loadTimings() {
        try {
            if (fs.existsSync(this.logFile)) {
                return JSON.parse(fs.readFileSync(this.logFile))
            }
        } catch (err) {
            console.log('No previous timing data found')
        }
        return { starts: [], averageTime: 0 }
    }

    addTiming(startTime, doneTime) {
        const timeTaken = (doneTime - startTime) / 1000 // Convert to seconds
        this.timings.starts.push(timeTaken)
        
        // Keep only last 10 starts
        if (this.timings.starts.length > 10) {
            this.timings.starts.shift()
        }
        
        // Calculate new average
        this.timings.averageTime = this.timings.starts.reduce((a, b) => a + b, 0) / this.timings.starts.length
        
        // Save updated timings
        fs.writeFileSync(this.logFile, JSON.stringify(this.timings, null, 2))
        
        return this.timings.averageTime
    }

    getWaitTime() {
        return this.timings.averageTime + 5 // Add 5 seconds buffer
    }
}

module.exports = ServerTiming 