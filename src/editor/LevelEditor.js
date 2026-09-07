import * as THREE from 'three';

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
    this.editableObjects = this.engine._rootObjects.filter((go) => {
      // Filter out player and non-editable objects
      return go.name !== 'Player' && go.object3d;
    });
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
    `;
    
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
    
  _updateObjectList() {
    this.objectList.innerHTML = '';
    for (const go of this.editableObjects) {
      const item = document.createElement('div');
      item.textContent = go.name;
      item.style.cssText = `
        padding: 5px;
        margin: 2px 0;
        background: ${go === this.selectedObject ? '#25a' : 'rgba(255,255,255,0.1)'};
        border-radius: 3px;
        cursor: pointer;
      `;
      item.onclick = () => this.selectObject(go);
      this.objectList.appendChild(item);
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
    const layout = [];
    for (const go of this.editableObjects) {
      const obj = go.object3d;
      layout.push({
        assetKey: this._assetKeyFor(go),
        name: go.name,
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      });
    }
    
    const json = JSON.stringify(layout, null, 2);
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
    let code = '// ── Generated by Level Editor ──\n\n';
    
    for (const go of this.editableObjects) {
      const obj = go.object3d;
      const pos = obj.position;
      const rot = obj.rotation;
      const scale = obj.scale;
      
      const assetKey = this._assetKeyFor(go);
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
    }
    
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level-layout.js';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('[LevelEditor] Exported code layout');
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
