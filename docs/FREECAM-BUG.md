# FreeCam Bug - Handoff Document

## Problem Summary

The **FreeCam component** is supposed to let the player fly around the scene with gravity disabled, but it's not working. The toggle activates (logs show ENABLED), but the player still falls and can jump normally.

## Expected Behavior

1. Press **Ctrl+F** → FreeCam toggles ON
2. Gravity should be disabled immediately
3. Player should float/fly freely
4. **WASD** moves horizontally, **E** ascends, **Q** descends
5. Press **Ctrl+F** again → FreeCam toggles OFF, gravity re-enables

## Actual Behavior

- Console shows `[FreeCam] ENABLED` and `[FreeCam] DISABLED` correctly
- Player still falls due to gravity
- Player can still jump
- Movement controls don't seem to work

## Current Implementation

### File: `src/components/FreeCam.js`

```javascript
// Toggle logic (lines 32-48)
const toggleFreecam = input.keys['ControlLeft'] && input.keys['KeyF'];

if (toggleFreecam && !this._toggleHeld) {
  this.active = !this.active;
  console.log(`[FreeCam] ${this.active ? 'ENABLED' : 'DISABLED'} - fly around with WASD+E/Q`);
  
  // Toggle gravity immediately
  const rb = this.gameObject.rigidBody;
  if (rb) {
    rb.setGravityScale(this.active ? 0 : 1, true);
  }
  
  this._toggleHeld = true;
} else if (!toggleFreecam) {
  this._toggleHeld = false;
}

if (!this.active) return;

// Movement code (lines 52-86)
const rb = this.gameObject.rigidBody;
if (!rb) return;

// ... movement calculation ...

rb.setNextKinematicTranslation({
  x: t.x + this._moveDir.x,
  y: t.y + this._moveDir.y,
  z: t.z + this._moveDir.z,
});
```

### Integration: `src/core/Engine.js` (lines 361-364)

```javascript
const freeCam = new FreeCam({ speed: 10 });
freeCam.camera = this.camera;
player.addComponent(freeCam);
```

## What's Been Tried

1. ✅ Toggle logic fixed (was hold-to-activate, now press-to-toggle)
2. ✅ Gravity toggle added to toggle handler
3. ❓ Gravity still not disabling
4. ❓ Movement not working

## Possible Issues to Investigate

### 1. Rigid Body Type Issue
The player's rigid body might be **dynamic** and fighting against the kinematic translation. FreeCam uses `setNextKinematicTranslation()` which only works on **kinematic** bodies.

**Check:** What type is the player's rigid body?
```javascript
// In Engine.js or wherever player is created
console.log('RigidBody type:', rb.bodyType());
// RigidBodyType.Dynamic = 0
// RigidBodyType.Fixed = 1  
// RigidBodyType.KinematicPositionBased = 2
// RigidBodyType.KinematicVelocityBased = 3
```

**Possible fix:** When FreeCam activates, change the body type to kinematic:
```javascript
rb.setBodyType(2); // KinematicPositionBased
```
And back to dynamic when deactivating:
```javascript
rb.setBodyType(0); // Dynamic
```

### 2. FirstPersonController Conflict
The `FirstPersonController` component might be overriding the position/velocity every frame, fighting against FreeCam's movement.

**Check:** Does FirstPersonController run after FreeCam and reset position?

**Possible fix:** Make FirstPersonController skip its update when FreeCam is active:
```javascript
// In FirstPersonController.onUpdate()
const freeCam = this.gameObject.getComponent(FreeCam);
if (freeCam?.active) return; // Skip player controls
```

### 3. Gravity Scale Not Persisting
Maybe something else is resetting the gravity scale every frame.

**Check:** Search for other `setGravityScale` calls:
```bash
grep -r "setGravityScale" src/
```

### 4. Engine Reference Issue
The FreeCam gets the engine via `this.gameObject.scene?.userData.engine`. This might be null.

**Check:** Add debug logging:
```javascript
console.log('Engine:', engine);
console.log('RigidBody:', rb);
```

## Debugging Steps

1. **Add logging to FreeCam.onUpdate():**
   ```javascript
   console.log('FreeCam active:', this.active);
   console.log('RigidBody:', rb);
   console.log('Gravity scale:', rb?.gravityScale());
   console.log('Body type:', rb?.bodyType());
   ```

2. **Check if FirstPersonController is interfering:**
   - Temporarily disable FirstPersonController when testing FreeCam
   - Or add a flag to skip its update

3. **Verify rigid body type:**
   - Log the body type when FreeCam activates
   - If it's dynamic (0), try changing to kinematic (2)

4. **Test in isolation:**
   - Create a simple test scene with just a cube and FreeCam
   - See if it works without FirstPersonController

## Related Files

- `src/components/FreeCam.js` — The FreeCam component
- `src/components/FirstPersonController.js` — Player controller (potential conflict)
- `src/core/Engine.js` — Where FreeCam is added to player
- `src/core/GameObject.js` — GameObject with rigidBody property
- `src/core/Physics.js` — Rapier physics setup

## Branch

All work is on: `dev/level-editor`

## Test Status

- All 52 tests pass
- 2 pre-existing WASM test failures (unrelated)

---

**Next steps:** Investigate the rigid body type and FirstPersonController conflict. The most likely issue is that the player has a dynamic rigid body that ignores kinematic translations, or FirstPersonController is overriding the position every frame.
