/**
 * SpatialGrid - Fast spatial partitioning for frustum culling
 * Divides 3D space into cells for efficient proximity queries
 * Comments in English per project guidelines.
 */
export class SpatialGrid {
  /**
   * @param {Object} bounds - { min: [x,y,z], max: [x,y,z] }
   * @param {number} cellSize - Size of each grid cell
   */
  constructor(bounds, cellSize) {
    this.bounds = bounds;
    this.cellSize = cellSize;
    this.grid = new Map();
    
    // Calculate grid dimensions
    this.gridSize = [
      Math.ceil((bounds.max[0] - bounds.min[0]) / cellSize),
      Math.ceil((bounds.max[1] - bounds.min[1]) / cellSize),
      Math.ceil((bounds.max[2] - bounds.min[2]) / cellSize),
    ];
    
    console.log(`✓ SpatialGrid initialized: ${this.gridSize.join('x')} cells`);
  }
  
  /**
   * Get cell key for a position
   * @param {Array} position - [x, y, z]
   * @returns {string} Cell key "x,y,z"
   */
  getCellKey(position) {
    const x = Math.floor((position[0] - this.bounds.min[0]) / this.cellSize);
    const y = Math.floor((position[1] - this.bounds.min[1]) / this.cellSize);
    const z = Math.floor((position[2] - this.bounds.min[2]) / this.cellSize);
    
    // Clamp to grid bounds
    const clampedX = Math.max(0, Math.min(x, this.gridSize[0] - 1));
    const clampedY = Math.max(0, Math.min(y, this.gridSize[1] - 1));
    const clampedZ = Math.max(0, Math.min(z, this.gridSize[2] - 1));
    
    return `${clampedX},${clampedY},${clampedZ}`;
  }
  
  /**
   * Get cell coordinates from key
   * @param {string} key - Cell key "x,y,z"
   * @returns {Array} [x, y, z]
   */
  getCellCoords(key) {
    return key.split(',').map(Number);
  }
  
  /**
   * Get world position of cell center
   * @param {string} key - Cell key
   * @returns {Array} [x, y, z]
   */
  getCellCenter(key) {
    const [x, y, z] = this.getCellCoords(key);
    return [
      this.bounds.min[0] + (x + 0.5) * this.cellSize,
      this.bounds.min[1] + (y + 0.5) * this.cellSize,
      this.bounds.min[2] + (z + 0.5) * this.cellSize,
    ];
  }
  
  /**
   * Add instance to grid
   * @param {Object} instance - Instance data with position property
   * @param {number} index - Instance index
   */
  addInstance(instance, index) {
    const key = this.getCellKey(instance.position);
    
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    
    this.grid.get(key).push({ instance, index });
  }
  
