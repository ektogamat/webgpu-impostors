import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { useGLTF } from "@react-three/drei";
import TreeOctahedralImpostor from "./TreeOctahedralImpostor";
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

export default function TreeOctahedralImpostorField({
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
  ...restProps
}) {
  const { scene } = useGLTF(modelPath);

  const sharedMeshGroup = useMemo(() => {
    const group = new THREE.Group();
    let meshCount = 0;

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const cloned = child.clone();
        group.add(cloned);
        meshCount += 1;
      }
    });

    if (meshCount === 0) {
      console.warn(
        `TreeOctahedralImpostorField: No meshes found in model ${modelPath}`
      );
      return null;
    }

    if (!group.userData.__impostorSourceId) {
      group.userData.__impostorSourceId = modelPath;
    }

    return group;
  }, [scene, modelPath]);

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

  if (!sharedMeshGroup || instances.length === 0) {
    return null;
  }

  const sharedSamplingCache = useMemo(
    () => getSamplingCache(octType, gridSize),
    [octType, gridSize]
  );

  return instances.map((instance, index) => (
    <TreeOctahedralImpostor
      key={`tree-octa-field-${index}`}
      meshGroup={sharedMeshGroup}
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
      samplingCacheOverride={sharedSamplingCache}
      {...restProps}
    />
  ));
}

useGLTF.preload(DEFAULT_MODEL_PATH);
