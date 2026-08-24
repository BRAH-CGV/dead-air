import * as THREE from 'three';
import { createInputState, setKeyPressed, getMovementDirection } from './controls.js';
import { createPlayer, updatePlayer, respawnPlayer } from './player.js';
import { createCameraRig, updateCameraPosition, toggleCameraMode } from './camera.js';
import { createLevel1Definition } from './levels/level1.js';
import { createInteractionManager, setInteractionTarget, clearInteractionTarget, getInteractionTarget, interact } from './interactions.js';
import { createGameState, completeObjective, checkWinCondition, resetGameState, getActiveObjectives, getCompletedObjectives } from './game-state.js';
import { createUIState, setInteractionPrompt, clearInteractionPrompt, updateObjectiveTracker, setGameMessage, clearGameMessage } from './ui.js';
import { createHolographicUniforms, updateHolographicUniforms, holographicVertexShader, holographicFragmentShader } from './shaders/holographic.js';
import { createDisposeManager, trackObject, disposeAll } from './utils/dispose.js';

// --- scene setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- DOM references ---
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const promptEl = document.getElementById('interaction-prompt');
const objTrackerEl = document.getElementById('objective-tracker');
const objListEl = document.getElementById('obj-list');
const gameMsgEl = document.getElementById('game-message');
const winScreenEl = document.getElementById('win-screen');
const restartBtn = document.getElementById('restart-btn');

// --- build Level 1 ---
const level = createLevel1Definition();
scene.background = new THREE.Color(level.skybox.color);

// terrain
const terrainMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(level.terrain.size, level.terrain.size),
  new THREE.MeshStandardMaterial({ color: level.terrain.color, roughness: level.terrain.roughness })
);
terrainMesh.rotation.x = -Math.PI / 2;
terrainMesh.receiveShadow = true;
scene.add(terrainMesh);

// build objects from level definition
const meshMap = new Map();
const interactableMeshIds = new Set(level.interactables.map(i => i.id));

