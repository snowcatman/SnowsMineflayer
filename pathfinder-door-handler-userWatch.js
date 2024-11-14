const { Vec3 } = require('vec3')

class DoorStateValidator {
    constructor(bot) {
        this.bot = bot
        this.doorStateHistory = new Map()
    }

    validateDoorStateChange(door, player) {
        const doorId = `${door.position.x},${door.position.y},${door.position.z}`
        const initialState = this.getDoorState(door)
        console.log(`Door validation - Initial state for ${doorId}:`, initialState)

        // Watch for player passing through
        const playerPos = player.entity.position
        const distanceToDoor = playerPos.distanceTo(door.position)

        if (distanceToDoor < 2) {  // Player is close to door
            // Record state before and after player passes
            this.doorStateHistory.set(doorId, {
                before: initialState,
                timestamp: Date.now(),
                player: player.username
            })

            // Check state after a short delay
            setTimeout(() => {
                const currentState = this.getDoorState(door)
                const history = this.doorStateHistory.get(doorId)
                if (history) {
                    history.after = currentState
                    console.log(`Door validation - State change for ${doorId}:
                        Before: ${JSON.stringify(history.before)}
                        After: ${JSON.stringify(currentState)}
                        Player: ${history.player}
                        Time: ${Date.now() - history.timestamp}ms`)
                }
            }, 500)  // Check after 500ms
        }
    }

    getDoorState(door) {
        if (!door) return null
        const props = door.getProperties()
        return {
            isOpen: props.open === 'true',
            facing: props.facing,
            half: props.half,
            hinge: props.hinge,
            powered: props.powered === 'true'
        }
    }
}

module.exports = DoorStateValidator 