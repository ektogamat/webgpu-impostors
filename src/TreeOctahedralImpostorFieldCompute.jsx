import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { useGLTF } from "@react-three/drei";
import TreeOctahedralImpostorCompute from "./TreeOctahedralImpostorCompute";
import { getSamplingCache } from "./utils/octahedralImpostorMath";

const DEFAULT_MODEL_PATH = "/tree.glb";

const hashSeed = (value) => {
  // Build a deterministic integer hash for pseudo random generation. (English comment)
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
  // Mulberry32 generator ensures reproducible distributions. (English comment)
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
 * TreeOctahedralImpostorFieldCompute - Renders hundreds of impostor instances
 * using WebGPU compute shaders for atlas generation.
 * All instances share the same atlas texture via cache, ensuring optimal performance.
 * Comments in English per project guidelines.
 */
export default function TreeOctahedralImpostorFieldCompute({
  showWireframe = false,
  count = 150,
  modelPath = DEFAULT_MODEL_PATH,
  position = [0, 0, 0],
  areaSize = [60, 60],
  minHeight = 0,
  maxHeight = 0,
  minScale = 0.7,
  maxScale = 1.4,
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
  // WebGPU Compute specific parameters
  usePostProcessing = true,
  brightness = 1.0,
  contrast = 1.0,
  optimizeSize = false,
  atlasCoverage = 1.0,
  usePostDilatation = false,
  dilationRadius = 1,
  directionThresholdRadians = 0.0872665,
  useDither = false,
  depthScale = 1.0,
  aabbMax = [1, 1, 1],
  frustumCulled = false,
  ...restProps
}) {
  // Load GLTF model using drei
  const gltf = useGLTF(modelPath);

  // Create a stable mesh reference from GLTF (for cache key generation)
  // This mesh is only used to identify the model for cache purposes
  const sourceMesh = useMemo(() => {
    if (!gltf?.scene) return null;

    // Find first mesh in the GLTF scene
    let foundMesh = null;
    gltf.scene.traverse((child) => {
      if (!foundMesh && child.isMesh) {
        foundMesh = child;
      }
    });

    // Store modelPath in userData for cache key
    // All instances with same modelPath, gridSize, atlasSize, octType will share the same atlas
    if (foundMesh) {
      foundMesh.userData.__impostorSourceId = modelPath;
    }

    return foundMesh;
  }, [gltf, modelPath]);

  // Generate instance positions and scales
  const instances = useMemo(() => {
    if (count <= 0) {
      return [];
    }

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
      });
    }

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

  // Early return if no valid mesh or instances
  if (!sourceMesh || instances.length === 0) {
    return null;
  }

  // Create shared sampling cache for all instances
  // This cache is used for efficient direction-to-face mapping
  const sharedSamplingCache = useMemo(
    () => getSamplingCache(octType, gridSize),
    [octType, gridSize]
  );

  // Render multiple TreeOctahedralImpostorCompute instances
  // Each instance will use the cached atlas (generated once via useOctahedralAtlasCompute)
  // The cache key is based on modelPath, gridSize, atlasSize, and octType
  // All instances with the same parameters will automatically share the same atlas
  // All instances also share the same samplingCache for optimal performance
  return instances.map((instance, index) => (
    <TreeOctahedralImpostorCompute
      key={`tree-octa-field-compute-${index}`}
      modelPath={modelPath}
      position={instance.position}
      scale={instance.scale}
      gridSize={gridSize}
      atlasSize={atlasSize}
      octType={octType}
      geometryArgs={geometryArgs}
      roughness={roughness}
      metalness={metalness}
      alphaTest={alphaTest}
      envMapIntensity={envMapIntensity}
      usePostProcessing={usePostProcessing}
      brightness={brightness}
      contrast={contrast}
      optimizeSize={optimizeSize}
      atlasCoverage={atlasCoverage}
      usePostDilatation={usePostDilatation}
      dilationRadius={dilationRadius}
      directionThresholdRadians={directionThresholdRadians}
      useDither={useDither}
      depthScale={depthScale}
      aabbMax={aabbMax}
      samplingCacheOverride={sharedSamplingCache}
      {...restProps}
      frustumCulled={frustumCulled}
      showWireframe={showWireframe}
    />
  ));
}

// Preload GLTF models
useGLTF.preload(DEFAULT_MODEL_PATH);
