/**
 * Camera rig — manages camera mode (first/third person) and position computation.
 * Pure logic, no Three.js dependency.
 */

const DEFAULT_THIRD_PERSON_OFFSET = { x: 0, y: 3, z: 5 };

export function createCameraRig(thirdPersonOffset) {
  return {
    mode: 'first-person',
    thirdPersonOffset: {
      x: thirdPersonOffset?.x ?? DEFAULT_THIRD_PERSON_OFFSET.x,
      y: thirdPersonOffset?.y ?? DEFAULT_THIRD_PERSON_OFFSET.y,
      z: thirdPersonOffset?.z ?? DEFAULT_THIRD_PERSON_OFFSET.z,
    },
  };
}

export function updateCameraPosition(rig, player) {
  const pos = { x: 0, y: 0, z: 0 };

  if (rig.mode === 'first-person') {
    // camera at player position + eye height
    pos.x = player.position.x;
    pos.y = player.position.y + player.height;
    pos.z = player.position.z;
  } else {
    // third-person: offset behind the player, rotated by yaw
    const sinYaw = Math.sin(player.yaw);
    const cosYaw = Math.cos(player.yaw);

    const off = rig.thirdPersonOffset;
    pos.x = player.position.x + off.x * cosYaw + off.z * sinYaw;
    pos.y = player.position.y + off.y;
    pos.z = player.position.z - off.x * sinYaw + off.z * cosYaw;
  }

  return {
    position: pos,
    yaw: player.yaw,
    pitch: player.pitch,
  };
}

export function toggleCameraMode(rig) {
  rig.mode = rig.mode === 'first-person' ? 'third-person' : 'first-person';
}
