/**
 * Level 1 — "Fix & Barricade"
 * Pure data definition — no Three.js dependency.
 * Returns a descriptor that main.js uses to build the Three.js scene.
 *
 * Setting: Player has landed on an alien planet. Inside a damaged building/spacecraft,
 * they must repair components, barricade the door against a creature, and activate
 * the signal receiver to contact Earth.
 */

// Building dimensions (metres)
const BLDG = {
  width: 10,
  depth: 12,
  height: 3.5,
  wallThickness: 0.3,
};

const hw = BLDG.width / 2;
const hd = BLDG.depth / 2;
const hh = BLDG.height / 2;
const wt = BLDG.wallThickness;

export function createLevel1Definition() {
  return {
    name: 'Fix & Barricade',

    // --- terrain (alien planet surface) ---
    terrain: {
      size: 200,
      color: 0x3d2b1f, // dark Martian soil
      roughness: 0.95,
    },

    // --- skybox ---
    skybox: {
      color: 0x1a0a0a, // dark red-black alien sky
    },

    // --- spawn point (inside the building) ---
    spawnPoint: { x: 0, y: 0, z: 0 },

    // --- scene objects ---
    objects: [
      // building floor
      {
        id: 'building-floor',
        group: 'building',
        type: 'box',
        position: { x: 0, y: -0.05, z: 0 },
        size: { x: BLDG.width, y: 0.1, z: BLDG.depth },
        color: 0x444455,
        roughness: 0.7,
      },
      // building ceiling
      {
        id: 'building-ceiling',
        group: 'building',
        type: 'box',
        position: { x: 0, y: BLDG.height, z: 0 },
        size: { x: BLDG.width, y: 0.1, z: BLDG.depth },
        color: 0x333344,
        roughness: 0.8,
      },
      // back wall (north, -z)
      {
        id: 'wall-north',
        group: 'building',
        type: 'box',
        position: { x: 0, y: hh, z: -hd },
        size: { x: BLDG.width, y: BLDG.height, z: wt },
        color: 0x555566,
        roughness: 0.7,
      },
      // left wall (-x)
      {
        id: 'wall-west',
        group: 'building',
        type: 'box',
        position: { x: -hw, y: hh, z: 0 },
        size: { x: wt, y: BLDG.height, z: BLDG.depth },
        color: 0x555566,
        roughness: 0.7,
      },
      // right wall (+x)
      {
        id: 'wall-east',
        group: 'building',
        type: 'box',
        position: { x: hw, y: hh, z: 0 },
        size: { x: wt, y: BLDG.height, z: BLDG.depth },
        color: 0x555566,
        roughness: 0.7,
      },
      // south wall - left section (door opening in centre)
      {
        id: 'wall-south-left',
        group: 'building',
        type: 'box',
        position: { x: -(hw - 1), y: hh, z: hd },
        size: { x: (BLDG.width / 2) - 1.5, y: BLDG.height, z: wt },
        color: 0x555566,
        roughness: 0.7,
      },
      // south wall - right section
      {
        id: 'wall-south-right',
        group: 'building',
        type: 'box',
        position: { x: (hw - 1), y: hh, z: hd },
        size: { x: (BLDG.width / 2) - 1.5, y: BLDG.height, z: wt },
        color: 0x555566,
        roughness: 0.7,
      },
      // south wall - lintel above door
      {
        id: 'wall-south-lintel',
        group: 'building',
        type: 'box',
        position: { x: 0, y: BLDG.height - 0.35, z: hd },
        size: { x: 3, y: 0.7, z: wt },
        color: 0x555566,
        roughness: 0.7,
      },

      // --- door (interactable) ---
      {
        id: 'door',
        group: 'building',
        type: 'box',
        position: { x: 0, y: 1.25, z: hd },
        size: { x: 2.4, y: 2.5, z: 0.15 },
        color: 0x8b6914, // rusty metal
        roughness: 0.6,
        metalness: 0.3,
      },

      // --- signal receiver (interactable, on a table-like block) ---
      {
        id: 'signal-receiver-base',
        group: 'furniture',
        type: 'box',
        position: { x: -3, y: 0.45, z: -4 },
        size: { x: 1.2, y: 0.9, z: 0.8 },
        color: 0x445566,
        roughness: 0.5,
      },
      {
        id: 'signal-receiver',
        group: 'interactable',
        type: 'box',
        position: { x: -3, y: 1.15, z: -4 },
        size: { x: 0.6, y: 0.5, z: 0.4 },
        color: 0x22cc88, // glowing green device
        roughness: 0.2,
        metalness: 0.6,
        emissive: 0x115533,
      },

      // --- workbench ---
      {
        id: 'workbench',
        group: 'furniture',
        type: 'box',
        position: { x: 3, y: 0.45, z: -4 },
        size: { x: 2, y: 0.9, z: 1 },
        color: 0x664422,
        roughness: 0.8,
      },

      // --- scattered crates for atmosphere ---
      {
        id: 'crate-1',
        group: 'decoration',
        type: 'box',
        position: { x: -3.5, y: 0.3, z: 3 },
        size: { x: 0.6, y: 0.6, z: 0.6 },
        color: 0x665533,
        roughness: 0.9,
      },
      {
        id: 'crate-2',
        group: 'decoration',
        type: 'box',
        position: { x: -3, y: 0.3, z: 2 },
        size: { x: 0.5, y: 0.5, z: 0.5 },
        color: 0x554422,
        roughness: 0.9,
      },
      {
        id: 'crate-3',
        group: 'decoration',
        type: 'box',
        position: { x: 4, y: 0.4, z: 1 },
        size: { x: 0.8, y: 0.8, z: 0.8 },
        color: 0x665533,
        roughness: 0.9,
      },

      // --- alien planet rocks outside ---
      {
        id: 'rock-1',
        group: 'exterior',
        type: 'box',
        position: { x: 15, y: 1, z: -20 },
        size: { x: 4, y: 2, z: 3 },
        color: 0x4a3728,
        roughness: 1.0,
      },
      {
        id: 'rock-2',
        group: 'exterior',
        type: 'box',
        position: { x: -20, y: 1.5, z: -15 },
        size: { x: 5, y: 3, z: 4 },
        color: 0x3d2b1f,
        roughness: 1.0,
      },
      {
        id: 'rock-3',
        group: 'exterior',
        type: 'box',
        position: { x: 10, y: 0.8, z: 25 },
        size: { x: 3, y: 1.6, z: 2.5 },
        color: 0x4a3728,
        roughness: 1.0,
      },
    ],

    // --- lighting ---
    lights: [
      // dim ambient (alien atmosphere)
      {
        type: 'ambient',
        color: 0x302020,
        intensity: 1.0,
      },
      // main interior light (overhead, casts shadows)
      {
        type: 'point',
        color: 0xffddaa,
        intensity: 50,
        distance: 25,
        position: { x: 0, y: 3, z: -2 },
        castShadow: true,
      },
      // secondary interior light (near door)
      {
        type: 'point',
        color: 0xaabbcc,
        intensity: 20,
        distance: 15,
        position: { x: 0, y: 2.5, z: 4 },
        castShadow: false,
      },
      // signal receiver glow
      {
        type: 'point',
        color: 0x22cc88,
        intensity: 8,
        distance: 5,
        position: { x: -3, y: 1.5, z: -4 },
        castShadow: false,
      },
      // exterior light (distant sun-like)
      {
        type: 'directional',
        color: 0xff8844,
        intensity: 0.8,
        position: { x: 20, y: 30, z: -10 },
        castShadow: true,
      },
    ],

    // --- interactable objects ---
    interactables: [
      {
        id: 'door',
        action: 'barricade',
        prompt: 'Press E to barricade door',
        completedPrompt: 'Door barricaded',
      },
      {
        id: 'signal-receiver',
        action: 'use',
        prompt: 'Press E to use signal receiver',
        completedPrompt: 'Signal sent!',
      },
    ],

    // --- level objectives (win conditions) ---
    objectives: [
      {
        id: 'barricade-door',
        description: 'Barricade the door',
        interactableId: 'door',
      },
      {
        id: 'use-signal-receiver',
        description: 'Activate the signal receiver',
        interactableId: 'signal-receiver',
      },
    ],
  };
}
