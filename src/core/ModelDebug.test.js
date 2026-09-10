import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { logModelDebugInfo, getModelBounds } from './ModelUtils.js';

describe('Model debug logging', () => {
  it('measures bounding box dimensions correctly', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
    mesh.position.set(1, 2, 3);
    
    const bounds = getModelBounds(mesh);
    
    expect(bounds.size).toEqual([2, 3, 4]);
    expect(bounds.center).toEqual([1, 2, 3]);
  });

  it('logs model info to console when debug function is called', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.name = 'TestObject';
    mesh.position.set(5, 0, -3);
    
    logModelDebugInfo('model:test', mesh);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('model:test')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('TestObject')
    );
    
    consoleSpy.mockRestore();
  });

  it('includes scale information in debug output', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.name = 'ScaledObject';
    mesh.scale.set(2, 2, 2);
    
    logModelDebugInfo('model:scaled', mesh);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('scale')
    );
    
    consoleSpy.mockRestore();
  });
});