  /**
   * Query instances near camera position
   * @param {Object} cameraPos - THREE.Vector3 camera position
   * @param {number} radius - Query radius
   * @returns {Array} Array of { instance, index, distance, cellKey }
   */
  queryNearCamera(cameraPos, radius) {
    const visible = [];
    const radiusSq = radius * radius;
    
    // Calculate which cells to check (cells within radius)
    const minCellX = Math.floor((cameraPos.x - radius - this.bounds.min[0]) / this.cellSize);
    const maxCellX = Math.ceil((cameraPos.x + radius - this.bounds.min[0]) / this.cellSize);
    const minCellY = Math.floor((cameraPos.y - radius - this.bounds.min[1]) / this.cellSize);
    const maxCellY = Math.ceil((cameraPos.y + radius - this.bounds.min[1]) / this.cellSize);
    const minCellZ = Math.floor((cameraPos.z - radius - this.bounds.min[2]) / this.cellSize);
    const maxCellZ = Math.ceil((cameraPos.z + radius - this.bounds.min[2]) / this.cellSize);
    
    // Clamp to grid bounds
    const startX = Math.max(0, minCellX);
    const endX = Math.min(this.gridSize[0] - 1, maxCellX);
    const startY = Math.max(0, minCellY);
    const endY = Math.min(this.gridSize[1] - 1, maxCellY);
    const startZ = Math.max(0, minCellZ);
    const endZ = Math.min(this.gridSize[2] - 1, maxCellZ);
    
    // Check cells in range
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        for (let z = startZ; z <= endZ; z++) {
          const key = `${x},${y},${z}`;
          const cell = this.grid.get(key);
          
          if (!cell) continue;
          
          // Check each instance in cell
          cell.forEach(({ instance, index }) => {
            const dx = instance.position[0] - cameraPos.x;
            const dy = instance.position[1] - cameraPos.y;
            const dz = instance.position[2] - cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            
            if (distSq <= radiusSq) {
              visible.push({
                instance,
                index,
                distance: Math.sqrt(distSq),
                cellKey: key,
              });
            }
          });
        }
      }
    }
    
    // Sort by distance (closest first) for LOD optimization
    visible.sort((a, b) => a.distance - b.distance);
    
    return visible;
  }
  
  /**
   * Get all instances in grid (for debugging)
   * @returns {Array} All instances
   */
  getAllInstances() {
    const all = [];
    this.grid.forEach((instances, key) => {
      instances.forEach(({ instance, index }) => {
        all.push({ instance, index, cellKey: key });
      });
    });
    return all;
  }
  
  /**
   * Get statistics
   * @returns {Object} Stats
   */
  getStats() {
    let totalInstances = 0;
    let occupiedCells = 0;
    let maxInstancesPerCell = 0;
    let minInstancesPerCell = Infinity;
    
    this.grid.forEach((instances) => {
      totalInstances += instances.length;
      occupiedCells++;
      maxInstancesPerCell = Math.max(maxInstancesPerCell, instances.length);
      minInstancesPerCell = Math.min(minInstancesPerCell, instances.length);
    });
    
    const avgInstancesPerCell = totalInstances / occupiedCells || 0;
    
    return {
      totalCells: this.gridSize[0] * this.gridSize[1] * this.gridSize[2],
      occupiedCells,
      totalInstances,
      avgInstancesPerCell: avgInstancesPerCell.toFixed(2),
      maxInstancesPerCell,
      minInstancesPerCell: minInstancesPerCell === Infinity ? 0 : minInstancesPerCell,
      occupancy: ((occupiedCells / (this.gridSize[0] * this.gridSize[1] * this.gridSize[2])) * 100).toFixed(2) + '%',
    };
  }
  
  /**
   * Clear grid
   */
  clear() {
    this.grid.clear();
  }
  
  /**
   * Debug: Print grid statistics
   */
  printStats() {
    const stats = this.getStats();
    console.log('📊 SpatialGrid Statistics:');
    console.log(`  Grid Size: ${this.gridSize.join('x')}`);
    console.log(`  Total Cells: ${stats.totalCells}`);
    console.log(`  Occupied Cells: ${stats.occupiedCells} (${stats.occupancy})`);
    console.log(`  Total Instances: ${stats.totalInstances}`);
    console.log(`  Avg Instances/Cell: ${stats.avgInstancesPerCell}`);
    console.log(`  Max Instances/Cell: ${stats.maxInstancesPerCell}`);
    console.log(`  Min Instances/Cell: ${stats.minInstancesPerCell}`);
  }
}

/**
 * Create optimized spatial grid for given area
 * @param {Array} areaSize - [width, depth]
 * @param {Array} position - [x, y, z] center position
 * @param {number} cellSize - Cell size (default: auto-calculated)
 * @returns {SpatialGrid}
 */
export function createSpatialGridForArea(areaSize, position = [0, 0, 0], cellSize = null) {
  const [width, depth] = areaSize;
  const [x, y, z] = position;
  
  // Auto-calculate cell size if not provided
  // Rule of thumb: ~10-20 cells per dimension
  const autoCellSize = cellSize || Math.max(width, depth) / 15;
  
  const bounds = {
    min: [x - width / 2, y - 10, z - depth / 2],
    max: [x + width / 2, y + 10, z + depth / 2],
  };
  
  return new SpatialGrid(bounds, autoCellSize);
}

