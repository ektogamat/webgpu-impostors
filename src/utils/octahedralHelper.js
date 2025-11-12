import * as THREE from "three";

/**
 * Octahedral impostor helper functions.
 * Adapted from three-octahedral-impostor-main example.
 * Comments in English per project guidelines.
 */

export const OCT_TYPE = {
  HEMI: 0,
  FULL: 1,
};

/**
 * Creates a grid of points for octahedral mapping.
 * @param {number} xCells - Number of cells in X direction
 * @param {number} yCells - Number of cells in Y direction
 * @param {number} width - Width of the grid
 * @param {number} height - Height of the grid
 * @param {boolean} useCenter - Whether to center the grid
 * @returns {number[]} Array of vertex positions [x, y, z, ...]
 */
function createGrid(xCells = 6, yCells = 6, width = 1, height = 1, useCenter = true) {
  const xInc = width / xCells;
  const yInc = height / yCells;
  let ox = 0;
  let oz = 0;

  if (useCenter) {
    ox = -width * 0.5;
    oz = -height * 0.5;
  }

  const out = [];
  for (let yi = 0; yi <= yCells; yi++) {
    const z = yi * yInc;
    for (let xi = 0; xi <= xCells; xi++) {
      const x = xi * xInc;
      out.push(x + ox, 0, z + oz);
    }
  }

  return out;
}

/**
 * Converts array of positions to sphere normals.
 * @param {number[]} ary - Array of positions
 * @returns {number[]} Array of normalized positions
 */
function toSphereNormal(ary) {
  const rtn = new Array(ary.length);

  for (let i = 0; i < ary.length; i += 3) {
    const x = ary[i + 0];
    const y = ary[i + 1];
    const z = ary[i + 2];

    const m = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    rtn[i + 0] = x / m;
    rtn[i + 1] = y / m;
    rtn[i + 2] = z / m;
  }

  return rtn;
}

/**
 * Generates indices for octahedral plane.
 * @param {number} isFull - 0 for hemisphere, 1 for full octahedron
 * @param {number} xCells - Number of cells in X direction
 * @param {number} yCells - Number of cells in Y direction
 * @returns {number[]} Array of indices
 */
function octPlaneIndices(isFull = 0, xCells = 6, yCells = 6) {
  const out = [];
  const xLen = xCells + 1;
  const xHalf = Math.floor(xCells * 0.5);
  const yHalf = Math.floor(yCells * 0.5);

  for (let y = 0; y < yCells; y++) {
    const r0 = xLen * y;
    const r1 = xLen * (y + 1);

    for (let x = 0; x < xCells; x++) {
      const a = r0 + x;
      const b = r1 + x;
      const c = r1 + x + 1;
      const d = r0 + x + 1;
      const alt = (Math.floor(x / xHalf) + Math.floor(y / yHalf)) % 2;

      if (alt === isFull) {
        out.push(a, b, c, c, d, a); // backward slash
      } else {
        out.push(d, a, b, b, c, d); // forward slash
      }
    }
  }

  return out;
}

/**
 * Converts plane points to hemisphere octahedron.
 * @param {number[]} ary - Array of plane points
 */
function octHemi(ary) {
  const radius = 0.5;

  for (let i = 0; i < ary.length; i += 3) {
    // Convert plane coordinates to UV-like values
    const ox = ary[i + 0] + 0.5; // U
    const oy = ary[i + 2] + 0.5; // V

    // UV to hemisphere normal direction
    let x = ox - oy;
    let z = -1 + ox + oy;
    let y = 1 - Math.abs(x) - Math.abs(z);

    // Normalize
    const m = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    ary[i + 0] = (x / m) * radius;
    ary[i + 1] = (y / m) * radius;
    ary[i + 2] = (z / m) * radius;
  }
}

/**
 * Converts plane points to full octahedron.
 * @param {number[]} ary - Array of plane points
 */
function octFull(ary) {
  const radius = 0.5;

  for (let i = 0; i < ary.length; i += 3) {
    // Convert to -1 to 1 range
    const u = ary[i + 0] * 2.0;
    const v = ary[i + 2] * 2.0;

    // North hemisphere
    let x = u;
    let z = v;
    let y = 1 - Math.abs(x) - Math.abs(z);

    // Fix XZ for South hemisphere
    if (y < 0) {
      const ox = x;
      const oz = z;
      x = Math.sign(ox) * (1.0 - Math.abs(oz));
      z = Math.sign(oz) * (1.0 - Math.abs(ox));
      y = 1 - Math.abs(x) - Math.abs(z);
    }

    // Normalize
    const m = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    ary[i + 0] = (x / m) * radius;
    ary[i + 1] = (y / m) * radius;
    ary[i + 2] = (z / m) * radius;
  }
}

/**
 * Builds octahedral mesh data.
 * @param {number} octType - OCT_TYPE.HEMI or OCT_TYPE.FULL
 * @param {number} gridSize - Size of the grid (number of cells)
 * @returns {Object} Object containing plane points, octahedron points, and geometry
 */
export function buildOctahedralMesh(octType, gridSize) {
  const pntPlane = createGrid(gridSize, gridSize);
  const indices = octPlaneIndices(octType, gridSize, gridSize);

  const pntOct = pntPlane.slice();
  switch (octType) {
    case OCT_TYPE.HEMI:
      octHemi(pntOct);
      break;
    case OCT_TYPE.FULL:
      octFull(pntOct);
      break;
    default:
      throw new Error(`Unknown octahedron type: ${octType}`);
  }

  const normals = toSphereNormal(pntOct);

  // Create geometry for raycasting
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(pntOct), 3)
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(normals), 3)
  );
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return {
    pntPlane, // Points on the plane (for atlas UV mapping)
    pntOct, // Points on the octahedron (for view direction sampling)
    indices,
    geometry, // Geometry for raycasting
  };
}

/**
 * Converts flat index to grid coordinates.
 * @param {number} flatIndex - Flat index in the grid
 * @param {number} gridSize - Size of the grid
 * @returns {Object} Object with row and col properties
 */
export function flatIndexToCoords(flatIndex, gridSize) {
  const row = Math.floor(flatIndex / gridSize);
  const col = flatIndex - row * gridSize;
  return { row, col };
}

/**
 * Converts grid coordinates to flat index.
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} gridSize - Size of the grid
 * @returns {number} Flat index
 */
export function coordsToFlatIndex(row, col, gridSize) {
  return row * gridSize + col;
}

