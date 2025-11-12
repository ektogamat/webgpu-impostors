import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { useGLTF } from "@react-three/drei";
import OctahedralImpostor from "./OctahedralImpostor";

/**
 * Component that loads a tree model and creates an octahedral impostor from it.
 * Comments in English per project guidelines.
 */
export default function TreeOctahedralImpostor({
  modelPath = "/tree.glb",
  meshGroup: externalMeshGroup = null,
  position = [0, 0, 0],
  scale = [1, 1, 1],
  gridSize = 16,
  atlasSize = 2048,
  octType = 0, // 0 = HEMI, 1 = FULL
  geometryArgs = [2, 2],
  roughness = 1,
  metalness = 0,
  alphaTest = 0.5,
  envMapIntensity = 1,
  samplingCacheOverride = null,
  ...props
}) {
  // Load the GLTF model
  const { scene } = useGLTF(modelPath);

  // Create a group containing ALL meshes from the scene
  const meshGroup = useMemo(() => {
    if (externalMeshGroup) {
      // Keep a stable identifier for cache reuse when sharing meshes. (English comment)
      if (!externalMeshGroup.userData.__impostorSourceId) {
        externalMeshGroup.userData.__impostorSourceId = modelPath;
      }
      return externalMeshGroup;
    }

    const group = new THREE.Group();
    let meshCount = 0;

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Clone each mesh and add to group
        const clonedMesh = child.clone();
        group.add(clonedMesh);
        meshCount++;
        console.log(
          `TreeOctahedralImpostor: Found mesh ${meshCount}:`,
          clonedMesh.name || "unnamed"
        );
      }
    });

    if (meshCount === 0) {
      console.warn(
        `TreeOctahedralImpostor: No meshes found in model ${modelPath}`
      );
      return null;
    }

    console.log(`TreeOctahedralImpostor: Total meshes: ${meshCount}`);
    group.userData.__impostorSourceId = modelPath;
    return group;
  }, [externalMeshGroup, scene, modelPath]);

  return (
    <OctahedralImpostor
      mesh={meshGroup}
      position={position}
      scale={scale}
      geometryArgs={geometryArgs}
      gridSize={gridSize}
      atlasSize={atlasSize}
      octType={octType}
      roughness={roughness}
      metalness={metalness}
      alphaTest={alphaTest}
      envMapIntensity={envMapIntensity}
      samplingCacheOverride={samplingCacheOverride}
      {...props}
    />
  );
}
