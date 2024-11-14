const { Vec3 } = require('vec3')

class DoorTraversal {
    constructor(bot) {
        this.bot = bot
    }

    // Check if block is a door
    isDoor(block) {
        return block && block.name && block.name.toLowerCase().includes('door')
    }

    // Get door state
    getDoorState(door) {
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

    // Calculate approach position for door
    getApproachPosition(door, targetPos) {
        const props = door.getProperties()
        const pos = door.position
        const botPos = this.bot.entity.position

        // Determine which side of the door we're on and which side we need to get to
        const isTargetBeyondDoor = (props.facing === 'east' && targetPos.x > pos.x) ||
                                  (props.facing === 'west' && targetPos.x < pos.x) ||
                                  (props.facing === 'north' && targetPos.z < pos.z) ||
                                  (props.facing === 'south' && targetPos.z > pos.z)

        const isBotBeyondDoor = (props.facing === 'east' && botPos.x > pos.x) ||
                                 (props.facing === 'west' && botPos.x < pos.x) ||
                                 (props.facing === 'north' && botPos.z < pos.z) ||
                                 (props.facing === 'south' && botPos.z > pos.z)

        // If we're on the wrong side, approach from current side
        const offset = isBotBeyondDoor === isTargetBeyondDoor ? 2 : -2

        switch(props.facing) {
            case 'north': return new Vec3(pos.x, pos.y, pos.z + offset)
            case 'south': return new Vec3(pos.x, pos.y, pos.z - offset)
            case 'east': return new Vec3(pos.x - offset, pos.y, pos.z)
            case 'west': return new Vec3(pos.x + offset, pos.y, pos.z)
            default: return null
        }
    }

    // Handle door interaction
    async handleDoor(door, targetPos) {
        try {
            const doorState = this.getDoorState(door)
            if (!doorState.isOpen) {
                // Get current position of bot and leader
                const botPos = this.bot.entity.position
                const leaderPos = targetPos || this.bot.players[Object.keys(this.bot.players)[0]].entity.position

                // Calculate approach position based on current positions
                const approachPos = this.getApproachPosition(door, leaderPos)
                if (!approachPos) return false

                // If we're close enough, just open the door
                if (botPos.distanceTo(door.position) <= 3) {
                    await this.bot.activateBlock(door)
                    await new Promise(resolve => setTimeout(resolve, 250))
                    return true
                }

                // Otherwise move to approach position first
                await this.bot.pathfinder.goto(approachPos)
                await this.bot.activateBlock(door)
                await new Promise(resolve => setTimeout(resolve, 250))
                return true
            }
            return true // Door is already open
        } catch (err) {
            return false
        }
    }

    // Check if we can traverse through door
    canTraverseDoor(door) {
        return this.bot.pathfinder.movements.openable.has(door.type)
    }
}

module.exports = DoorTraversal 