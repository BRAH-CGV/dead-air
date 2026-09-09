import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { ASSETS } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// LevelEditor  –  Visual scene editing tool
// ─────────────────────────────────────────────
// Toggle with F2. Provides keyboard-based transform controls for moving,
// rotating, and scaling objects. Exports layout as JSON or JavaScript code.
// ─────────────────────────────────────────────

export class LevelEditor {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.selectedObject = null;
    
    // Transform mode: 'translate' | 'rotate' | 'scale'
    this.mode = 'translate';
    // Transform space: 'local' | 'world'
    this.space = 'world';
    // Movement step size (small for precision)
    this.stepSize = 0.01;
    this.rotationStep = 0.01;
    this.scaleStep = 0.01;
    
    // UI elements
    this.panel = null;
    this.infoDiv = null;
    this.modeDiv = null;
    
    // Raycaster for object selection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Editable objects (populated from engine._rootObjects)
    this.editableObjects = [];
    
    // Hierarchy management
    this.sceneRoot = null;       // GameObject, isGroup = true, name = 'SceneRoot'
    this.dynamicObjects = [];    // Objects with dynamic rigidBody — NOT under sceneRoot
    
    // Scene file management
    this._dirty = false;         // Unsaved changes flag
    
    // DOM element references (set by _buildSceneHeader)
    this._sceneNameEl = null;
    this._dirtyIndicator = null;
    
    // Tree view expand/collapse state
    // Groups are EXPANDED by default; this set tracks explicitly COLLAPSED groups.
    this._collapsedGroups = new Set();
    
    // Create Group button ref
    this._createGroupBtn = null;
    
