const { goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')

class GoalHandler {
    constructor(bot) {
        this.bot = bot
        this.currentGoal = null
        this.lastError = null
        this.attemptCount = 0
        this.MAX_ATTEMPTS = 3
    }

    // Wrap the pathfinder's setGoal to catch errors
    wrapGoalHandling() {
        const originalSetGoal = this.bot.pathfinder.setGoal.bind(this.bot.pathfinder)
        
        this.bot.pathfinder.setGoal = (goal) => {
            try {
                // Reset attempt count for new goals
                if (this.currentGoal !== goal) {
                    this.attemptCount = 0
                    this.currentGoal = goal
                }

                // Check attempt limit
                if (this.attemptCount >= this.MAX_ATTEMPTS) {
                    this.bot.chat("I've tried this path several times without success.")
                    console.log('Maximum path attempts reached - stopping')
                    return false
                }

                // Validate goal before attempting
                if (!this.isValidGoal(goal)) {
                    console.log('Invalid goal provided:', goal)
                    this.bot.chat("I can't understand where to go.")
                    return false
                }

                this.attemptCount++
                return originalSetGoal(goal)

            } catch (err) {
                this.handleGoalError(err)
                return false
            }
        }
    }

    // Validate goal object
    isValidGoal(goal) {
        if (!goal) return false
        
        // Check if it's a standard pathfinder goal
        if (goal instanceof goals.Goal) return true
        
        // Check if it's a position-based goal
        if (goal.x !== undefined && goal.y !== undefined && goal.z !== undefined) {
            return true
        }

        return false
    }

    // Handle various goal-related errors
    handleGoalError(error) {
        this.lastError = error
        
        if (error.message.includes('Path was stopped')) {
            console.log('Path was interrupted - checking reason')
            this.bot.chat("I had to stop. Let me check why...")
            
            // Check for common obstacles
            const nearbyDoors = this.bot.findBlocks({
                matching: block => block.name.toLowerCase().includes('door'),
                maxDistance: 5,
                count: 1
            })
            
            if (nearbyDoors.length > 0) {
                this.bot.chat("There's a door in the way. Should I try again?")
            } else {
                this.bot.chat("Something's blocking my path.")
            }
        } else if (error.message.includes('Cannot find path')) {
            console.log('No valid path found')
            this.bot.chat("I can't find a way to get there.")
        } else {
            console.log('Unexpected pathfinding error:', error.message)
            this.bot.chat("I'm having trouble with that path.")
        }
    }

    // Convert any valid position to a proper goal
    createGoal(position, range = 1) {
        if (position instanceof Vec3) {
            return new goals.GoalNear(position.x, position.y, position.z, range)
        }
        
        if (position.x !== undefined && position.y !== undefined && position.z !== undefined) {
            return new goals.GoalNear(position.x, position.y, position.z, range)
        }
        
        throw new Error('Invalid position provided for goal creation')
    }

    // Get status of last goal attempt
    getLastAttemptStatus() {
        return {
            attempts: this.attemptCount,
            maxAttempts: this.MAX_ATTEMPTS,
            lastError: this.lastError ? this.lastError.message : null,
            currentGoal: this.currentGoal ? this.currentGoal.toString() : null
        }
    }
}

module.exports = GoalHandler 