import { buildOctahedralMesh } from "./octahedralHelper";

const samplingCache = new Map();

function encodeDirectionToOctUV(direction, octType) {
  // Direction is from object to camera (normalized)
  // viewDir = object - camera, so if camera is above, viewDir.y < 0
  // But atlas was baked using pntOct which points from object to camera
  // pntOct has y >= 0 in HEMI mode (upper hemisphere only)
  // So we need to handle the mapping correctly:
  // - When camera is above (viewDir.y < 0), we want to use top view (y = 1 in pntOct space)
  // - When camera is below (viewDir.y > 0), we project to horizontal (y = 0 in pntOct space)

  const x = direction.x;
  const y = direction.y;
  const z = direction.z;

  if (octType === 0) {
    // HEMI mode: only use upper hemisphere (y >= 0 in pntOct space)
    // This doubles resolution for side views (most common for trees/foliage)
    // In HEMI mode, pntOct always has y >= 0 (upper hemisphere)
    // So when viewDir.y < 0 (camera above), we need to map to top view
    // When viewDir.y > 0 (camera below), we project to horizontal

    // For HEMI, we need to map viewDir to pntOct space where y >= 0
    // If viewDir.y < 0 (camera above), flip to use top view: use -viewDir
    // If viewDir.y > 0 (camera below), project to horizontal: set y = 0
    let mappedX = x;
    let mappedY = y;
    let mappedZ = z;

    if (y < 0) {
      // Camera is above: flip to use top view (this is the upper hemisphere)
      // Keep X and Z orientation, only flip Y to positive
      // This preserves the horizontal orientation while using top view
      mappedX = x; // Keep X as-is to preserve left/right orientation
      mappedY = -y; // Now positive (top view)
      mappedZ = z; // Keep Z as-is to preserve forward/back orientation
    } else if (y > 0) {
      // Camera is below: project to horizontal plane
      mappedY = 0;
      const len = Math.sqrt(x * x + z * z);
      if (len > 1e-9) {
        mappedX = x / len;
        mappedZ = z / len;
      } else {
        mappedX = 0;
        mappedZ = 1;
      }
    }
    // If y == 0, use as-is (horizontal view)

    // Normalize using L1 norm (sum of absolutes) to match octHemi encoding
    const absX = Math.abs(mappedX);
    const absY = Math.abs(mappedY);
    const absZ = Math.abs(mappedZ);
    const sum = absX + absY + absZ;

    if (sum < 1e-9) {
      return { u: 0.5, v: 0.5 };
    }

    let nx = mappedX / sum;
    let ny = mappedY / sum;
    let nz = mappedZ / sum;

    // Ensure y >= 0 (should already be true after mapping, but double-check)
    if (ny < 0) {
      ny = 0;
      const len = Math.sqrt(nx * nx + nz * nz);
      if (len > 1e-9) {
        nx /= len;
        nz /= len;
      }
      const absX2 = Math.abs(nx);
      const absZ2 = Math.abs(nz);
      const sum2 = absX2 + absZ2;
      if (sum2 > 1e-9) {
        nx = nx / sum2;
        nz = nz / sum2;
      }
    }

    // Convert hemisphere direction to UV using inverse of octHemi
    // octHemi encoding: x = ox - oy, z = -1 + ox + oy, y = 1 - |x| - |z|
    // Solving for ox, oy: ox = (x + z + 1) / 2, oy = (z + 1 - x) / 2
    const ox = (nx + nz + 1) / 2;
    const oy = (nz + 1 - nx) / 2;

    return {
      u: Math.max(0, Math.min(1, ox)),
      v: Math.max(0, Math.min(1, oy)),
    };
  } else {
    // FULL mode: standard octahedral encoding (both hemispheres)
    // Use L1 normalization to match octFull encoding
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);
    const sum = absX + absY + absZ;

    if (sum < 1e-9) {
      return { u: 0.5, v: 0.5 };
    }

    let nx = x / sum;
    let ny = y / sum;
    let nz = z / sum;

    // Handle lower hemisphere (y < 0)
    if (ny < 0) {
      const signX = nx >= 0 ? 1 : -1;
      const signZ = nz >= 0 ? 1 : -1;
      const newX = (1 - Math.abs(nz)) * signX;
      const newZ = (1 - Math.abs(nx)) * signZ;
      nx = newX;
      nz = newZ;
    }

    // Convert to UV: map [-1, 1] to [0, 1]
    return {
      u: nx * 0.5 + 0.5,
      v: nz * 0.5 + 0.5,
    };
  }
}

function computeBarycentric2D(px, py, triangleUV, target) {
  const ax = triangleUV[0][0];
  const ay = triangleUV[0][1];
  const bx = triangleUV[1][0];
  const by = triangleUV[1][1];
  const cx = triangleUV[2][0];
  const cy = triangleUV[2][1];

  const v0x = bx - ax;
  const v0y = by - ay;
  const v1x = cx - ax;
  const v1y = cy - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const denom = v0x * v1y - v1x * v0y;

  if (Math.abs(denom) < 1e-9) {
    target.set(1 / 3, 1 / 3, 1 / 3);
    return target;
  }

  const invDenom = 1 / denom;
  const v = (v2x * v1y - v1x * v2y) * invDenom;
  const w = (v0x * v2y - v2x * v0y) * invDenom;
  const u = 1 - v - w;

  const clampedU = Math.max(u, 0);
  const clampedV = Math.max(v, 0);
  const clampedW = Math.max(w, 0);
  const sum = clampedU + clampedV + clampedW;

  if (sum <= 0) {
    target.set(1 / 3, 1 / 3, 1 / 3);
  } else {
    target.set(clampedU / sum, clampedV / sum, clampedW / sum);
  }

  return target;
}