    // Add Object panel ref
    this._addObjectPanel = null;
  }
  
  init() {
    // Build UI panel
    this._buildUI();
    
    // Event listeners
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      
      // Transform mode switching
      if (e.code === 'KeyG') {
        this.mode = 'translate';
        this._updateModeDisplay();
      }
      if (e.code === 'KeyR') {
        this.mode = 'rotate';
        this._updateModeDisplay();
      }
      if (e.code === 'KeyT') {
        this.mode = 'scale';
        this._updateModeDisplay();
      }
      
      // Arrow key controls for transforming selected object
      if (this.selectedObject) {
        const obj = this.selectedObject.object3d;
        const step = this.stepSize;
        const rotStep = this.rotationStep;
        const scaleStep = this.scaleStep;
        
        if (this.mode === 'translate') {
          // Move with arrow keys
          if (e.code === 'ArrowLeft') obj.position.x -= step;
          if (e.code === 'ArrowRight') obj.position.x += step;
          if (e.code === 'ArrowUp') obj.position.z -= step;
          if (e.code === 'ArrowDown') obj.position.z += step;
          if (e.code === 'PageUp') obj.position.y += step;
          if (e.code === 'PageDown') obj.position.y -= step;
        } else if (this.mode === 'rotate') {
          // Rotate with arrow keys
          if (e.code === 'ArrowLeft') obj.rotation.y -= rotStep;
          if (e.code === 'ArrowRight') obj.rotation.y += rotStep;
          if (e.code === 'ArrowUp') obj.rotation.x -= rotStep;
          if (e.code === 'ArrowDown') obj.rotation.x += rotStep;
          if (e.code === 'PageUp') obj.rotation.z += rotStep;
          if (e.code === 'PageDown') obj.rotation.z -= rotStep;
        } else if (this.mode === 'scale') {
          // Scale with arrow keys (uniform scale)
          if (e.code === 'ArrowUp' || e.code === 'ArrowRight') {
            obj.scale.multiplyScalar(1 + scaleStep);
          }
          if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') {
            obj.scale.multiplyScalar(1 - scaleStep);
          }
        }
        
        // Update info panel and physics after transform
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.code)) {
          this._syncTransformToPhysics();
          this._updateInfoPanel();
          e.preventDefault();
        }
      }
      
      // Delete selected object
      if (e.code === 'Delete' && this.selectedObject) {
        this._deleteSelected();
      }

      // P = recenter pivot. Groups pivot at the average centre of children;
      // single objects pivot on their own visual (bounding-box) centre.
      if (e.code === 'KeyP' && this.selectedObject) {
        if (this.selectedObject.isGroup) {
          this._recenterPivot(this.selectedObject);
        } else {
          this._recenterObjectOnSelf(this.selectedObject);
        }
        this._syncTransformToPhysics();
        // Recentering shifts the pivot, which invalidates the cached collider
        // offset for models (the offset was computed at load time relative to
        // the model's original origin, not the new pivot). Force a rebuild
        // from the measured world bbox so the collider stays centred on the
        // visual mesh instead of drifting upward by the old offset.
        if (!this.selectedObject.isGroup && this.selectedObject.rigidBody) {
          this._rebuildProceduralCollider(this.selectedObject);
        }
        this._updateInfoPanel();
        this._updateTreeView();
        e.preventDefault();
      }
    });
    
    // Mouse click for selection
    this.engine.renderer.domElement.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this._onMouseDown(e);
    });
  }
  
  toggle() {
    this.enabled = !this.enabled;
    this.panel.style.display = this.enabled ? 'block' : 'none';
    
    if (this.enabled) {
      this._refreshEditableObjects();
      document.exitPointerLock();
    } else {
      this.deselectAll();
    }
    
    console.log(`[LevelEditor] ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  _refreshEditableObjects() {
    this._buildHierarchy();
  }

  /** Called by the engine after a scene (re)build — e.g. F4 model-debug
   *  respawn or a scene-switcher change. An open editor must never keep
   *  references into the old scene: a stale selection would sync dead
   *  physics bodies (use-after-free in Rapier) on the next edit. */
  onSceneRebuilt() {
    this.deselectAll();
    this.sceneRoot = null;          // force re-adoption of the new SceneRoot
    this._collapsedGroups.clear();  // old group refs are gone
    if (this.enabled) {
      this._refreshEditableObjects();
      this._updateInfoPanel();
    }
  }
  
  /** Build the hierarchy from the current engine._rootObjects.
   *  ADOPTS the existing SceneRoot from the active scene (if one exists)
   *  so that editor transforms operate on the SAME Three.js hierarchy
   *  that is already rendering.  Without this the editor would create a
   *  parallel root and parent-child transforms would not cascade.
   *  Dynamic objects → tracked separately in dynamicObjects.
   *  Lights → grouped under a [Lighting] group (informational, not transformable). */
  _buildHierarchy() {
    // ── Find or create the scene root ──────────────────────────────
    let existingRoot = null;
    for (const go of this.engine._rootObjects) {
      if (go.name === 'SceneRoot' && go.isGroup) {
        existingRoot = go;
        break;
      }
    }

    if (existingRoot) {
      // ADOPT the scene's own root — never create a parallel one.
      this.sceneRoot = existingRoot;
    } else if (!this.sceneRoot) {
      // No existing root found; create a fresh one.
      this.sceneRoot = new GameObject('SceneRoot');
      this.sceneRoot.makeGroup();
      this.engine.scene.add(this.sceneRoot.object3d);
    } else {
      // We already have an editor sceneRoot and no scene-provided one;
      // just clear its children so we can rebuild.
      while (this.sceneRoot.children.length > 0) {
        this.sceneRoot.removeChild(this.sceneRoot.children[0]);
      }
    }

    // ── Collect editable objects ────────────────────────────────────
    this.dynamicObjects = [];
    this.editableObjects = [];

    // Walk the adopted root's children recursively.
    if (this.sceneRoot.children) {
      for (const child of this.sceneRoot.children) {
        this._collectEditableObjects(child);
      }
    }

    // Also walk _rootObjects for dynamic bodies and any stragglers that
    // are not already under the adopted sceneRoot.
    for (const go of this.engine._rootObjects) {
      if (go.name === 'Player' || !go.object3d) continue;
      if (go === this.sceneRoot) continue; // already handled

      // Skip objects that have already been reparented under the hierarchy
      // (e.g. spawnModel pushes to _rootObjects, then scene code calls
      // group.addChild(go) — the object is already in the tree via the
      // sceneRoot walk above, so adding it again would create duplicates).
      if (this._isUnderHierarchy(go, this.sceneRoot)) continue;

      const isDynamic = go.rigidBody && this.engine.rigidBodyMap.has(go.rigidBody.handle);
      if (isDynamic) {
        if (!this.dynamicObjects.includes(go)) this.dynamicObjects.push(go);
        if (!this.editableObjects.includes(go)) this.editableObjects.push(go);
      } else if (go.parent !== this.sceneRoot) {
        // Not under the adopted root — add it so it's still editable.
        this.sceneRoot.addChild(go);
        this._collectEditableObjects(go);
      }
    }

    if (this.sceneRoot) {
      // Ensure all groups are expanded for rendering (collapsed groups are
      // tracked individually via the toggle arrow).
      this._expandAllGroups(this.sceneRoot);
    }
  }

  /** Return true if `go` is a descendant of `root` (walks the GameObject
   *  parent chain). Used to skip objects that spawnModel pushed to
   *  _rootObjects but that scene code already reparented into the tree. */
  _isUnderHierarchy(go, root) {
    let current = go.parent;
    while (current) {
      if (current === root) return true;
      current = current.parent;
    }
    return false;
  }

  /** Recursively add a GameObject and its DIRECT children to editableObjects.
   *  Does NOT recurse into sub-meshes of imported models — those internal
   *  nodes (e.g. Satellite's Neck_block, Dish) are implementation details
   *  of the model, not independently editable scene objects. Only the model
   *  root itself is editable. Groups DO recurse because their children are
   *  user-created scene objects, not model internals. */
  _collectEditableObjects(go) {
    if (!this.editableObjects.includes(go)) {
      this.editableObjects.push(go);
    }
    if (go.isGroup) this._collapsedGroups.delete(go);
    // Only recurse into groups (user-created containers). Model sub-parts
    // (children of non-group GameObjects) are hidden from the tree — they
    // are internal to the imported model and selecting them separately
    // causes confusion (duplicate entries, orphan transforms).
    if (go.isGroup && go.children) {
      for (const child of go.children) {
        this._collectEditableObjects(child);
      }
    }
  }
  
  _buildUI() {
    // Main panel
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 320px;
      background: rgba(20, 20, 30, 0.95);
      color: #fff;
      font-family: monospace;
      font-size: 12px;
      padding: 15px;
      border-radius: 5px;
      border: 1px solid #444;
      display: none;
      z-index: 1000;
      max-height: 80vh;
      overflow-y: auto;
    `;
    
    // Title
    const title = document.createElement('h3');
    title.textContent = '🔧 Level Editor';
    title.style.margin = '0 0 10px 0';
    title.style.borderBottom = '1px solid #555';
    title.style.paddingBottom = '5px';
    this.panel.appendChild(title);
    
    // Scene header (scene name, dirty indicator, switcher, save)
    this._buildSceneHeader();
    
    // Mode display
    this.modeDiv = document.createElement('div');
    this.modeDiv.style.cssText = `
      background: #25a;
      padding: 8px;
      border-radius: 3px;
      margin-bottom: 10px;
      text-align: center;
      font-weight: bold;
    `;
    this._updateModeDisplay();
    this.panel.appendChild(this.modeDiv);
    
    // Controls help
    const help = document.createElement('div');
    help.innerHTML = `
      <div style="margin-bottom: 10px; color: #aaa;">
        <strong>Controls:</strong><br>
        <strong>G</strong>: Move mode | <strong>R</strong>: Rotate mode | <strong>T</strong>: Scale mode<br>
        <strong>Arrow Keys</strong>: Transform selected object<br>
        <strong>PageUp/Down</strong>: Move up/down or rotate Z<br>
        <strong>Click</strong>: Select object | <strong>Del</strong>: Delete<br>
        <strong>P</strong>: Recenter pivot (group = avg centre, object = own centre)<br>
      </div>
    `;
    this.panel.appendChild(help);
    
    // Selected object info
    this.infoDiv = document.createElement('div');
    this.infoDiv.id = 'editor-info';
    this.infoDiv.style.cssText = `
      background: rgba(0, 0, 0, 0.5);
      padding: 10px;
      border-radius: 3px;
      margin-bottom: 10px;
    `;
    this.infoDiv.textContent = 'No object selected';
    this.panel.appendChild(this.infoDiv);
    
    // Object list
    const listTitle = document.createElement('div');
    listTitle.textContent = 'Scene Objects:';
    listTitle.style.marginBottom = '5px';
    listTitle.style.color = '#aaa';
    this.panel.appendChild(listTitle);
    
    this.objectList = document.createElement('div');
    this.objectList.id = 'editor-object-list';
    this.objectList.style.cssText = `
      max-height: 200px;
      overflow-y: auto;
      margin-bottom: 10px;
    `;
    this.panel.appendChild(this.objectList);
    
    // Create Group button
    const createGroupBtn = document.createElement('button');
    createGroupBtn.textContent = '\u2795 Create Group';
    createGroupBtn.style.cssText = `
      width: 100%;
      padding: 8px;
      background: #654;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-family: monospace;
      margin-bottom: 10px;
    `;
    createGroupBtn.onclick = () => {
      let name = 'NewGroup';
      // Use prompt in browser, fallback for test environments
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const result = prompt('Group name:', 'NewGroup');
        if (result === null) return; // User cancelled
        name = result || name;
      }
      this._createGroup(name);
      this._markDirty();
    };
    this._createGroupBtn = createGroupBtn;
    this.panel.appendChild(createGroupBtn);
    
    // Add Object panel
    this._buildAddObjectPanel();

    document.body.appendChild(this.panel);
  }
  
  _updateModeDisplay() {
    if (!this.modeDiv) return;
    const modeNames = {
      translate: '🔀 MOVE MODE (G)',
      rotate: '🔄 ROTATE MODE (R)',
      scale: '📏 SCALE MODE (T)',
    };
    this.modeDiv.textContent = modeNames[this.mode] || this.mode;
  }

  // ── Scene file management ─────────────

  /** Build the scene header: name, dirty indicator, switcher, save buttons. */
  _buildSceneHeader() {
    const header = document.createElement('div');
    header.style.cssText = `
      background: rgba(0, 0, 0, 0.4);
      padding: 8px;
      border-radius: 3px;
      margin-bottom: 10px;
    `;

    // Scene name + dirty indicator
    const nameRow = document.createElement('div');
    nameRow.style.marginBottom = '5px';
    const label = document.createElement('strong');
    label.textContent = 'Scene: ';
    nameRow.appendChild(label);
    const sceneNameEl = document.createElement('span');
    sceneNameEl.id = 'current-scene-name';
    sceneNameEl.textContent = this._getSceneName();
    nameRow.appendChild(sceneNameEl);
    this._sceneNameEl = sceneNameEl;
    const dirtyEl = document.createElement('span');
    dirtyEl.id = 'dirty-indicator';
    dirtyEl.style.color = '#f80';
    dirtyEl.style.display = 'none';
    dirtyEl.textContent = '*';
    nameRow.appendChild(dirtyEl);
    this._dirtyIndicator = dirtyEl;
    header.appendChild(nameRow);

    // Scene switcher
    const switcherRow = document.createElement('div');
    switcherRow.style.marginBottom = '5px';
    const switcherLabel = document.createElement('span');
    switcherLabel.textContent = 'Switch: ';
    switcherLabel.style.color = '#aaa';
    const switcher = document.createElement('select');
    switcher.id = 'scene-switcher';
    this._sceneSwitcher = switcher;
    switcher.style.cssText = 'background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #555; border-radius: 2px; padding: 2px 4px; font-family: monospace; font-size: 11px;';
    this._populateSceneSwitcher();
    switcherRow.appendChild(switcherLabel);
    switcherRow.appendChild(switcher);
    header.appendChild(switcherRow);

    // Save buttons
    const saveRow = document.createElement('div');
    saveRow.style.display = 'flex';
    saveRow.style.gap = '5px';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'save-btn';
    this._saveBtn = saveBtn;
    saveBtn.textContent = '\uD83D\uDCBE Save All';
    saveBtn.style.cssText = 'flex:1; padding:6px; background:#2a5; color:white; border:none; border-radius:3px; cursor:pointer; font-family:monospace;';
    saveBtn.onclick = () => { this._saveHierarchy(); this._saveSceneCode(); };
    saveRow.appendChild(saveBtn);

    const saveHierBtn = document.createElement('button');
    saveHierBtn.textContent = '\uD83C\uDF33 .json';
    saveHierBtn.style.cssText = 'flex:1; padding:6px; background:#555; color:white; border:none; border-radius:3px; cursor:pointer; font-family:monospace;';
    saveHierBtn.onclick = () => this._saveHierarchy();
    saveRow.appendChild(saveHierBtn);

    const saveCodeBtn = document.createElement('button');
    saveCodeBtn.textContent = '\uD83D\uDCDC .js';
    saveCodeBtn.style.cssText = 'flex:1; padding:6px; background:#555; color:white; border:none; border-radius:3px; cursor:pointer; font-family:monospace;';
    saveCodeBtn.onclick = () => this._saveSceneCode();
    saveRow.appendChild(saveCodeBtn);

    // Load hierarchy back from a saved .hierarchy.json (round-trip)
    const loadBtn = document.createElement('button');
    loadBtn.id = 'load-hierarchy-btn';
    loadBtn.textContent = '\uD83D\uDCC2 Load';
    loadBtn.style.cssText = 'flex:1; padding:6px; background:#a52; color:white; border:none; border-radius:3px; cursor:pointer; font-family:monospace;';
    loadBtn.onclick = () => this._loadHierarchy();
    saveRow.appendChild(loadBtn);

    header.appendChild(saveRow);
    this.panel.appendChild(header);
  }

  /** Get the current scene name from the engine. */
  _getSceneName() {
    if (this.engine.activeScene && this.engine.activeScene.constructor) {
      return this.engine.activeScene.constructor.name;
    }
    return 'OfficeScene';
  }

  /** Populate the scene switcher dropdown from the engine's scene registry.
   *  Highlights the currently active scene. */
  _populateSceneSwitcher() {
    if (!this._sceneSwitcher) return;
    this._sceneSwitcher.innerHTML = '';

    const names = this.engine.getRegisteredSceneNames?.() ?? [this._getSceneName()];
    const currentName = this._getSceneName();

    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === currentName) opt.selected = true;
      this._sceneSwitcher.appendChild(opt);
    }

    this._sceneSwitcher.onchange = () => {
      const selectedName = this._sceneSwitcher.value;
      this._switchToScene(selectedName);
    };
  }

  /** Switch to a different registered scene by name. */
  _switchToScene(name) {
    const SceneClass = this.engine.sceneRegistry?.get(name);
    if (!SceneClass) {
      console.warn(`[LevelEditor] Unknown scene: ${name}`);
      return;
    }

    // Don't switch to the scene we're already in
    if (name === this._getSceneName()) return;

    this.deselectAll();
    this.engine.loadScene(SceneClass);

    // Refresh the editor to reflect the new scene
    this._refreshEditableObjects();
    this._populateSceneSwitcher();
    this._updateSceneHeader();
    this._markDirty();

    console.log(`[LevelEditor] Switched to scene: ${name}`);
  }

  /** Update the scene header display. */
  _updateSceneHeader() {
    if (this._sceneNameEl) this._sceneNameEl.textContent = this._getSceneName();
    this._updateDirtyIndicator();
  }

  /** Mark the scene as having unsaved changes. */
  _markDirty() {
    this._dirty = true;
    this._updateDirtyIndicator();
  }

  /** Update the dirty indicator visibility. */
  _updateDirtyIndicator() {
    if (this._dirtyIndicator) this._dirtyIndicator.style.display = this._dirty ? 'inline' : 'none';
  }

  /** Save the hierarchy structure as a JSON file download. */
  _saveHierarchy() {
    const hierarchy = this._generateJSON();
    const sceneName = this._getSceneName();
    const filename = `${sceneName}.hierarchy.json`;

    const blob = new Blob([hierarchy], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    this._dirty = false;
    this._updateDirtyIndicator();
    console.log(`[LevelEditor] Saved hierarchy: ${filename}`);
  }

  /** Save the complete scene code as a .js file download. */
  _saveSceneCode() {
    const sceneName = this._getSceneName();
    const filename = `${sceneName}.js`;
    const code = this._generateFullSceneClass();

    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    this._dirty = false;
    this._updateDirtyIndicator();
    console.log(`[LevelEditor] Saved scene code: ${filename}`);
  }

  /** Generate a complete Scene class that can replace the original file. */
  _generateFullSceneClass() {
    const sceneName = this._getSceneName();
    let code = `import * as THREE from 'three';\n`;
    code += `import RAPIER from '@dimforge/rapier3d';\n`;
    code += `import { GameObject } from '../core/GameObject.js';\n`;
    code += `import { Scene } from '../core/Scene.js';\n\n`;
    code += `export class ${sceneName} extends Scene {\n`;
    code += `  build() {\n`;
    code += `    // ── Hierarchy generated by Level Editor ──\n`;
    code += this._generateCode().split('\n').map(l => `    ${l}`).join('\n');
    code += `\n    this.engine.buildPlayer();\n`;
    code += `  }\n`;
    code += `}\n`;
    return code;
  }

  /** Open a file picker and load a saved .hierarchy.json back into the scene. */
  _loadHierarchy() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const ok = this._applyHierarchy(data);
          if (ok) console.log(`[LevelEditor] Loaded hierarchy from ${file.name}`);
          else console.warn(`[LevelEditor] Failed to load hierarchy from ${file.name}`);
        } catch (e) {
          console.warn(`[LevelEditor] Invalid hierarchy JSON: ${e.message}`);
        }
      };
      reader.readAsText(file);
      input.remove();
    };

    document.body.appendChild(input);
    input.click();
  }

  /** Rebuild the editable hierarchy from saved JSON data. Returns true on
   *  success. Clears every existing editable object first, then recreates
   *  groups, primitives (shapeType) and manifest models (assetKey), restoring
   *  transforms, colliders, glow, colour and hidden state along the way. */
  _applyHierarchy(data) {
    if (!data || !data.root || !Array.isArray(data.root.children)) {
      console.warn('[LevelEditor] _applyHierarchy: invalid data (missing root)');
      return false;
    }

    // ── Clear existing editable content ────────────────────────────
    this.deselectAll();
    if (this.sceneRoot) {
      for (const go of [...this.sceneRoot.children]) {
        this._removeObjectFromScene(go);
      }
    }
    for (const go of [...(this.dynamicObjects ?? [])]) {
      this._removeObjectFromScene(go);
    }

    // ── Rebuild from the root's children (sceneRoot itself is adopted, not recreated) ──
    for (const entry of data.root.children) {
      this._instantiateEntry(entry, this.sceneRoot);
    }

    // ── Dynamic objects (Rapier-owned position, kept at root level) ──
    for (const entry of (data.dynamicObjects ?? [])) {
      this._instantiateEntry(entry, null);
    }

    this._refreshEditableObjects();
    this._updateObjectList();
    this._dirty = false;
    this._updateDirtyIndicator();
    return true;
  }

  /** Remove a GameObject (and its descendants' physics) from the scene.
   *  Same cleanup rules as _deleteSelected, without the selection handling. */
  _removeObjectFromScene(go) {
    const allParts = go.descendants ? go.descendants() : [go];

    this.engine.scene.remove(go.object3d);

    for (const part of allParts) {
      if (part.rigidBody) {
        const handle = part.rigidBody.handle;
        this.engine.rigidBodyMap.delete(handle);
        this.engine._bodyToGO.delete(handle);
        for (const c of part.colliders ?? (part.collider ? [part.collider] : [])) {
          this.engine.world.removeCollider(c, true);
        }
        part.colliders = [];
        part.collider = null;
        try {
          this.engine.world.removeRigidBody(part.rigidBody);
        } catch (e) {
          if (!this.engine._deferredBodyRemovals) this.engine._deferredBodyRemovals = [];
          this.engine._deferredBodyRemovals.push(part.rigidBody);
        }
        part.rigidBody = null;
      }
      // PointLights (editor glow) need disposal
      part.object3d?.traverse?.((child) => {
        if (child.isLight && child.dispose) child.dispose();
      });
    }

    if (go.parent) go.parent.removeChild(go);
    const idx = this.engine._rootObjects.indexOf(go);
    if (idx >= 0) this.engine._rootObjects.splice(idx, 1);
  }

  /** Instantiate one JSON entry (group, primitive or manifest model) under a
   *  parent GameObject, restoring transform and per-object state. Returns the
   *  created/adopted GameObject or null on failure. */
  _instantiateEntry(entry, parentGO) {
    if (!entry || !entry.name) return null;

    let go = null;

    if (entry.isGroup) {
      go = new GameObject(entry.name);
      go.makeGroup();
      if (parentGO) {
        parentGO.addChild(go);
      } else {
        this.engine._rootObjects.push(go);
        this.engine.scene.add(go.object3d);
      }
    } else if (entry.shapeType) {
      // Editor-created primitive — rebuild via the same pipeline as the add panel
      go = this._createPrimitiveShape(entry.shapeType, entry.name);
      if (go && parentGO && this.sceneRoot) {
        // _createPrimitiveShape parents to sceneRoot — reparent to the group
        this.sceneRoot.removeChild(go);
        parentGO.addChild(go);
      }
    } else if (entry.bboxSize && (!entry.assetKey || !this.engine.assets?.has(entry.assetKey))) {
      // Non-manifest object (procedural wall, light fixture, etc.) — rebuild
      // as a box primitive using the measured bounding box size from the JSON.
      go = new GameObject(entry.name);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(entry.bboxSize[0], entry.bboxSize[1], entry.bboxSize[2]),
        new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.7 }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      go.object3d.add(mesh);
      if (parentGO) {
        parentGO.addChild(go);
      } else {
        this.engine._rootObjects.push(go);
        this.engine.scene.add(go.object3d);
      }
    } else if (entry.assetKey && this.engine.spawnModel) {
      try {
        go = this.engine.spawnModel(entry.assetKey, {
          name: entry.name,
          position: entry.position ?? [0, 0, 0],
        });
        if (go && parentGO) {
          parentGO.addChild(go);
        }
      } catch (e) {
        console.warn(`[LevelEditor] spawnModel failed for '${entry.assetKey}', falling back to bboxSize box`);
        go = null;
        // Fall through to bboxSize fallback below
        if (entry.bboxSize) {
          go = new GameObject(entry.name);
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(entry.bboxSize[0], entry.bboxSize[1], entry.bboxSize[2]),
            new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.7 }),
          );
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          go.object3d.add(mesh);
          if (parentGO) {
            parentGO.addChild(go);
          } else {
            this.engine._rootObjects.push(go);
            this.engine.scene.add(go.object3d);
          }
        }
      }
    }

    if (!go) {
      console.warn(`[LevelEditor] _instantiateEntry: cannot rebuild '${entry.name}' (no shapeType or spawnable assetKey '${entry.assetKey ?? 'none'}')`);
      return null;
    }

    // ── Transform ─────────────────────────────────────────────────
    go.object3d.position.fromArray(entry.position ?? [0, 0, 0]);
    if (entry.rotation) go.object3d.rotation.set(entry.rotation[0], entry.rotation[1], entry.rotation[2]);
    if (entry.scale) go.object3d.scale.fromArray(entry.scale);

    if (!entry.isGroup) {
      // ── Per-object state: collider, colour, glow, hidden ────────
      // Primitives spawn with a scale-1 collider; models may carry a
      // manifest-fitted one. Sync at the end rebuilds it at the final transform.
      if (entry.collider === false) {
        this._disableCollider(go);
      } else if (!this._hasCollider(go)) {
        this._enableCollider(go);
      }

      if (entry.color && entry.color !== '#808080') {
        this._setObjectColor(go, entry.color);
      }

      if (entry.glow?.enabled) {
        this._setGlow(go, true, entry.glow.color ?? '#ffffff', entry.glow.intensity ?? 5, entry.glow.range ?? LevelEditor.GLOW_DEFAULT_RANGE);
      }

      if (entry.hidden) {
        this._setHidden(go, true);
      }
    }

    // ── Children (depth-first) ──────────────────────────────────
    for (const child of (entry.children ?? [])) {
      this._instantiateEntry(child, go);
    }

    // The collider was measured before the transform above applied —
    // re-sync position/rotation and rebuild for scale.
    if (!entry.isGroup && go.rigidBody) {
      this._syncSingleTransformToPhysics(go);
    }

    return go;
  }

  _onMouseDown(event) {
    const rect = this.engine.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.engine.camera);
    
    // Get all meshes from editable objects
    const meshes = [];
    for (const go of this.editableObjects) {
      go.object3d.traverse((child) => {
        if (child.isMesh) {
          child.userData.gameObject = go;
          meshes.push(child);
        }
      });
    }
    
    const intersects = this.raycaster.intersectObjects(meshes, false);
    
    if (intersects.length > 0) {
      const go = intersects[0].object.userData.gameObject;
      this.selectObject(go);
    } else {
      this.deselectAll();
    }
  }
  
  selectObject(gameObject) {
    this.deselectAll();
    this.selectedObject = gameObject;
    this._updateInfoPanel();
    this._updateObjectList();
    
    // Highlight selected object (optional: add wireframe or outline)
    console.log(`[LevelEditor] Selected: ${gameObject.name}`);
  }
  
  deselectAll() {
    this.selectedObject = null;
    this._updateInfoPanel();
    this._updateObjectList();
  }
  
  _updateInfoPanel() {
    if (!this.selectedObject) {
      this.infoDiv.textContent = 'No object selected';
      return;
    }
    
    // Group-specific info panel — editable fields just like single objects
    if (this.selectedObject.isGroup) {
      const group = this.selectedObject;
      const obj = group.object3d;
      const pos = obj.position;
      const rot = obj.rotation;
      const scale = obj.scale;
      
      const inputStyle = `
        width: 70px;
        background: rgba(0,0,0,0.5);
        color: #fff;
        border: 1px solid #555;
        border-radius: 2px;
        padding: 2px 4px;
        font-family: monospace;
        font-size: 11px;
      `;
      
      this.infoDiv.innerHTML = `
        <strong>\uD83D\uDCC1 ${group.name}</strong> <span style="color: #aaa;">(group, ${group.children.length} children)</span><br>
        <span style="color: #aaa;">Position:</span><br>
        X: <input type="number" step="0.01" value="${pos.x.toFixed(3)}" data-prop="position" data-axis="x" style="${inputStyle}"><br>
        Y: <input type="number" step="0.01" value="${pos.y.toFixed(3)}" data-prop="position" data-axis="y" style="${inputStyle}"><br>
        Z: <input type="number" step="0.01" value="${pos.z.toFixed(3)}" data-prop="position" data-axis="z" style="${inputStyle}"><br>
        <span style="color: #aaa;">Rotation (deg):</span><br>
        X: <input type="number" step="1" value="${(rot.x * 180 / Math.PI).toFixed(1)}" data-prop="rotation" data-axis="x" style="${inputStyle}"><br>
        Y: <input type="number" step="1" value="${(rot.y * 180 / Math.PI).toFixed(1)}" data-prop="rotation" data-axis="y" style="${inputStyle}"><br>
        Z: <input type="number" step="1" value="${(rot.z * 180 / Math.PI).toFixed(1)}" data-prop="rotation" data-axis="z" style="${inputStyle}"><br>
        <span style="color: #aaa;">Scale:</span><br>
        X: <input type="number" step="0.01" value="${scale.x.toFixed(3)}" data-prop="scale" data-axis="x" style="${inputStyle}"><br>
        Y: <input type="number" step="0.01" value="${scale.y.toFixed(3)}" data-prop="scale" data-axis="y" style="${inputStyle}"><br>
        Z: <input type="number" step="0.01" value="${scale.z.toFixed(3)}" data-prop="scale" data-axis="z" style="${inputStyle}"><br>
        <span style="color: #aaa;">Parent:</span><br>
        <select id="parent-dropdown" style="width: 100%; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #555; border-radius: 2px; padding: 2px 4px; font-family: monospace; font-size: 11px;"></select>
      `;
      
      // Populate parent dropdown for group
      const parentSelect = this.infoDiv.querySelector('#parent-dropdown');
      if (parentSelect) {
        const groups = this._getAllGroups();
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = 'None (root)';
        if (!group.parent) noneOpt.selected = true;
        parentSelect.appendChild(noneOpt);
        
        for (const g of groups) {
          if (g === group) continue; // Can't parent to self
          const opt = document.createElement('option');
          opt.value = g.name;
          opt.textContent = g.name;
          if (group.parent === g) opt.selected = true;
          parentSelect.appendChild(opt);
        }
        
        parentSelect.onchange = () => {
          const selectedGroup = groups.find(g => g.name === parentSelect.value);
          if (selectedGroup) {
            this._reparentSelected(selectedGroup);
          } else if (parentSelect.value === '' && group.parent) {
            this._reparentSelected(this.sceneRoot);
          }
        };
      }
      
      // Add event listeners to inputs
      const inputs = this.infoDiv.querySelectorAll('input');
      inputs.forEach((input) => {
        input.addEventListener('change', (e) => this._onValueChange(e));
      });
      return;
    }
    
    const obj = this.selectedObject.object3d;
    const pos = obj.position;
    const rot = obj.rotation;
    const scale = obj.scale;
    
    const inputStyle = `
      width: 70px;
      background: rgba(0,0,0,0.5);
      color: #fff;
      border: 1px solid #555;
      border-radius: 2px;
      padding: 2px 4px;
      font-family: monospace;
      font-size: 11px;
    `;
    
    this.infoDiv.innerHTML = `
      <strong>${this.selectedObject.name}</strong><br>
      <span style="color: #aaa;">Position:</span><br>
      X: <input type="number" step="0.01" value="${pos.x.toFixed(3)}" data-prop="position" data-axis="x" style="${inputStyle}"><br>
      Y: <input type="number" step="0.01" value="${pos.y.toFixed(3)}" data-prop="position" data-axis="y" style="${inputStyle}"><br>
      Z: <input type="number" step="0.01" value="${pos.z.toFixed(3)}" data-prop="position" data-axis="z" style="${inputStyle}"><br>
      <span style="color: #aaa;">Rotation (deg):</span><br>
      X: <input type="number" step="1" value="${(rot.x * 180 / Math.PI).toFixed(1)}" data-prop="rotation" data-axis="x" style="${inputStyle}"><br>
      Y: <input type="number" step="1" value="${(rot.y * 180 / Math.PI).toFixed(1)}" data-prop="rotation" data-axis="y" style="${inputStyle}"><br>
      Z: <input type="number" step="1" value="${(rot.z * 180 / Math.PI).toFixed(1)}" data-prop="rotation" data-axis="z" style="${inputStyle}"><br>
      <span style="color: #aaa;">Scale:</span><br>
      X: <input type="number" step="0.01" value="${scale.x.toFixed(3)}" data-prop="scale" data-axis="x" style="${inputStyle}"><br>
      Y: <input type="number" step="0.01" value="${scale.y.toFixed(3)}" data-prop="scale" data-axis="y" style="${inputStyle}"><br>
      Z: <input type="number" step="0.01" value="${scale.z.toFixed(3)}" data-prop="scale" data-axis="z" style="${inputStyle}"><br>
      <span style="color: #aaa;">Parent:</span><br>
      <select id="parent-dropdown" style="width: 100%; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid #555; border-radius: 2px; padding: 2px 4px; font-family: monospace; font-size: 11px;"></select>
    `;
    
    // Populate parent dropdown
    const parentSelect = this.infoDiv.querySelector('#parent-dropdown');
    if (parentSelect) {
      const groups = this._getAllGroups();
      // Add "None (root)" option
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'None (root)';
      if (!this.selectedObject.parent) noneOpt.selected = true;
      parentSelect.appendChild(noneOpt);
      
      for (const g of groups) {
        const opt = document.createElement('option');
        opt.value = g.name;
        opt.textContent = g.name;
        if (this.selectedObject.parent === g) opt.selected = true;
        parentSelect.appendChild(opt);
      }
      
      parentSelect.onchange = () => {
        const selectedGroup = groups.find(g => g.name === parentSelect.value);
        if (selectedGroup) {
          this._reparentSelected(selectedGroup);
        } else if (parentSelect.value === '' && this.selectedObject.parent) {
          // Reparent to sceneRoot (effectively "root" within the hierarchy)
          this._reparentSelected(this.sceneRoot);
        }
      };
    }
    
    // Add collider toggle and glow controls to the info panel
    this._buildColliderAndGlowControls();
    
    // Add event listeners to inputs
    const inputs = this.infoDiv.querySelectorAll('input');
    inputs.forEach((input) => {
      input.addEventListener('change', (e) => this._onValueChange(e));
    });
  }
  
  _onValueChange(e) {
    if (!this.selectedObject) return;
    
    const obj = this.selectedObject.object3d;
    const prop = e.target.dataset.prop;
    const axis = e.target.dataset.axis;
    let value = parseFloat(e.target.value);
    
    if (isNaN(value)) return;
    
    // Convert rotation from degrees to radians
    if (prop === 'rotation') {
      value = value * Math.PI / 180;
    }
    
    if (obj[prop] && axis in obj[prop]) {
      obj[prop][axis] = value;
      console.log(`[LevelEditor] ${this.selectedObject.name}.${prop}.${axis} = ${value}`);
      
      // Sync physics body to match visual transform
      this._syncTransformToPhysics();
    }
  }
  
  /** Sync the physics rigid body to match the visual mesh transform */
  _syncTransformToPhysics() {
    if (!this.selectedObject) return;
    
    const go = this.selectedObject;
    
    // If a group is selected, sync all descendants
    if (go.isGroup) {
      for (const descendant of go.descendants()) {
        if (descendant === go) continue;
        this._syncSingleTransformToPhysics(descendant);
      }
      return;
    }
    
    this._syncSingleTransformToPhysics(go);
  }
  
  /** Sync a single GameObject's physics to match its visual transform.
   *  Uses WORLD position/rotation so nested objects sync correctly,
   *  and handles scale changes for both model and procedural colliders. */
  _syncSingleTransformToPhysics(go) {
    const obj = go.object3d;
    const rb = go.rigidBody;
    
    if (!rb) return;

    // Force world matrix recalculation (parent/child transforms may have changed)
    obj.updateMatrixWorld(true);
    
    // Use world position — correct for objects nested under groups
    const worldPos = new THREE.Vector3();
    obj.getWorldPosition(worldPos);
    rb.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
    
    // Use world rotation — correct for objects under rotated groups
    const worldQuat = new THREE.Quaternion();
    obj.getWorldQuaternion(worldQuat);
    rb.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, true);
      
    // Scale: rebuild colliders when visual scale changes
    if (this._scaleChanged(go)) {
      if (go.physicsAssetKey) {
        // Manifest-spawned model — engine knows how to rebuild
        this.engine.rebuildModelPhysicsForScale?.(go);
      } else if (go._originalSize) {
        // Procedural box — rebuild cuboid collider at new scale
        this._rebuildProceduralCollider(go);
      }
    }
  }
  
  _scaleChanged(go) {
    // Procedural objects: first build has no _physicsScale — compare to identity.
    // After a rebuild, _physicsScale holds the last collider scale — compare to that.
    if (go._originalSize) {
      const scale = go.object3d.scale;
      const previous = go._physicsScale ?? [1, 1, 1];
      return Math.abs(scale.x - previous[0]) > 1e-6
        || Math.abs(scale.y - previous[1]) > 1e-6
        || Math.abs(scale.z - previous[2]) > 1e-6;
    }
    // Model objects: check _physicsScale (set by engine at spawn)
    if (go.physicsAssetKey && go._physicsScale) {
      const scale = go.object3d.scale;
      const previous = go._physicsScale;
      return Math.abs(scale.x - previous[0]) > 1e-6
        || Math.abs(scale.y - previous[1]) > 1e-6
        || Math.abs(scale.z - previous[2]) > 1e-6;
    }
    return false;
  }

  /** Rebuild a procedural box collider from the mesh's MEASURED bounding box
   *  in the BODY'S LOCAL FRAME. Computing in body-local space (instead of
   *  world space) ensures the cuboid dimensions stay correct when the body is
   *  rotated — a world-space bbox would be axis-aligned, but the cuboid
   *  rotates with the body, causing dimension swaps on rotated objects. */
  _rebuildProceduralCollider(go) {
    const world = this.engine.world;
    const RAPIER = this.engine.RAPIER;
    if (!RAPIER) return;

    // Get the body's current transform so we can convert mesh vertices into
    // the body's local coordinate frame.
    const bodyPos = go.rigidBody.translation();
    const bodyRot = go.rigidBody.rotation();
    const bodyQuat = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
    const bodyQuatInv = bodyQuat.clone().invert();

    // Compute the bounding box in the BODY'S LOCAL FRAME by transforming each
    // mesh vertex: world → body-local (subtract position, rotate by inverse).
    // This ensures the cuboid dimensions are correct for the body's orientation.
    const localBox = new THREE.Box3();
    const localVert = new THREE.Vector3();
    let hasMesh = false;
    go.object3d.traverse((child) => {
      if (!child.isMesh) return;
      const geom = child.geometry;
      if (!geom?.attributes?.position) return;
      child.updateWorldMatrix(true, false);
      const positions = geom.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        localVert.fromBufferAttribute(positions, i);
        localVert.applyMatrix4(child.matrixWorld);
        // World → body-local: subtract body position, rotate by inverse quat
        localVert.x -= bodyPos.x;
        localVert.y -= bodyPos.y;
        localVert.z -= bodyPos.z;
        localVert.applyQuaternion(bodyQuatInv);
        localBox.expandByPoint(localVert);
        hasMesh = true;
      }
    });
    if (!hasMesh) return;

    const localSize = localBox.getSize(new THREE.Vector3());
    const localCenter = localBox.getCenter(new THREE.Vector3());
    if (!(localSize.x > 0 && localSize.y > 0 && localSize.z > 0)) return;

    // Remove old colliders
    for (const c of go.colliders ?? (go.collider ? [go.collider] : [])) {
      world.removeCollider(c, true);
    }

    // Create the cuboid in the body's local frame — no rotation needed because
    // the dimensions are already computed in that frame. The offset is the
    // local-space center of the bounding box.
    const newCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(localSize.x / 2, localSize.y / 2, localSize.z / 2)
        .setTranslation(localCenter.x, localCenter.y, localCenter.z),
      go.rigidBody,
    );
    go.colliders = [newCollider];
    go.collider = newCollider;
    go._physicsScale = [...go.object3d.scale];

    // Diagnostic: proves what Rapier was told vs what the mesh shows.
    console.log(
      `[LevelEditor] rebuilt collider '${go.name}': localSize=(${localSize.x.toFixed(2)}, ${localSize.y.toFixed(2)}, ${localSize.z.toFixed(2)}) localCenter=(${localCenter.x.toFixed(2)}, ${localCenter.y.toFixed(2)}, ${localCenter.z.toFixed(2)})`,
    );
  }

  /** Recenter a group's pivot at the average position of its direct children
   *  (in the group's local space). After this, rotating or scaling the group
   *  pivots around the children's centre instead of the group's origin. */
  _recenterPivot(group) {
    if (!group || !group.isGroup || group.children.length === 0) return;

    const center = new THREE.Vector3();
    let count = 0;
    for (const child of group.children) {
      child.object3d.updateMatrixWorld(true);
      center.add(child.object3d.position);
      count++;
    }
    if (count === 0) return;
    center.divideScalar(count);

    // Shift group to the centre
    group.object3d.position.add(center);

    // Offset each child so world positions are preserved
    for (const child of group.children) {
      child.object3d.position.sub(center);
    }

    group.object3d.updateMatrixWorld(true);
  }

  /** Recenter a single object's pivot on its own visual centre (bounding box
   *  of its meshes), preserving world position. Useful for models whose origin
   *  sits off-centre, or after moving a group leaves a stale pivot. */
  _recenterObjectOnSelf(go) {
    const obj = go.object3d;
    obj.updateMatrixWorld(true);

    // Bounding box of all mesh descendants, in world space
    const box = new THREE.Box3();
    obj.traverse((child) => {
      if (child.isMesh) box.expandByObject(child);
    });
    if (box.isEmpty()) return;

    const worldCenter = box.getCenter(new THREE.Vector3());

    // Offset from the current pivot to the visual centre, in the parent's
    // local space (obj.position is parent-space, so work in that space).
    const centerInParent = worldCenter.clone();
    if (obj.parent) obj.parent.worldToLocal(centerInParent);
    const offset = centerInParent.sub(obj.position);
    if (offset.lengthSq() < 1e-10) return; // already centred

    // Move the pivot to the visual centre
    obj.position.add(offset);

    // Shift the mesh content the other way so it stays put in the world.
    // `offset` is in parent space but mesh positions are in obj-local space,
    // so convert: un-rotate then un-scale (the full inverse of R*S).
    const d = offset.clone().negate();
    d.applyQuaternion(obj.quaternion.clone().invert());
    d.x /= obj.scale.x || 1;
    d.y /= obj.scale.y || 1;
    d.z /= obj.scale.z || 1;
    for (const child of obj.children) {
      child.position.add(d);
    }

    obj.updateMatrixWorld(true);
  }

  /** Reparent the selected object under a new parent, preserving world position.
   *  Guards against cycles and reparenting the Player. */
  _reparentSelected(newParent) {
    if (!this.selectedObject) return;
    
    const go = this.selectedObject;
    
    // Guard: never reparent the Player
    if (go.name === 'Player') {
      console.warn('[LevelEditor] Cannot reparent Player');
      return;
    }
    
    // Guard: prevent cycles — newParent must not be a descendant of go
    if (go.isGroup && go.descendants().includes(newParent)) {
      console.warn('[LevelEditor] Cannot reparent a group under its own descendant (cycle guard)');
      return;
    }
    
    // Use GameObject.reparentUnder which preserves world position
    go.reparentUnder(newParent);
    
    // Update the UI (don't rebuild hierarchy from engine._rootObjects)
    this._updateObjectList();
    this._updateInfoPanel();
  }

  /** Return all group GameObjects in the hierarchy (depth-first). */
  _getAllGroups() {
    if (!this.sceneRoot) return [];
    return this.sceneRoot.descendants().filter(go => go.isGroup);
  }

  /** Recursively mark a GameObject and all its descendant groups as expanded
   *  (i.e. remove them from the collapsed set). */
  _expandAllGroups(go) {
    if (go.isGroup) this._collapsedGroups.delete(go);
    if (go.children) {
      for (const child of go.children) {
        this._expandAllGroups(child);
      }
    }
  }

  /** Create a new empty group. If no parent is specified, adds to sceneRoot. */
  _createGroup(name, parent) {
    const group = new GameObject(name);
    group.makeGroup();
    const targetParent = parent || this.sceneRoot;
    if (targetParent) {
      targetParent.addChild(group);
    }
    // Auto-expand the new group so it's visible in the tree
    this._collapsedGroups.delete(group);
    this._updateObjectList();
    return group;
  }

  // ── Add Object functionality ─────────────────────────────────────

  /** Build the "Add Object" panel with manifest models and primitive shapes. */
  _buildAddObjectPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
      background: rgba(0, 0, 0, 0.4);
      padding: 8px;
      border-radius: 3px;
      margin-bottom: 10px;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = '\u2795 Add Object';
    title.style.cssText = 'margin-bottom: 8px; color: #aaa; font-weight: bold;';
    panel.appendChild(title);

    // Primitive shapes section
    const primitivesTitle = document.createElement('div');
    primitivesTitle.textContent = 'Primitives:';
    primitivesTitle.style.cssText = 'margin-bottom: 4px; color: #888; font-size: 11px;';
    panel.appendChild(primitivesTitle);

    const primitivesGrid = document.createElement('div');
    primitivesGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;';
    
    const shapes = this._getPrimitiveShapes();
    for (const shape of shapes) {
      const btn = document.createElement('button');
      btn.textContent = this._shapeDisplayName(shape);
      btn.style.cssText = `
        padding: 6px;
        background: #555;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-family: monospace;
        font-size: 11px;
      `;
      btn.onclick = () => this._promptAndAddPrimitive(shape);
      primitivesGrid.appendChild(btn);
    }
    panel.appendChild(primitivesGrid);

    // Manifest models section
    const modelsTitle = document.createElement('div');
    modelsTitle.textContent = 'Models:';
    modelsTitle.style.cssText = 'margin-bottom: 4px; color: #888; font-size: 11px;';
    panel.appendChild(modelsTitle);

    const modelsList = document.createElement('div');
    modelsList.style.cssText = 'max-height: 120px; overflow-y: auto;';
    
    const models = this._getManifestModels();
    for (const key of models) {
      const btn = document.createElement('button');
      btn.textContent = key;
      btn.title = `Add ${key} to scene`;
      btn.style.cssText = `
        width: 100%;
        padding: 5px 8px;
        margin-bottom: 2px;
        background: #446;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-family: monospace;
        font-size: 10px;
        text-align: left;
      `;
      btn.onclick = () => this._promptAndAddManifestModel(key);
      modelsList.appendChild(btn);
    }
    panel.appendChild(modelsList);

    this._addObjectPanel = panel;
    this.panel.appendChild(panel);
  }

  /** Get a user-friendly display name for a shape type. */
  _shapeDisplayName(shape) {
    const names = {
      box: '\u25A1 Box',
      sphere: '\u25CB Sphere',
      cylinder: '\u25E8 Cylinder',
      cone: '\u25B2 Cone',
      torus: '\u25CE Torus',
      plane: '\u25AD Plane',
    };
    return names[shape] || shape;
  }

  /** Get all model keys from the manifest (excludes textures). */
  _getManifestModels() {
    return Object.keys(ASSETS).filter(key => {
      const entry = ASSETS[key];
      return entry.type === 'model';
    });
  }

  /** Get available primitive shape types. */
  _getPrimitiveShapes() {
    return ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'];
  }

  /** Create a primitive shape GameObject and add it to the scene. */
  _createPrimitiveShape(shape, name) {
    const go = new GameObject(name);
    
    // Create the geometry based on shape type
    let geometry;
    let defaultSize;
    switch (shape) {
      case 'box':
        geometry = new THREE.BoxGeometry(1, 1, 1);
        defaultSize = [1, 1, 1];
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(0.5, 32, 16);
        defaultSize = [1, 1, 1];
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
        defaultSize = [1, 1, 1];
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(0.5, 1, 32);
        defaultSize = [1, 1, 1];
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 32);
        defaultSize = [1, 1, 1];
        break;
      case 'plane':
        geometry = new THREE.PlaneGeometry(1, 1);
        defaultSize = [1, 0, 1];
        break;
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1);
        defaultSize = [1, 1, 1];
    }

    // Create a basic material (grey)
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x808080,
      roughness: 0.7,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // For shapes like cone/cylinder, lift them so the base is at y=0
    if (shape === 'cone' || shape === 'cylinder') {
      mesh.position.y = 0.5;
    }
    // For plane, rotate to be horizontal
    if (shape === 'plane') {
      mesh.rotation.x = -Math.PI / 2;
    }
    
    go.object3d.add(mesh);
    
    // Store original size for collider rebuilds
    go._originalSize = defaultSize;
    go._shapeType = shape;
    
    // Add to scene hierarchy
    const targetParent = this.sceneRoot;
    if (targetParent) {
      targetParent.addChild(go);
    }
    
    // Add to engine's root objects for tracking
    this.engine._rootObjects.push(go);
    
    // Create a static collider from the measured bounding box
    this._enableCollider(go);
    
    // Mark as dirty
    this._markDirty();
    this._updateObjectList();
    
    console.log(`[LevelEditor] Created primitive ${shape}: ${name}`);
    return go;
  }

  /** Spawn a manifest model and add it to the hierarchy. */
  _addManifestModel(key, name) {
    if (!this.engine.spawnModel) {
      console.warn('[LevelEditor] engine.spawnModel not available');
      return null;
    }

    const go = this.engine.spawnModel(key, {
      name: name,
      position: [0, 0, 0],
    });

    if (go) {
      // Add to scene hierarchy
      if (this.sceneRoot) {
        this.sceneRoot.addChild(go);
      }
      
      // Refresh the editor to pick up the new object
      this._refreshEditableObjects();
      this._markDirty();
      
      console.log(`[LevelEditor] Added manifest model: ${name} (${key})`);
    }
    
    return go;
  }

  /** Prompt the user for a name and add a primitive shape. */
  _promptAndAddPrimitive(shape) {
    const defaultName = this._shapeDefaultName(shape);
    let name = defaultName;
    
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const result = prompt(`Name for ${shape}:`, defaultName);
      if (result === null) return null; // User cancelled
      name = result || defaultName;
    }
    
    return this._createPrimitiveShape(shape, name);
  }

  /** Prompt the user for a name and add a manifest model. */
  _promptAndAddManifestModel(key) {
    const defaultName = this._modelDefaultName(key);
    let name = defaultName;
    
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const result = prompt(`Name for ${key}:`, defaultName);
      if (result === null) return null; // User cancelled
      name = result || defaultName;
    }
    
    return this._addManifestModel(key, name);
  }

  /** Generate a default name for a primitive shape. */
  _shapeDefaultName(shape) {
    const names = {
      box: 'Box',
      sphere: 'Sphere',
      cylinder: 'Cylinder',
      cone: 'Cone',
      torus: 'Torus',
      plane: 'Plane',
    };
    return names[shape] || 'Object';
  }

  /** Generate a default name for a manifest model key. */
  _modelDefaultName(key) {
    // 'model:desk' -> 'Desk'
    const raw = key.replace(/^model:/, '');
    return raw.split(/[-_]/).map(part => 
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join('');
  }

  // ── Collider management ─────────────────────────────────────────

  /** Check whether a GameObject has an active collider (rigid body present). */
  _hasCollider(go) {
    return !!go.rigidBody;
  }

  /** Create a static cuboid collider from the mesh's measured bounding box.
   *  Used for primitives and for objects that don't already have physics. */
  _enableCollider(go) {
    if (go.rigidBody) return; // already has one
    const world = this.engine.world;
    const RAPIER = this.engine.RAPIER;
    if (!world || !RAPIER) return;

    // Measure the bounding box in world space
    go.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3();
    go.object3d.traverse((child) => {
      if (child.isMesh) box.expandByObject(child);
    });
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (!(size.x > 0 && size.y > 0 && size.z > 0)) return;

    // Get world position of the object
    const worldPos = new THREE.Vector3();
    go.object3d.getWorldPosition(worldPos);

    // Create a static rigid body at the object's world position
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(worldPos.x, worldPos.y, worldPos.z);
    go.rigidBody = world.createRigidBody(bodyDesc);

    // Create a cuboid collider with half-extents, offset by the bbox centre
    // relative to the body origin
    const localCenter = new THREE.Vector3(
      center.x - worldPos.x,
      center.y - worldPos.y,
      center.z - worldPos.z,
    );
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(localCenter.x, localCenter.y, localCenter.z);
    const collider = world.createCollider(colliderDesc, go.rigidBody);

    go.colliders = [collider];
    go.collider = collider;
    go._physicsScale = [...go.object3d.scale];

    // Register in engine maps for raycasts etc.
    if (this.engine._bodyToGO) {
      this.engine._bodyToGO.set(go.rigidBody.handle, go);
    }

    this._markDirty();
    console.log(`[LevelEditor] Collider enabled on '${go.name}': size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);
  }

  /** Remove the collider and rigid body from a GameObject. */
  _disableCollider(go) {
    if (!go.rigidBody) return;
    const world = this.engine.world;

    // Remove colliders
    for (const c of go.colliders ?? (go.collider ? [go.collider] : [])) {
      world.removeCollider(c, true);
    }

    // Remove the body
    try {
      world.removeRigidBody(go.rigidBody);
    } catch (e) {
      // Rapier throws on recursive use during world.step — defer
      if (!this.engine._deferredBodyRemovals) this.engine._deferredBodyRemovals = [];
      this.engine._deferredBodyRemovals.push(go.rigidBody);
    }

    // Clean up engine maps
    if (go.rigidBody && this.engine._bodyToGO) {
      this.engine._bodyToGO.delete(go.rigidBody.handle);
    }
    if (go.rigidBody && this.engine.rigidBodyMap) {
      this.engine.rigidBodyMap.delete(go.rigidBody.handle);
    }

    go.rigidBody = null;
    go.colliders = [];
    go.collider = null;

    this._markDirty();
    console.log(`[LevelEditor] Collider disabled on '${go.name}'`);
  }

  // ── Glow (PointLight + emissive) management ─────────────────────
  //
  // Glow detection looks for TWO kinds of PointLight:
  //   • Tagged (_editorGlowLight = true) — created or adopted by the editor.
  //   • Untagged — scene-authored lights (e.g. CeilingLight in OfficeScene).
  //     These are treated as preset values: the glow controls show them as ON
  //     with the scene's colour/intensity/range, and on first edit the editor
  //     "adopts" the light (tags it) instead of creating a duplicate.
  //
  // When glow is enabled, the original emissive of every mesh is saved so
  // that disabling glow can restore it instead of clearing to black.

  /** Default light range in metres for editor-spawned glow lights. */
  static GLOW_DEFAULT_RANGE = 8;

  /** Check whether the object has any PointLight child (tagged or scene). */
  _hasGlow(go) {
    let hasGlow = false;
    go.object3d.traverse((child) => {
      if (child.isPointLight) {
        hasGlow = true;
      }
    });
    return hasGlow;
  }

  /** Get the glow light's colour as a hex string (#rrggbb). */
  _getGlowColor(go) {
    let color = '#000000';
    go.object3d.traverse((child) => {
      if (child.isPointLight) {
        color = '#' + child.color.getHexString();
      }
    });
    return color;
  }

  /** Get the glow light's intensity. */
  _getGlowIntensity(go) {
    let intensity = 0;
    go.object3d.traverse((child) => {
      if (child.isPointLight) {
        intensity = child.intensity;
      }
    });
    return intensity;
  }

  /** Get the glow light's range (distance). */
  _getGlowRange(go) {
    let range = LevelEditor.GLOW_DEFAULT_RANGE;
    go.object3d.traverse((child) => {
      if (child.isPointLight) {
        range = child.distance;
      }
    });
    return range;
  }

  /** Find any PointLight child (tagged preferred, else first untagged). */
  _findGlowLight(go) {
    let tagged = null;
    let untagged = null;
    go.object3d.traverse((child) => {
      if (child.isPointLight) {
        if (child._editorGlowLight) tagged = child;
        else if (!untagged) untagged = child;
      }
    });
    return tagged || untagged;
  }

  /** Enable or disable a PointLight (and matching emissive) on the object.
   *
   *  When an untagged scene-authored light already exists on the object,
   *  enabling glow "adopts" it (tags it, applies new values) instead of
   *  creating a duplicate.  When disabling, the original emissive saved
   *  at enable-time is restored so the object's scene-authored glow
   *  returns instead of going black. */
  _setGlow(go, enabled, colorHex, intensity, range) {
    range = range ?? LevelEditor.GLOW_DEFAULT_RANGE;

    const existing = this._findGlowLight(go);

    if (enabled) {
      const color = new THREE.Color(colorHex);

      if (existing && !existing._editorGlowLight) {
        // ── Adopt scene-authored light: tag + update in place ──
        existing._editorGlowLight = true;
        existing.color.copy(color);
        existing.intensity = intensity;
        existing.distance = range;
        existing.castShadow = true;
        existing.shadow.mapSize.set(1024, 1024);
      } else if (existing && existing._editorGlowLight) {
        // ── Update already-adopted light ──
        existing.color.copy(color);
        existing.intensity = intensity;
        existing.distance = range;
        existing.castShadow = true;
        existing.shadow.mapSize.set(1024, 1024);
      } else {
        // ── No light at all: create one ──
        const light = new THREE.PointLight(color, intensity, range, 1.0);
        light._editorGlowLight = true;
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        go.object3d.add(light);
      }

      // Save original emissive (once) then override for glow
      go.object3d.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mat = child.material;
        if (!('emissive' in mat)) return;
        if (mat._originalEmissive === undefined) {
          mat._originalEmissive = mat.emissive.clone();
          mat._originalEmissiveIntensity = mat.emissiveIntensity;
        }
        mat.emissive.copy(color);
        mat.emissiveIntensity = Math.min(intensity, 3.0);
      });
    } else {
      // ── Disable: remove light (tagged or adopted), restore original emissive ──
      if (existing) {
        go.object3d.remove(existing);
        existing.dispose?.();
      }

      go.object3d.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mat = child.material;
        if (!('emissive' in mat)) return;
        if (mat._originalEmissive !== undefined) {
          mat.emissive.copy(mat._originalEmissive);
          mat.emissiveIntensity = mat._originalEmissiveIntensity;
          delete mat._originalEmissive;
          delete mat._originalEmissiveIntensity;
        } else {
          mat.emissive.set(0x000000);
          mat.emissiveIntensity = 0;
        }
      });
    }

    this._markDirty();
    console.log(`[LevelEditor] Glow ${enabled ? 'enabled' : 'disabled'} on '${go.name}': color=${colorHex}, intensity=${intensity}, range=${range}m`);
  }

  // ── Object colour management ───────────────────────────────────

  /** Get the base colour of the first mesh as a hex string (#rrggbb). */
  _getObjectColor(go) {
    let color = '#808080';
    go.object3d.traverse((child) => {
      if (child.isMesh && child.material && child.material.color) {
        color = '#' + child.material.color.getHexString();
        return; // take the first one found
      }
    });
    return color;
  }

  /** Set the base colour on all mesh materials. Also updates the glow light
   *  colour (if glow is active) so the emitted light matches the material. */
  _setObjectColor(go, colorHex) {
    const color = new THREE.Color(colorHex);

    // Update base colour on every mesh
    go.object3d.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      if (!('color' in child.material)) return;
      child.material.color.copy(color);
      // If emissive is active (glow on), keep it in sync
      if ('emissive' in child.material) {
        const ei = child.material.emissiveIntensity;
        if (ei > 0) {
          child.material.emissive.copy(color);
        }
      }
    });

    // Update the glow light colour if glow is on
    const light = this._findGlowLight(go);
    if (light) {
      light.color.copy(color);
    }

    this._markDirty();
    console.log(`[LevelEditor] Object colour set on '${go.name}': ${colorHex}`);
  }

  // ── Object hide/show ────────────────────────────────────────────

  /** Check whether the object's meshes are currently hidden. */
  _isHidden(go) {
    let hidden = false;
    go.object3d.traverse((child) => {
      if (child.isMesh) {
        hidden = !child.visible;
      }
    });
    return hidden;
  }

  /** Hide or show all meshes in the object. Lights and colliders persist. */
  _setHidden(go, hidden) {
    go.object3d.traverse((child) => {
      if (child.isMesh) {
        child.visible = !hidden;
      }
    });

    this._markDirty();
    console.log(`[LevelEditor] Object '${go.name}' ${hidden ? 'hidden' : 'shown'}`);
  }

  /** Build and append collider toggle + glow controls to the info panel.
   *  Called after the base transform inputs are rendered. Appends DOM elements
   *  rather than using innerHTML to preserve the existing inputs and their
   *  event listeners (which the per-frame update loop queries). */
  _buildColliderAndGlowControls() {
    if (!this.selectedObject || this.selectedObject.isGroup) return;
    const go = this.selectedObject;

    const btnStyle = 'padding:4px 8px; margin-top:4px; border:none; border-radius:3px; cursor:pointer; font-family:monospace; font-size:11px;';
    const sectionStyle = 'margin-top:8px; padding-top:6px; border-top:1px solid #444;';

    // ── Collider section ─────────────────────────────────────────────
    const colliderSection = document.createElement('div');
    colliderSection.style.cssText = sectionStyle;
    const colliderLabel = document.createElement('span');
    colliderLabel.textContent = 'Collider:';
    colliderLabel.style.color = '#aaa';
    colliderSection.appendChild(colliderLabel);
    colliderSection.appendChild(document.createElement('br'));

    const hasCollider = this._hasCollider(go);
    const colliderBtn = document.createElement('button');
    colliderBtn.id = 'collider-toggle-btn';
    colliderBtn.textContent = hasCollider ? '\u274C Remove Collider' : '\u2705 Add Collider';
    colliderBtn.style.cssText = btnStyle + `background: ${hasCollider ? '#a33' : '#3a5'}; color: white;`;
    colliderBtn.onclick = () => {
      if (this._hasCollider(go)) {
        this._disableCollider(go);
      } else {
        this._enableCollider(go);
      }
      // Refresh the panel to reflect new state
      this._updateInfoPanel();
    };
    colliderSection.appendChild(colliderBtn);
    this.infoDiv.appendChild(colliderSection);

    // ── Glow section ─────────────────────────────────────────────────
    const glowSection = document.createElement('div');
    glowSection.style.cssText = sectionStyle;
    const glowLabel = document.createElement('span');
    glowLabel.textContent = 'Glow (light):';
    glowLabel.style.color = '#aaa';
    glowSection.appendChild(glowLabel);
    glowSection.appendChild(document.createElement('br'));

    const hasGlow = this._hasGlow(go);
    const glowColor = this._getGlowColor(go);
    const glowIntensity = this._getGlowIntensity(go);
    const glowRange = this._getGlowRange(go);

    const glowRow = document.createElement('div');
    glowRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap;';

    const glowToggleBtn = document.createElement('button');
    glowToggleBtn.id = 'glow-toggle-btn';
    glowToggleBtn.textContent = hasGlow ? 'OFF' : 'ON';
    glowToggleBtn.style.cssText = btnStyle + `background: ${hasGlow ? '#3a5' : '#555'}; color: white;`;

    const colorInput = document.createElement('input');
    colorInput.id = 'glow-color';
    colorInput.type = 'color';
    colorInput.value = hasGlow ? glowColor : '#ff8800';
    colorInput.style.cssText = 'width:40px; height:22px; border:none; background:none; cursor:pointer; padding:0;';

    const intensityLabel = document.createElement('span');
    intensityLabel.textContent = 'Int:';
    intensityLabel.style.color = '#aaa';
    intensityLabel.style.fontSize = '11px';

    const intensityInput = document.createElement('input');
    intensityInput.id = 'glow-intensity';
    intensityInput.type = 'number';
    intensityInput.step = '0.5';
    intensityInput.min = '0';
    intensityInput.value = hasGlow ? glowIntensity.toFixed(1) : '5.0';
    intensityInput.style.cssText = 'width:50px; background:rgba(0,0,0,0.5); color:#fff; border:1px solid #555; border-radius:2px; padding:2px 4px; font-family:monospace; font-size:11px;';

    const rangeLabel = document.createElement('span');
    rangeLabel.textContent = 'Range:';
    rangeLabel.style.color = '#aaa';
    rangeLabel.style.fontSize = '11px';

    const rangeInput = document.createElement('input');
    rangeInput.id = 'glow-range';
    rangeInput.type = 'number';
    rangeInput.step = '1';
    rangeInput.min = '0.5';
    rangeInput.value = hasGlow ? glowRange.toFixed(1) : String(LevelEditor.GLOW_DEFAULT_RANGE);
    rangeInput.style.cssText = 'width:50px; background:rgba(0,0,0,0.5); color:#fff; border:1px solid #555; border-radius:2px; padding:2px 4px; font-family:monospace; font-size:11px;';

    // Helper: read current control values
    const readValues = () => ({
      color: colorInput.value,
      intensity: parseFloat(intensityInput.value) || 5.0,
      range: parseFloat(rangeInput.value) || LevelEditor.GLOW_DEFAULT_RANGE,
    });

    // Wire up events: toggle ON/OFF
    glowToggleBtn.onclick = () => {
      const enabled = !this._hasGlow(go);
      const { color, intensity, range } = readValues();
      this._setGlow(go, enabled, color, intensity, range);
      // Update button appearance
      glowToggleBtn.textContent = enabled ? 'OFF' : 'ON';
      glowToggleBtn.style.background = enabled ? '#3a5' : '#555';
      this._markDirty();
    };

    // Wire up color change
    colorInput.addEventListener('input', () => {
      if (!this._hasGlow(go)) return;
      const { color, intensity, range } = readValues();
      this._setGlow(go, true, color, intensity, range);
    });

    // Wire up intensity change
    intensityInput.addEventListener('change', () => {
      const val = parseFloat(intensityInput.value);
      if (isNaN(val)) return;
      if (this._hasGlow(go)) {
        const { color, range } = readValues();
        this._setGlow(go, true, color, val, range);
      }
    });

    // Wire up range change
    rangeInput.addEventListener('change', () => {
      const val = parseFloat(rangeInput.value);
      if (isNaN(val)) return;
      if (this._hasGlow(go)) {
        const { color, intensity } = readValues();
        this._setGlow(go, true, color, intensity, val);
      }
    });

    glowRow.appendChild(glowToggleBtn);
    glowRow.appendChild(colorInput);
    glowRow.appendChild(intensityLabel);
    glowRow.appendChild(intensityInput);
    glowRow.appendChild(rangeLabel);
    glowRow.appendChild(rangeInput);
    glowSection.appendChild(glowRow);
    this.infoDiv.appendChild(glowSection);

    // ── Colour picker section ─────────────────────────────────────────
    const colorSection = document.createElement('div');
    colorSection.style.cssText = sectionStyle;
    const colorLabel = document.createElement('span');
    colorLabel.textContent = 'Object Colour:';
    colorLabel.style.color = '#aaa';
    colorSection.appendChild(colorLabel);

    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:4px;';

    const objColorInput = document.createElement('input');
    objColorInput.id = 'object-color';
    objColorInput.type = 'color';
    objColorInput.value = this._getObjectColor(go);
    objColorInput.style.cssText = 'width:40px; height:22px; border:none; background:none; cursor:pointer; padding:0;';

    const resetColorBtn = document.createElement('button');
    resetColorBtn.textContent = 'Reset';
    resetColorBtn.style.cssText = btnStyle + 'background:#555; color:white;';

    const originalColor = objColorInput.value; // snapshot for reset
    resetColorBtn.onclick = () => {
      this._setObjectColor(go, originalColor);
      objColorInput.value = originalColor;
    };

    // Wire up colour change — also updates glow if active
    objColorInput.addEventListener('input', () => {
      this._setObjectColor(go, objColorInput.value);
    });

    colorRow.appendChild(objColorInput);
    colorRow.appendChild(resetColorBtn);
    colorSection.appendChild(colorRow);
    this.infoDiv.appendChild(colorSection);

    // ── Visibility section ────────────────────────────────────────────
    const visSection = document.createElement('div');
    visSection.style.cssText = sectionStyle;
    const visLabel = document.createElement('span');
    visLabel.textContent = 'Visibility:';
    visLabel.style.color = '#aaa';
    visSection.appendChild(visLabel);

    const visRow = document.createElement('div');
    visRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:4px;';

    const isHidden = this._isHidden(go);
    const hideToggleBtn = document.createElement('button');
    hideToggleBtn.id = 'hide-toggle-btn';
    hideToggleBtn.textContent = isHidden ? 'SHOW' : 'HIDE';
    hideToggleBtn.style.cssText = btnStyle + `background: ${isHidden ? '#a53' : '#555'}; color: white;`;

    hideToggleBtn.onclick = () => {
      const nowHidden = !this._isHidden(go);
      this._setHidden(go, nowHidden);
      hideToggleBtn.textContent = nowHidden ? 'SHOW' : 'HIDE';
      hideToggleBtn.style.background = nowHidden ? '#a53' : '#555';
      this._markDirty();
    };

    visRow.appendChild(hideToggleBtn);
    visSection.appendChild(visRow);
    this.infoDiv.appendChild(visSection);
  }

  /** Move selected object up in sibling order. No-op if at index 0. */
  _moveSiblingUp() {
    if (!this.selectedObject || !this.selectedObject.parent) return;
    const parent = this.selectedObject.parent;
    const idx = parent.children.indexOf(this.selectedObject);
    if (idx <= 0) return;
    
    // Swap with previous sibling in the children array
    parent.children.splice(idx, 1);
    parent.children.splice(idx - 1, 0, this.selectedObject);
    
    // Also reorder in the Three.js object3d children
    const obj3dChildren = parent.object3d.children;
    const obj3dIdx = obj3dChildren.indexOf(this.selectedObject.object3d);
    if (obj3dIdx > 0) {
      obj3dChildren.splice(obj3dIdx, 1);
      obj3dChildren.splice(obj3dIdx - 1, 0, this.selectedObject.object3d);
    }
    
    this._updateObjectList();
  }

  /** Move selected object down in sibling order. No-op if at last index. */
  _moveSiblingDown() {
    if (!this.selectedObject || !this.selectedObject.parent) return;
    const parent = this.selectedObject.parent;
    const idx = parent.children.indexOf(this.selectedObject);
    if (idx < 0 || idx >= parent.children.length - 1) return;
    
    // Swap with next sibling in the children array
    parent.children.splice(idx, 1);
    parent.children.splice(idx + 1, 0, this.selectedObject);
    
    // Also reorder in the Three.js object3d children
    const obj3dChildren = parent.object3d.children;
    const obj3dIdx = obj3dChildren.indexOf(this.selectedObject.object3d);
    if (obj3dIdx >= 0 && obj3dIdx < obj3dChildren.length - 1) {
      obj3dChildren.splice(obj3dIdx, 1);
      obj3dChildren.splice(obj3dIdx + 1, 0, this.selectedObject.object3d);
    }
    
    this._updateObjectList();
  }
    
  _updateObjectList() {
    this._updateTreeView();
  }

  /** Render the hierarchy as an indented tree view. */
  _updateTreeView() {
    this.objectList.innerHTML = '';
    
    if (this.sceneRoot) {
      for (const child of this.sceneRoot.children) {
        this._renderTreeNode(child, this.objectList, 0);
      }
    }
    // Also render dynamic objects at root level
    for (const go of this.dynamicObjects) {
      this._renderTreeNode(go, this.objectList, 0);
    }
  }

  /** Recursively render a tree node with indentation. */
  _renderTreeNode(go, container, depth) {
    const item = document.createElement('div');
    const isSelected = go === this.selectedObject;
    const indent = depth * 16;
    
    // Build row content: toggle arrow (for groups) + label
    item.style.paddingTop = '4px';
    item.style.paddingBottom = '4px';
    item.style.paddingLeft = `${indent}px`;
    item.style.paddingRight = '5px';
    item.style.margin = '1px 0';
    item.style.background = isSelected ? '#25a' : 'rgba(255,255,255,0.1)';
    item.style.borderRadius = '3px';
    item.style.cursor = 'pointer';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    
    // Toggle arrow for groups
    if (go.isGroup && go.children && go.children.length > 0) {
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = this._collapsedGroups.has(go) ? '\u25B6' : '\u25BC';
      toggle.style.cursor = 'pointer';
      toggle.style.marginRight = '4px';
      toggle.style.fontSize = '10px';
      toggle.style.userSelect = 'none';
      toggle.onclick = (e) => {
        e.stopPropagation();
        if (this._collapsedGroups.has(go)) {
          this._collapsedGroups.delete(go);
        } else {
          this._collapsedGroups.add(go);
        }
        this._updateTreeView();
      };
      item.appendChild(toggle);
    } else if (go.isGroup) {
      // Empty group — spacer instead of arrow
      const spacer = document.createElement('span');
      spacer.textContent = '\u25CB'; // empty circle
      spacer.style.marginRight = '4px';
      spacer.style.fontSize = '10px';
      spacer.style.color = '#888';
      item.appendChild(spacer);
    }
    
    // Label
    const label = document.createElement('span');
    label.textContent = `${go.isGroup ? '\uD83D\uDCC1 ' : ''}${go.name}`;
    label.style.flex = '1';
    item.appendChild(label);
    
    item.onclick = (e) => {
      e.stopPropagation();
      this.selectObject(go);
    };
    container.appendChild(item);

    // Render children recursively (only if group is expanded)
    if (go.isGroup && !this._collapsedGroups.has(go) && typeof go.children !== 'undefined') {
      for (const child of go.children) {
        this._renderTreeNode(child, container, depth + 1);
      }
    }
  }
  
  _deleteSelected() {
    if (!this.selectedObject) return;
    
    const go = this.selectedObject;
    console.log(`[LevelEditor] Deleting ${go.name}`);

    // Collect ALL descendants that have rigid bodies (including the object
    // itself) so we can clean them up. For groups, children may have their
    // own physics bodies that also need removal.
    const allParts = go.descendants ? go.descendants() : [go];

    // Remove from scene (Three.js)
    this.engine.scene.remove(go.object3d);

    // Remove physics for the object and all its descendants.
    // Defer rigid body removal to avoid Rapier "recursive use" crash when
    // delete is pressed during the physics step. We just detach our
    // references and let the world rebuild cleanly.
    for (const part of allParts) {
      if (part.rigidBody) {
        const handle = part.rigidBody.handle;
        this.engine.rigidBodyMap.delete(handle);
        this.engine._bodyToGO.delete(handle);
        // Remove colliders first (they reference the body)
        for (const c of part.colliders ?? (part.collider ? [part.collider] : [])) {
          this.engine.world.removeCollider(c, true);
        }
        part.colliders = [];
        part.collider = null;
        // Defer body removal — flag it for the engine to clean up outside
        // the physics step, or remove directly if we're not mid-step.
        try {
          this.engine.world.removeRigidBody(part.rigidBody);
        } catch (e) {
          // Rapier throws "recursive use" if called during world.step().
          // The body is already detached from our maps, so it's harmless
          // but leaked. Queue it for the engine's deferred cleanup.
          if (!this.engine._deferredBodyRemovals) this.engine._deferredBodyRemovals = [];
          this.engine._deferredBodyRemovals.push(part.rigidBody);
        }
        part.rigidBody = null;
      }
    }
    
    // Remove from parent (GameObject hierarchy)
    if (go.parent) {
      go.parent.removeChild(go);
    }

    // Remove from root objects
    const idx = this.engine._rootObjects.indexOf(go);
    if (idx >= 0) this.engine._rootObjects.splice(idx, 1);
    
    this.deselectAll();
    this._refreshEditableObjects();
    this._updateObjectList();
  }
  
  /** Generate hierarchy-aware JavaScript code as a string. */
  _generateCode() {
    let code = '// ── Generated by Level Editor ──\n\n';
    code += "import { GameObject } from '../core/GameObject.js';\n\n";

    if (this.sceneRoot) {
      code += '// ── Hierarchy ──\n';
      code += "const sceneRoot = new GameObject('SceneRoot');\n";
      code += 'sceneRoot.makeGroup();\n\n';

      for (const group of this.sceneRoot.children) {
        const varName = this._safeVarName(group.name);
        code += `const ${varName} = new GameObject('${group.name}');\n`;
        code += `${varName}.makeGroup();\n`;
        code += `sceneRoot.addChild(${varName});\n\n`;

        for (const child of (group.children || [])) {
          if (child.isGroup) continue;
          code += this._spawnCallFor(child, varName);
        }
      }
    }

    // Dynamic objects at root level
    if (this.dynamicObjects && this.dynamicObjects.length > 0) {
      code += '\n// ── Dynamic objects ──\n';
      for (const go of this.dynamicObjects) {
        code += this._spawnCallFor(go, null);
      }
    }

    return code;
  }

  /** Generate hierarchy-aware JSON as a string. Serializes the full editor
   *  state per object (assetKey/shapeType, transform, collider, glow, colour,
   *  hidden) so _applyHierarchy can round-trip the scene losslessly. */
  _generateJSON() {
    const serialize = (go) => {
      const obj = go.object3d;
      const light = this._findGlowLight(go);

      // Only keep assetKey if it's a real manifest model; procedural objects
      // (walls, lights, etc.) get null + a measured bboxSize so the loader
      // can rebuild them as box primitives instead of calling spawnModel
      // with a name that doesn't exist in the manifest.
      let assetKey = null;
      let bboxSize = null;
      if (go.isGroup) {
        // groups have no asset
      } else if (go._shapeType) {
        assetKey = null; // primitive — shapeType is enough
      } else {
        const rawKey = this._assetKeyFor(go);
        if (rawKey && this.engine.assets?.has(rawKey)) {
          assetKey = rawKey;
        } else {
          // Non-manifest object — measure bounding box for rebuild
          obj.updateMatrixWorld(true);
          const box = new THREE.Box3();
          obj.traverse(child => { if (child.isMesh) box.expandByObject(child); });
          if (!box.isEmpty()) bboxSize = box.getSize(new THREE.Vector3()).toArray();
        }
      }

      const entry = {
        name: go.name,
        isGroup: go.isGroup || false,
        position: obj ? [obj.position.x, obj.position.y, obj.position.z] : [0, 0, 0],
        rotation: obj ? [obj.rotation.x, obj.rotation.y, obj.rotation.z] : [0, 0, 0],
        scale: obj ? [obj.scale.x, obj.scale.y, obj.scale.z] : [1, 1, 1],
        assetKey,
        shapeType: go._shapeType ?? null,
        collider: !!(go.rigidBody),
        glow: light
          ? { enabled: true, color: '#' + light.color.getHexString(), intensity: light.intensity, range: light.distance }
          : { enabled: false },
        color: go.isGroup ? null : this._getObjectColor(go),
        hidden: go.isGroup ? false : this._isHidden(go),
        children: [],
      };
      if (bboxSize) entry.bboxSize = bboxSize;
      for (const child of (go.children || [])) {
        entry.children.push(serialize(child));
      }
      return entry;
    };

    const result = {
      root: this.sceneRoot ? serialize(this.sceneRoot) : null,
      dynamicObjects: (this.dynamicObjects || []).map(go => {
        const obj = go.object3d;
        const light = this._findGlowLight(go);

        let assetKey = null;
        let bboxSize = null;
        if (go._shapeType) {
          // primitive
        } else {
          const rawKey = this._assetKeyFor(go);
          if (rawKey && this.engine.assets?.has(rawKey)) {
            assetKey = rawKey;
          } else {
            obj.updateMatrixWorld(true);
            const box = new THREE.Box3();
            obj.traverse(child => { if (child.isMesh) box.expandByObject(child); });
            if (!box.isEmpty()) bboxSize = box.getSize(new THREE.Vector3()).toArray();
          }
        }

        const entry = {
          name: go.name,
          assetKey,
          shapeType: go._shapeType ?? null,
          position: obj ? [obj.position.x, obj.position.y, obj.position.z] : [0, 0, 0],
          rotation: obj ? [obj.rotation.x, obj.rotation.y, obj.rotation.z] : [0, 0, 0],
          scale: obj ? [obj.scale.x, obj.scale.y, obj.scale.z] : [1, 1, 1],
          collider: !!(go.rigidBody),
          glow: light
            ? { enabled: true, color: '#' + light.color.getHexString(), intensity: light.intensity, range: light.distance }
            : { enabled: false },
          color: this._getObjectColor(go),
          hidden: this._isHidden(go),
        };
        if (bboxSize) entry.bboxSize = bboxSize;
        return entry;
      }),
    };

    return JSON.stringify(result, null, 2);
  }

  /** Generate a single spawnModel call for a GameObject, optionally parented. */
  _spawnCallFor(go, parentVarName) {
    const obj = go.object3d;
    const pos = obj.position;
    const rot = obj.rotation;
    const scale = obj.scale;
    const assetKey = this._assetKeyFor(go);

    let code = '';
    if (parentVarName) {
      code += `// Child of ${parentVarName}\n`;
    }
    code += `this.engine.spawnModel('${assetKey}', {\n`;
    code += `  name: '${go.name}',\n`;
    code += `  position: [${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}],\n`;

    if (Math.abs(rot.y) > 1e-6) {
      code += `  rotationY: ${rot.y.toFixed(3)},\n`;
    }
    if (Math.abs(rot.x) > 1e-6 || Math.abs(rot.z) > 1e-6) {
      code += `  // TODO: this object also has X/Z rotation from the editor.\n`;
    }
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
      code += `  scale: ${this._formatScaleForCode(scale)},\n`;
    }

    code += `});\n\n`;
    return code;
  }

  /** Convert a name to a safe JS variable name. */
  _safeVarName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || '_unnamed';
  }
  
  _assetKeyFor(go) {
    return go.physicsAssetKey ?? go.assetKey ?? go.name;
  }
  
  _formatScaleForCode(scale) {
    const x = scale.x.toFixed(3);
    const y = scale.y.toFixed(3);
    const z = scale.z.toFixed(3);
    return x === y && y === z ? x : `[${x}, ${y}, ${z}]`;
  }
    
  update() {
    if (!this.enabled) return;
  
    // Update info panel values if object is selected (live transform feedback)
    if (this.selectedObject) {
      this._updateInfoPanelValues();
    }
  }
  
  /** Update just the input field values without recreating the DOM */
  _updateInfoPanelValues() {
    if (!this.selectedObject || !this.infoDiv) return;
    
    const obj = this.selectedObject.object3d;
    const inputs = this.infoDiv.querySelectorAll('input');
    
    inputs.forEach((input) => {
      const prop = input.dataset.prop;
      const axis = input.dataset.axis;
      
      if (!prop || !axis) return;
      
      let value;
      if (prop === 'position') value = obj.position[axis];
      else if (prop === 'rotation') value = obj.rotation[axis] * 180 / Math.PI;
      else if (prop === 'scale') value = obj.scale[axis];
      
      // Only update if the value actually changed (prevents cursor jumping)
      if (value !== undefined && document.activeElement !== input) {
        const formatted = prop === 'rotation' ? value.toFixed(1) : value.toFixed(3);
        if (input.value !== formatted) {
          input.value = formatted;
        }
      }
    });
  }
  
  dispose() {
    this.panel?.remove();
  }
}
