export const SdfCommands = Object.freeze({
    // Elements
    SPHERE: 0,
    BOX_SIMPLE: 1,
    BOX: 2,
    TEXT: 3,
    CYLINDER: 4,
    TRIANGLE: 5,

    CUSTOM_START: 10,
    CUSTOM: 11, // Custom elements have this type but can have commands from CUSTOM_START to min(CUSTOM_START + num_custom_elements, CUSTOM_END)
    CUSTOM_END: 99,

    // Layer Operations
    UNION: 100,
    SUBTRACTION: 101,
    INTERSECTION: 102,
    XOR: 103,
    SMOOTH_UNION: 104,
    SMOOTH_SUBTRACTION: 105,
    SMOOTH_INTERSECTION: 106,

    // Commands that don't add an object to the scene
    SET_LAYER_DATA: 200,
    LOAD_ELEMENT_MATRIX_AND_MATERIAL: 201,
    TWIST: 202,
    BEND: 203,
})