function buildSamplingCache(octType, gridSize) {
  const key = `${octType}_${gridSize}`;
  if (samplingCache.has(key)) {
    return samplingCache.get(key);
  }

  const octahedralData = buildOctahedralMesh(octType, gridSize);
  const geometry = octahedralData.geometry;
  const indexAttr = geometry.getIndex();

  if (!indexAttr) {
    samplingCache.set(key, null);
    return null;
  }

  const indexArray = indexAttr.array;
  const stride = gridSize + 1;
  const cells = new Array(gridSize * gridSize);
  let cursor = 0;

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const tri1 = [
        indexArray[cursor],
        indexArray[cursor + 1],
        indexArray[cursor + 2],
      ];
      const tri2 = [
        indexArray[cursor + 3],
        indexArray[cursor + 4],
        indexArray[cursor + 5],
      ];
      cursor += 6;

      const isBackslash =
        tri1[1] - tri1[0] === stride && tri1[2] - tri1[1] === 1;

      const triangles = isBackslash
        ? [
            {
              indices: tri1,
              uv: [
                [0, 0],
                [0, 1],
                [1, 1],
              ],
            },
            {
              indices: tri2,
              uv: [
                [1, 1],
                [1, 0],
                [0, 0],
              ],
            },
          ]
        : [
            {
              indices: tri1,
              uv: [
                [1, 0],
                [0, 0],
                [0, 1],
              ],
            },
            {
              indices: tri2,
              uv: [
                [0, 1],
                [1, 1],
                [1, 0],
              ],
            },
          ];

      cells[row * gridSize + col] = {
        isBackslash,
        triangles,
      };
    }
  }

  geometry.dispose();

  const cache = { gridSize, octType, cells };
  samplingCache.set(key, cache);
  return cache;
}

export function getSamplingCache(octType, gridSize) {
  return buildSamplingCache(octType, gridSize);
}

export function sampleOctahedralDirection({
  direction,
  cache,
  indicesTarget,
  weightsTarget,
}) {
  if (!cache) {
    console.warn("sampleOctahedralDirection: No cache provided");
    return false;
  }

  if (!direction || !direction.isVector3) {
    console.warn("sampleOctahedralDirection: Invalid direction");
    return false;
  }

  // Ensure direction is normalized
  const normalizedDir = direction.clone().normalize();
  if (normalizedDir.length() < 0.1) {
    console.warn(
      "sampleOctahedralDirection: Direction too small after normalization"
    );
    return false;
  }

  const uv = encodeDirectionToOctUV(normalizedDir, cache.octType);

  // Validate UV coordinates
  if (
    isNaN(uv.u) ||
    isNaN(uv.v) ||
    uv.u < 0 ||
    uv.u > 1 ||
    uv.v < 0 ||
    uv.v > 1
  ) {
    console.warn("sampleOctahedralDirection: Invalid UV coordinates", uv);
    return false;
  }

  const gridSize = cache.gridSize;

  const scaledU = uv.u * gridSize;
  const scaledV = uv.v * gridSize;

  const col = Math.min(Math.max(Math.floor(scaledU), 0), gridSize - 1);
  const row = Math.min(Math.max(Math.floor(scaledV), 0), gridSize - 1);

  const localU = Math.min(Math.max(scaledU - col, 0), 0.999999);
  const localV = Math.min(Math.max(scaledV - row, 0), 0.999999);

  const cellIndex = row * gridSize + col;
  const cell = cache.cells[cellIndex];

  if (!cell) {
    console.warn(
      `sampleOctahedralDirection: No cell found at [${row}, ${col}] (index ${cellIndex})`
    );
    return false;
  }

  const triangle =
    cell.isBackslash && localU > localV
      ? cell.triangles[1]
      : !cell.isBackslash && localU + localV > 1
      ? cell.triangles[1]
      : cell.triangles[0];

  if (!triangle || !triangle.indices || triangle.indices.length !== 3) {
    console.warn("sampleOctahedralDirection: Invalid triangle");
    return false;
  }

  computeBarycentric2D(localU, localV, triangle.uv, weightsTarget);

  // Validate indices before setting
  const maxIndex = (gridSize + 1) * (gridSize + 1) - 1;
  const validIndices = [
    Math.max(0, Math.min(triangle.indices[0], maxIndex)),
    Math.max(0, Math.min(triangle.indices[1], maxIndex)),
    Math.max(0, Math.min(triangle.indices[2], maxIndex)),
  ];

  indicesTarget.set(validIndices[0], validIndices[1], validIndices[2]);

  return true;
}
