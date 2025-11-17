import { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three/webgpu";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { texture, uniform, uv, vec2, vec3, float, attribute } from "three/tsl";
import { useOctahedralAtlas } from "./hooks/useOctahedralAtlas";
import {
  getSamplingCache,
  sampleOctahedralDirection,
} from "./utils/octahedralImpostorMath";
import { createSpatialGridForArea } from "./utils/spatialGrid";

const DEFAULT_MODEL_PATH = "/tree.glb";

/**
 * Seeded random number generator (Mulberry32)
 * Ensures reproducible instance placement across renders
 */
const hashSeed = (value) => {
  const stringValue =
    typeof value === "number" ? value.toString() : String(value);
  let hash = 0;
  for (let index = 0; index < stringValue.length; index += 1) {
    hash = (hash << 5) - hash + stringValue.charCodeAt(index);
    hash |= 0;
  }
  return hash >>> 0;
};

const createSeededRandom = (seedValue) => {
  let seed = hashSeed(seedValue);
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * TreeOctahedralImpostorInstanced
 *
 * High-performance impostor renderer using InstancedMesh
 * Optimized for 10,000+ instances with:
 * - Single draw call for all instances
 * - Spatial grid culling
 * - LOD (Level of Detail) system
 * - Batch updates
 * - WebGPU compute shader atlas generation
 *
 * Comments in English per project guidelines.
 */
export default function TreeOctahedralImpostorInstanced({
  modelPath = DEFAULT_MODEL_PATH,
  count = 1000,
  areaSize = [100, 100],
  position = [0, 0, 0],
  minHeight = 0,
  maxHeight = 0,
  minScale = 0.8,
  maxScale = 1.2,
  baseScale = [1, 1, 1],
  avoidRadius = 0,
  seed = 2024,
  gridSize = 16,
  atlasSize = 2048,
  octType = 0,
  geometryArgs = [2, 2],
  roughness = 1,
  metalness = 0,
  alphaTest = 0.5,
  envMapIntensity = 1,
  // WebGPU Compute specific
  usePostProcessing = true,
  brightness = 1.0,
  contrast = 1.0,
  optimizeSize = false,
  atlasCoverage = 1.0,
  usePostDilatation = false,
  dilationRadius = 1,
  // Optimization parameters
  lodDistances = [50, 100, 200, 400],
  maxVisibleDistance = 500,
  updateBatchSize = 200, // Update N instances per frame
  spatialCellSize = null, // Auto-calculated if null
  enableFrustumCulling = true,
  showDebugInfo = false,
  frustumCulled = false,
  showWireframe = false,
}) {
  const instancedMeshRef = useRef(null);
  const { camera } = useThree();
  const [visibleCount, setVisibleCount] = useState(0);
  const [debugStats, setDebugStats] = useState(null);

  // Reusable objects to avoid GC pressure
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projScreenMatrix = useMemo(() => new THREE.Matrix4(), []);

  // Load GLTF model
  const gltf = useGLTF(modelPath);

  // Extract mesh from GLTF
  const sourceMesh = useMemo(() => {
    if (!gltf?.scene) return null;

    let foundMesh = null;
    gltf.scene.traverse((child) => {
      if (!foundMesh && child.isMesh) {
        foundMesh = child;
      }
    });

    // Store modelPath for cache key
    if (foundMesh) {
      foundMesh.userData.__impostorSourceId = modelPath;
    }

    return foundMesh;
  }, [gltf, modelPath]);

  // Create sampling cache for fast direction → face lookup
  const samplingCache = useMemo(
    () => getSamplingCache(octType, gridSize),
    [octType, gridSize]
  );

  // Generate atlas using the WORKING method (not compute shaders)
  const { atlas, isGenerating } = useOctahedralAtlas({
    mesh: sourceMesh,
    gridSize,
    atlasSize,
    octType,
    enabled: !!sourceMesh,
    atlasCoverage,
    frustumCulled,
  });

  // Generate instance positions with seeded random
  const instances = useMemo(() => {
    if (count <= 0) return [];

    const [width, depth] = areaSize;
    const [originX, originY, originZ] = position;
    const [baseScaleX, baseScaleY, baseScaleZ] = baseScale;
    const random = createSeededRandom(seed);

    const generated = [];
    let attempts = 0;

    while (generated.length < count && attempts < count * 10) {
      attempts += 1;

      const offsetX = (random() - 0.5) * width;
      const offsetZ = (random() - 0.5) * depth;

      const candidateX = originX + offsetX;
      const candidateZ = originZ + offsetZ;

      // Avoid center radius
      if (
        avoidRadius > 0 &&
        Math.hypot(candidateX - originX, candidateZ - originZ) < avoidRadius
      ) {
        continue;
      }

      const heightOffset =
        minHeight === maxHeight
          ? minHeight
          : minHeight + random() * (maxHeight - minHeight);

      const uniformScale =
        minScale === maxScale
          ? Math.max(0.0001, minScale)
          : Math.max(0.0001, minScale + random() * (maxScale - minScale));

      generated.push({
        position: [candidateX, originY + heightOffset, candidateZ],
        scale: [
          Math.abs(baseScaleX * uniformScale),
          Math.abs(baseScaleY * uniformScale),
          Math.abs(baseScaleZ * uniformScale),
        ],
        visible: true,
        lodLevel: 0,
      });
    }

    console.log(`✓ Generated ${generated.length} instances`);
    return generated;
  }, [
    count,
    areaSize,
    position,
    baseScale,
    minHeight,
    maxHeight,
    minScale,
    maxScale,
    avoidRadius,
    seed,
  ]);

  // Build spatial grid for fast culling
  const spatialGrid = useMemo(() => {
    if (instances.length === 0) return null;

    const cellSize = spatialCellSize || Math.max(...areaSize) / 15;
    const grid = createSpatialGridForArea(areaSize, position, cellSize);

    instances.forEach((instance, i) => {
      grid.addInstance(instance, i);
    });

    if (showDebugInfo) {
      grid.printStats();
    }

    return grid;
  }, [instances, areaSize, position, spatialCellSize, showDebugInfo]);

  // Initialize instance matrices
  useEffect(() => {
    if (!instancedMeshRef.current || instances.length === 0) return;

    const mesh = instancedMeshRef.current;

    instances.forEach((instance, i) => {
      dummy.position.set(...instance.position);
      dummy.scale.set(...instance.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    console.log(`✓ Initialized ${instances.length} instance matrices`);
  }, [instances, dummy]);

  // Rolling update index for batch processing
  const updateIndexRef = useRef(0);
  const frameCountRef = useRef(0);

  // Per-instance face index storage (single float per instance)
  const instanceFaceIndexRef = useRef(null);

  // Create geometry with faceIndex attribute
  const geometry = useMemo(() => {
    if (count <= 0) return null;

    const geom = new THREE.PlaneGeometry(...geometryArgs);

    // Create buffer: 1 float per instance (the primary face index)
    const buffer = new Float32Array(count);
    // Initialize with center face (8 for 16x16 grid, middle of first row)
    buffer.fill(8);

    instanceFaceIndexRef.current = buffer;

    // Add as instanced attribute BEFORE any rendering
    const attribute = new THREE.InstancedBufferAttribute(buffer, 1);
    geom.setAttribute("faceIndex", attribute);

    console.log("✓ Created geometry with faceIndex attribute");

    return geom;
  }, [count, geometryArgs]);

  // Optimized update loop with impostor logic
  useFrame(() => {
    if (
      !instancedMeshRef.current ||
      !camera ||
      !atlas ||
      !spatialGrid ||
      !samplingCache
    )
      return;

    const mesh = instancedMeshRef.current;
    const cameraPos = camera.position;

    frameCountRef.current++;

    // Update frustum for culling
    if (enableFrustumCulling) {
      camera.updateMatrixWorld();
      projScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      frustum.setFromProjectionMatrix(projScreenMatrix);
    }

    // Query visible instances using spatial grid
    const visibleInstances = spatialGrid.queryNearCamera(
      cameraPos,
      maxVisibleDistance * 1.2
    );

    // Batch update
    const startIdx = updateIndexRef.current;
    const endIdx = Math.min(
      startIdx + updateBatchSize,
      visibleInstances.length
    );

    let visibleThisFrame = 0;

    // Update batch of visible instances
    for (let i = startIdx; i < endIdx; i++) {
      const { instance, index, distance } = visibleInstances[i];

      tempVec.set(...instance.position);

      // Frustum culling
      if (enableFrustumCulling && !frustum.containsPoint(tempVec)) {
        dummy.scale.set(0, 0, 0);
      } else {
        // LOD calculation
        let lodScale = 1.0;
        let shouldRender = true;

        if (distance > lodDistances[3]) {
          shouldRender = false;
        } else if (distance > lodDistances[2]) {
          lodScale = 0.4;
        } else if (distance > lodDistances[1]) {
          lodScale = 0.7;
        } else if (distance > lodDistances[0]) {
          lodScale = 0.9;
        }

        if (!shouldRender) {
          dummy.scale.set(0, 0, 0);
        } else {
          // Billboard rotation
          dummy.position.set(...instance.position);
          dummy.lookAt(cameraPos);
          dummy.scale.set(
            instance.scale[0] * lodScale,
            instance.scale[1] * lodScale,
            instance.scale[2] * lodScale
          );
          visibleThisFrame++;

          // Calculate view direction for impostor (object → camera)
          // Negate to match atlas baking direction
          const viewDir = new THREE.Vector3()
            .subVectors(tempVec, cameraPos)
            .normalize();

          // Sample octahedral direction to get face index
          const faceIndices = new THREE.Vector3();
          const faceWeights = new THREE.Vector3();

          const success = sampleOctahedralDirection({
            direction: viewDir,
            cache: samplingCache,
            indicesTarget: faceIndices,
            weightsTarget: faceWeights,
          });

          // Store primary face index for this instance
          if (success && instanceFaceIndexRef.current) {
            // Use vertex index directly (as in original OctahedralImpostor)
            // The shader will divide by gridSize to get row/col
            instanceFaceIndexRef.current[index] = faceIndices.x;
          }
        }
      }

      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }

    // Hide instances outside visible range
    const visibleIndices = new Set(visibleInstances.map((v) => v.index));
    if (frameCountRef.current % 10 === 0) {
      instances.forEach((instance, index) => {
        if (!visibleIndices.has(index)) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
        }
      });
    }

    mesh.instanceMatrix.needsUpdate = true;

    // Mark faceIndex attribute as needing update
    if (geometry) {
      const faceIndexAttr = geometry.getAttribute("faceIndex");
      if (faceIndexAttr) {
        faceIndexAttr.needsUpdate = true;
      }
    }

    updateIndexRef.current = endIdx >= visibleInstances.length ? 0 : endIdx;

    if (showDebugInfo && frameCountRef.current % 30 === 0) {
      setVisibleCount(visibleInstances.length);
    }
  });

  // Create TSL material for impostor rendering with direction-based sampling
  const material = useMemo(() => {
    if (!atlas) return null;

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.alphaTest = 0.1;
    mat.wireframe = showWireframe;

    // Read per-instance face index (vertex index from octahedral mesh)
    const faceIndexAttr = attribute("faceIndex");

    // Sample atlas texture
    const atlasTexture = texture(atlas.texture);
    const vUv = uv();

    // Convert vertex index to cell coordinates (EXACTLY as in OctahedralImpostor.jsx)
    const gridSizeFloat = float(gridSize);
    const invGridSize = float(1.0).div(gridSizeFloat);

    // Calculate row and col from vertex index
    const row = faceIndexAttr.div(gridSizeFloat).floor();
    const col = faceIndexAttr.sub(row.mul(gridSizeFloat));

    // Clamp to valid grid range (0 to gridSize-1)
    const maxIndex = float(gridSize - 1);
    const safeRow = row.clamp(0.0, maxIndex);
    const safeCol = col.clamp(0.0, maxIndex);

    // Map UV to the correct cell in atlas
    const cellUV = vec2(
      safeCol.add(vUv.x).mul(invGridSize),
      safeRow.add(vUv.y).mul(invGridSize)
    );

    const sampledColor = atlasTexture.sample(cellUV);

    mat.colorNode = sampledColor.rgb;
    mat.opacityNode = sampledColor.a;

    return mat;
  }, [atlas, gridSize, showWireframe]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (material) {
        material.dispose();
      }
      if (geometry) {
        geometry.dispose();
      }
    };
  }, [material, geometry]);

  // Loading state
  if (
    isGenerating ||
    !atlas ||
    !material ||
    !geometry ||
    instances.length === 0
  ) {
    console.log("🔄 Loading...", {
      isGenerating,
      hasAtlas: !!atlas,
      hasMaterial: !!material,
      hasGeometry: !!geometry,
      instanceCount: instances.length,
    });

    // Show loading indicator
    return (
      <group position={position}>
        <mesh>
          <boxGeometry args={[5, 5, 5]} />
          <meshBasicMaterial color="yellow" wireframe />
        </mesh>
      </group>
    );
  }

  console.log("✅ Rendering InstancedMesh with", count, "instances");

  return (
    <>
      <instancedMesh
        ref={instancedMeshRef}
        args={[geometry, material, count]}
        frustumCulled={frustumCulled}
      />

      {/* Debug Info - uncomment to enable */}
      {/* {showDebugInfo && debugStats && (
        <Html position={[0, 20, 0]}>
          <div
            style={{
              color: "white",
              background: "rgba(0,0,0,0.8)",
              padding: "12px",
              borderRadius: "4px",
              fontFamily: "monospace",
              fontSize: "12px",
            }}
          >
            <div>Total: {debugStats.total}</div>
            <div>Visible: {debugStats.visible}</div>
            <div>Batch: {debugStats.batchSize}/frame</div>
          </div>
        </Html>
      )} */}
    </>
  );
}

// Preload GLTF models
useGLTF.preload(DEFAULT_MODEL_PATH);
