import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

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

  /** Recursively add a GameObject and all its descendants to editableObjects. */
  _collectEditableObjects(go) {
    if (!this.editableObjects.includes(go)) {
      this.editableObjects.push(go);
    }
    if (go.isGroup) this._collapsedGroups.delete(go);
    if (go.children) {
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
    
    // Export buttons
    const buttonDiv = document.createElement('div');
    buttonDiv.style.display = 'flex';
    buttonDiv.style.gap = '5px';
    
    const exportJsonBtn = document.createElement('button');
    exportJsonBtn.textContent = 'Export JSON';
    exportJsonBtn.style.cssText = `
      flex: 1;
      padding: 8px;
      background: #2a5;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-family: monospace;
    `;
    exportJsonBtn.onclick = () => this._exportJSON();
    buttonDiv.appendChild(exportJsonBtn);
    
    const exportCodeBtn = document.createElement('button');
    exportCodeBtn.textContent = 'Export Code';
    exportCodeBtn.style.cssText = `
      flex: 1;
      padding: 8px;
      background: #25a;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-family: monospace;
    `;
    exportCodeBtn.onclick = () => this._exportCode();
    buttonDiv.appendChild(exportCodeBtn);
    
    this.panel.appendChild(buttonDiv);

    // Export mode buttons (standalone scene file + hierarchy JSON)
    const exportModeDiv = document.createElement('div');
    exportModeDiv.style.display = 'flex';
    exportModeDiv.style.gap = '5px';
    exportModeDiv.style.marginTop = '5px';

    const exportStandaloneBtn = document.createElement('button');
    exportStandaloneBtn.textContent = '\uD83D\uDCE6 Standalone';
    exportStandaloneBtn.style.cssText = 'flex:1; padding:8px; background:#a52; color:white; border:none; border-radius:3px; cursor:pointer; font-family:monospace;';
    exportStandaloneBtn.onclick = () => this._exportStandalone();
    exportModeDiv.appendChild(exportStandaloneBtn);

    const exportHierBtn = document.createElement('button');
    exportHierBtn.textContent = '\uD83C\uDF33 Hierarchy';
    exportHierBtn.style.cssText = 'flex:1; padding:8px; background:#25a; color:white; border:none; border-radius:3px; cursor:pointer; font-family:monospace;';
    exportHierBtn.onclick = () => this._exportHierarchy();
    exportModeDiv.appendChild(exportHierBtn);

    this.panel.appendChild(exportModeDiv);
    
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

  /** Export a complete standalone Scene class as a downloadable file. */
  _exportStandalone() {
    const code = this._generateFullSceneClass();
    const sceneName = this._getSceneName();
    const filename = `${sceneName}.standalone.js`;

    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    console.log(`[LevelEditor] Exported standalone: ${filename}`);
  }

  /** Export just the hierarchy structure as a JSON file. */
  _exportHierarchy() {
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
    console.log(`[LevelEditor] Exported hierarchy: ${filename}`);
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
  
  /** Sync a single GameObject's physics to match its visual transform. */
  _syncSingleTransformToPhysics(go) {
    const obj = go.object3d;
    const rb = go.rigidBody;
    
    if (!rb) return; // No physics body, nothing to sync
    
    // Update rigid body position
    const pos = obj.position;
    rb.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    
    // Update rigid body rotation
    const rot = obj.quaternion;
    rb.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
      
    // Rapier colliders cannot be scaled in place. Manifest-spawned models ask
    // the engine to rebuild their collider shapes when visual scale changes.
    if (this._scaleChanged(go)) {
      this.engine.rebuildModelPhysicsForScale?.(go);
    }
  }
  
  _scaleChanged(go) {
    if (!go.physicsAssetKey || !go._physicsScale) return false;
  
    const scale = go.object3d.scale;
    const previous = go._physicsScale;
    return Math.abs(scale.x - previous[0]) > 1e-6
      || Math.abs(scale.y - previous[1]) > 1e-6
      || Math.abs(scale.z - previous[2]) > 1e-6;
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
    
    // Remove from scene
    this.engine.scene.remove(go.object3d);
    
    // Remove from rigid body map
    if (go.rigidBody) {
      this.engine.rigidBodyMap.delete(go.rigidBody.handle);
      this.engine._bodyToGO.delete(go.rigidBody.handle);
      this.engine.world.removeRigidBody(go.rigidBody);
    }
    
    // Remove from root objects
    const idx = this.engine._rootObjects.indexOf(go);
    if (idx >= 0) this.engine._rootObjects.splice(idx, 1);
    
    this.deselectAll();
    this._refreshEditableObjects();
    this._updateObjectList();
  }
  
  _exportJSON() {
    const json = this._generateJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level-layout.json';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('[LevelEditor] Exported JSON layout');
  }
  
  _exportCode() {
    const code = this._generateCode();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level-layout.js';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('[LevelEditor] Exported code layout');
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

  /** Generate hierarchy-aware JSON as a string. */
  _generateJSON() {
    const serialize = (go) => {
      const obj = go.object3d;
      const entry = {
        name: go.name,
        isGroup: go.isGroup || false,
        position: obj ? [obj.position.x, obj.position.y, obj.position.z] : [0, 0, 0],
        rotation: obj ? [obj.rotation.x, obj.rotation.y, obj.rotation.z] : [0, 0, 0],
        scale: obj ? [obj.scale.x, obj.scale.y, obj.scale.z] : [1, 1, 1],
        assetKey: this._assetKeyFor(go),
        children: [],
      };
      for (const child of (go.children || [])) {
        entry.children.push(serialize(child));
      }
      return entry;
    };

    const result = {
      root: this.sceneRoot ? serialize(this.sceneRoot) : null,
      dynamicObjects: (this.dynamicObjects || []).map(go => {
        const obj = go.object3d;
        return {
          name: go.name,
          assetKey: this._assetKeyFor(go),
          position: obj ? [obj.position.x, obj.position.y, obj.position.z] : [0, 0, 0],
          rotation: obj ? [obj.rotation.x, obj.rotation.y, obj.rotation.z] : [0, 0, 0],
          scale: obj ? [obj.scale.x, obj.scale.y, obj.scale.z] : [1, 1, 1],
        };
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
