/**
 * Player entity — position, velocity, health, state machine.
 * Pure logic, no Three.js dependency.
 */

const DEFAULTS = {
  speed: 5,
  gravity: -20,
  height: 1.7,
  mouseSensitivity: 2.5,
  maxHealth: 100,
};

const MAX_PITCH = Math.PI / 2 - 0.01;

export function createPlayer(spawnPos) {
  return {
    position: {
      x: spawnPos?.x ?? 0,
      y: spawnPos?.y ?? 0,
      z: spawnPos?.z ?? 0,
    },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    state: 'alive',
    health: DEFAULTS.maxHealth,
    height: DEFAULTS.height,
  };
}

export function updatePlayer(player, input, dt) {
  if (player.state !== 'alive') return;

  // --- rotation from mouse ---
  player.yaw -= (input.mouseDeltaX ?? 0) * DEFAULTS.mouseSensitivity * dt;
  player.pitch -= (input.mouseDeltaY ?? 0) * DEFAULTS.mouseSensitivity * dt;
  player.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, player.pitch));

  // --- movement relative to yaw ---
  const moveX = input.x ?? 0;
  const moveZ = input.z ?? 0;

  if (moveX !== 0 || moveZ !== 0) {
    const sinYaw = Math.sin(player.yaw);
    const cosYaw = Math.cos(player.yaw);

    // rotate movement direction by player yaw
    const worldX = moveX * cosYaw - moveZ * sinYaw;
    const worldZ = moveX * sinYaw + moveZ * cosYaw;

    player.position.x += worldX * DEFAULTS.speed * dt;
    player.position.z += worldZ * DEFAULTS.speed * dt;
  }

  // --- gravity ---
  player.velocity.y += DEFAULTS.gravity * dt;
  player.position.y += player.velocity.y * dt;

  // --- ground collision ---
  if (player.position.y <= 0) {
    player.position.y = 0;
    player.velocity.y = 0;
  }
}

export function damagePlayer(player, amount) {
  player.health = Math.max(0, player.health - amount);
  if (player.health <= 0) {
    player.state = 'dead';
  }
}

export function killPlayer(player) {
  player.health = 0;
  player.state = 'dead';
}

export function respawnPlayer(player) {
  player.position.x = 0;
  player.position.y = 0;
  player.position.z = 0;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.yaw = 0;
  player.pitch = 0;
  player.state = 'alive';
  player.health = DEFAULTS.maxHealth;
}
