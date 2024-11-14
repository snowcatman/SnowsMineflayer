/**
 * Door Registry Information for Minecraft 1.19.2
 * This file documents door block states and properties for mineflayer/prismarine usage
 */

const doorRegistry = {
    // Regular Doors
    doors: {
        oak_door: {
            id: 178,
            displayName: "Oak Door",
            states: {
                facing: ["north", "south", "west", "east"],
                half: ["upper", "lower"],
                hinge: ["left", "right"],
                open: [true, false],
                powered: [true, false]
            },
            boundingBox: "block"
        },
        iron_door: {
            id: 191,
            displayName: "Iron Door",
            states: {
                facing: ["north", "south", "west", "east"],
                half: ["upper", "lower"],
                hinge: ["left", "right"],
                open: [true, false],
                powered: [true, false]
            },
            boundingBox: "block"
        },
        // Additional wooden doors follow same pattern
        spruce_door: { id: 522 },
        birch_door: { id: 523 },
        jungle_door: { id: 524 },
        acacia_door: { id: 525 },
        dark_oak_door: { id: 526 },
        mangrove_door: { id: 527 },
        crimson_door: { id: 759 },
        warped_door: { id: 760 }
    },

    // Trapdoors
    trapdoors: {
        oak_trapdoor: {
            id: 242,
            displayName: "Oak Trapdoor",
            states: {
                facing: ["north", "south", "west", "east"],
                half: ["top", "bottom"],
                open: [true, false],
                powered: [true, false],
                waterlogged: [true, false]
            },
            boundingBox: "block"
        },
        iron_trapdoor: {
            id: 412,
            displayName: "Iron Trapdoor",
            states: {
                facing: ["north", "south", "west", "east"],
                half: ["top", "bottom"],
                open: [true, false],
                powered: [true, false],
                waterlogged: [true, false]
            },
            boundingBox: "block"
        },
        // Additional trapdoors follow same pattern
        spruce_trapdoor: { id: 243 },
        birch_trapdoor: { id: 244 },
        jungle_trapdoor: { id: 245 },
        acacia_trapdoor: { id: 246 },
        dark_oak_trapdoor: { id: 247 },
        mangrove_trapdoor: { id: 248 },
        crimson_trapdoor: { id: 751 },
        warped_trapdoor: { id: 752 }
    },

    // Common properties for all doors
    commonProperties: {
        doors: {
            facing: {
                type: "enum",
                values: ["north", "south", "west", "east"]
            },
            half: {
                type: "enum", 
                values: ["upper", "lower"]
            },
            hinge: {
                type: "enum",
                values: ["left", "right"]
            },
            open: {
                type: "bool"
            },
            powered: {
                type: "bool"
            }
        },
        trapdoors: {
            facing: {
                type: "enum",
                values: ["north", "south", "west", "east"]
            },
            half: {
                type: "enum",
                values: ["top", "bottom"]
            },
            open: {
                type: "bool"
            },
            powered: {
                type: "bool"
            },
            waterlogged: {
                type: "bool"
            }
        }
    }
}

module.exports = doorRegistry

/**
 * Usage Notes:
 * 1. All doors and trapdoors have a "block" bounding box type
 * 2. Door states are consistent across all wooden door variants
 * 3. Trapdoor states are consistent across all trapdoor variants
 * 4. IDs are specific to Minecraft version 1.19.2
 * 
 * Known Issues:
 * 1. When using mcRegistry.blockCollisionShapes.get(), you may encounter:
 *    "Error: Cannot read properties of undefined (reading '178')"
 *    This is a known limitation when trying to access collision shapes directly.
 *    Use block.boundingBox property instead for collision detection.
 * 
 * Example Usage with Mineflayer:
 * const doorRegistry = require('./DOOR_REGISTRY.js')
 * const oakDoorStates = doorRegistry.doors.oak_door.states
 * const isTrapdoor = block.id === doorRegistry.trapdoors.oak_trapdoor.id
 * 
 * // Recommended way to check collisions:
 * const hasBoundingBox = block.boundingBox === 'block'
 * 
 * // Instead of:
 * // const shape = mcRegistry.blockCollisionShapes.get(block.id) // May cause errors
 */ 