for (const objDef of level.objects) {
  const geo = new THREE.BoxGeometry(objDef.size.x, objDef.size.y, objDef.size.z);
  const matOpts = { color: objDef.color, roughness: objDef.roughness ?? 0.5 };
  if (objDef.metalness !== undefined) matOpts.metalness = objDef.metalness;
  if (objDef.emissive !== undefined) matOpts.emissive = new THREE.Color(objDef.emissive);

  const mat = new THREE.MeshStandardMaterial(matOpts);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(objDef.position.x, objDef.position.y, objDef.position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = objDef.id;
  mesh.userData = { group: objDef.group, interactableId: objDef.id };
  scene.add(mesh);
  meshMap.set(objDef.id, mesh);
}

// --- dispose manager: track all scene resources ---
const disposeMgr = createDisposeManager();
for (const [, mesh] of meshMap) {
  trackObject(disposeMgr, mesh);
}
trackObject(disposeMgr, terrainMesh);

// --- apply holographic shader to signal receiver ---
const holoUniforms = createHolographicUniforms();
const signalReceiverMesh = meshMap.get('signal-receiver');
if (signalReceiverMesh) {
  signalReceiverMesh.material = new THREE.ShaderMaterial({
    uniforms: holoUniforms,
    vertexShader: holographicVertexShader,
    fragmentShader: holographicFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// lights
for (const lightDef of level.lights) {
  let light;
  switch (lightDef.type) {
    case 'ambient':
      light = new THREE.AmbientLight(lightDef.color, lightDef.intensity);
      break;
    case 'point':
      light = new THREE.PointLight(lightDef.color, lightDef.intensity, lightDef.distance);
      light.position.set(lightDef.position.x, lightDef.position.y, lightDef.position.z);
      light.castShadow = lightDef.castShadow ?? false;
      if (light.castShadow) { light.shadow.mapSize.set(512, 512); }
      break;
    case 'spot':
      light = new THREE.SpotLight(lightDef.color, lightDef.intensity, lightDef.distance);
      light.position.set(lightDef.position.x, lightDef.position.y, lightDef.position.z);
      light.castShadow = lightDef.castShadow ?? false;
      break;
    case 'directional':
      light = new THREE.DirectionalLight(lightDef.color, lightDef.intensity);
      light.position.set(lightDef.position.x, lightDef.position.y, lightDef.position.z);
      light.castShadow = lightDef.castShadow ?? false;
      if (light.castShadow) {
        light.shadow.mapSize.set(1024, 1024);
        const d = 30;
        light.shadow.camera.left = -d; light.shadow.camera.right = d;
        light.shadow.camera.top = d; light.shadow.camera.bottom = -d;
        light.shadow.camera.near = 0.5; light.shadow.camera.far = 100;
      }
      break;
  }
  if (light) scene.add(light);
}

// --- game systems ---
const inputState = createInputState();
const player = createPlayer(level.spawnPoint);
const cameraRig = createCameraRig();
const interactionMgr = createInteractionManager(level.interactables);
const gameState = createGameState(level.objectives);
const uiState = createUIState();

// show objective tracker on start
objTrackerEl.style.display = 'block';
refreshObjectiveUI();

// --- raycaster for interactions ---
const raycaster = new THREE.Raycaster();
const interactRayOrigin = new THREE.Vector3();
const interactRayDir = new THREE.Vector3();
const INTERACT_DISTANCE = 4;

// reusable euler (created once, reused every frame)
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

// message timer
let messageTimer = 0;

// highlight state
let highlightedMesh = null;
let originalEmissive = new THREE.Color();

function refreshObjectiveUI() {
  const active = getActiveObjectives(gameState);
  const completed = getCompletedObjectives(gameState);
  const all = gameState.objectives.map(o => ({
    id: o.id,
    description: o.description,
    completed: gameState.completedIds.has(o.id),
  }));
  updateObjectiveTracker(uiState, all);
  renderObjectiveTracker();
}

function renderObjectiveTracker() {
  objListEl.innerHTML = '';
  for (const obj of uiState.objectives) {
    const div = document.createElement('div');
    div.className = 'obj-item' + (obj.completed ? ' done' : '');
    div.textContent = (obj.completed ? '✓ ' : '○ ') + obj.description;
    objListEl.appendChild(div);
  }
}

function showGameMessage(text, duration = 3) {
  setGameMessage(uiState, text);
  gameMsgEl.textContent = text;
  gameMsgEl.style.display = 'block';
  messageTimer = duration;
}

function hideGameMessage() {
  clearGameMessage(uiState);
  gameMsgEl.style.display = 'none';
}

function clearHighlight() {
  if (highlightedMesh && highlightedMesh.material) {
    highlightedMesh.material.emissive.copy(originalEmissive);
    highlightedMesh = null;
  }
}

function setHighlight(mesh) {
  if (mesh === highlightedMesh) return;
  clearHighlight();
  if (mesh && mesh.material) {
    highlightedMesh = mesh;
    originalEmissive.copy(mesh.material.emissive);
    mesh.material.emissive.set(0x333333);
  }
}

// --- pointer lock ---
const canvas = renderer.domElement;

canvas.addEventListener('click', () => {
  if (gameState.status === 'playing') {
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  inputState.isPointerLocked = document.pointerLockElement === canvas;
  if (inputState.isPointerLocked) {
    overlay.classList.add('hidden');
    crosshair.style.display = 'block';
  } else {
    overlay.classList.remove('hidden');
    crosshair.style.display = 'none';
  }
});

document.addEventListener('mousemove', (e) => {
  if (inputState.isPointerLocked) {
    inputState.mouseDeltaX += e.movementX;
    inputState.mouseDeltaY += e.movementY;
  }
});

// --- keyboard input ---
document.addEventListener('keydown', (e) => {
  setKeyPressed(inputState, e.code, true);

  if (e.code === 'KeyV' && inputState.isPointerLocked) {
    toggleCameraMode(cameraRig);
  }

  // interact with E
  if (e.code === 'KeyE' && inputState.isPointerLocked) {
    handleInteraction();
  }
});

document.addEventListener('keyup', (e) => {
  setKeyPressed(inputState, e.code, false);
});

// --- interaction logic ---
function handleInteraction() {
  const result = interact(interactionMgr);
  if (!result) return;

  // map interactable id → objective id
  const objective = level.objectives.find(o => o.interactableId === result.id);
  if (objective) {
    completeObjective(gameState, objective.id);
    refreshObjectiveUI();
  }

  // show feedback
  const target = getInteractionTarget(interactionMgr);
  if (target) {
    showGameMessage(target.prompt, 2.5);
  }

  // check win
  if (checkWinCondition(gameState)) {
    winScreenEl.style.display = 'flex';
    document.exitPointerLock();
  }
}

// --- restart ---
restartBtn.addEventListener('click', () => {
  resetGameState(gameState);
  respawnPlayer(player);
  interactionMgr.completed.clear();
  winScreenEl.style.display = 'none';
  hideGameMessage();
  clearHighlight();
  clearInteractionPrompt(uiState);
  promptEl.style.display = 'none';
  refreshObjectiveUI();
});

// --- resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- animation loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();

  // update player
  const dir = getMovementDirection(inputState);
  updatePlayer(player, { x: dir.x, z: dir.z, mouseDeltaX: inputState.mouseDeltaX, mouseDeltaY: inputState.mouseDeltaY }, dt);
  inputState.mouseDeltaX = 0;
  inputState.mouseDeltaY = 0;

  // update camera
  const cam = updateCameraPosition(cameraRig, player);
  camera.position.set(cam.position.x, cam.position.y, cam.position.z);
  euler.set(cam.pitch, cam.yaw, 0);
  camera.quaternion.setFromEuler(euler);

  // update holographic shader uniforms
  updateHolographicUniforms(holoUniforms, dt);

  // --- interaction raycast ---
  if (inputState.isPointerLocked && gameState.status === 'playing') {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    interactRayOrigin.copy(raycaster.ray.origin);
    interactRayDir.copy(raycaster.ray.direction);

    // collect interactable meshes
    const targets = [];
    for (const id of interactableMeshIds) {
      const mesh = meshMap.get(id);
      if (mesh) targets.push(mesh);
    }

    const hits = raycaster.intersectObjects(targets, false);
    const hit = hits.length > 0 && hits[0].distance <= INTERACT_DISTANCE ? hits[0] : null;

    if (hit) {
      const hitId = hit.object.userData.interactableId;
      setInteractionTarget(interactionMgr, hitId);
      const target = getInteractionTarget(interactionMgr);
      if (target && !target.completed) {
        setInteractionPrompt(uiState, target.prompt);
        promptEl.textContent = target.prompt;
        promptEl.style.display = 'block';
        setHighlight(hit.object);
      } else if (target && target.completed) {
        clearInteractionPrompt(uiState);
        promptEl.style.display = 'none';
        clearHighlight();
      }
    } else {
      clearInteractionTarget(interactionMgr);
      clearInteractionPrompt(uiState);
      promptEl.style.display = 'none';
      clearHighlight();
    }
  }

  // message timer
  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) {
      hideGameMessage();
    }
  }

  renderer.render(scene, camera);
}

animate();
