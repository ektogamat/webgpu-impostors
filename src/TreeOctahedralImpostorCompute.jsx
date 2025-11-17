import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import OctahedralImpostor from "./OctahedralImpostor";
import { useOctahedralAtlasCompute } from "./hooks/useOctahedralAtlasCompute";

/**
 * TreeOctahedralImpostorCompute - Uses WebGPU compute shaders for atlas generation
 * This is a drop-in replacement for TreeOctahedralImpostor with GPU-accelerated atlas.
 * Comments in English per project guidelines.
 */
export default function TreeOctahedralImpostorCompute({
  modelPath,
  position = [0, 0, 0],
  scale = [1, 1, 1],
  gridSize = 16,
  atlasSize = 2048,
  octType = 0,
  geometryArgs = [2, 2],
  roughness = 1,
  metalness = 0,
  alphaTest = 0.5,
  envMapIntensity = 1,
  usePostProcessing = true, // Enable GPU post-processing
  brightness = 1.0, // Post-processing brightness
  contrast = 1.0, // Post-processing contrast
  // Default: 5 degrees in radians to avoid excessive view switching
  directionThresholdRadians = 0.0872665,
  // New parameters from Godot implementation
  atlasCoverage = 1.0,
  useDither = false,
  depthScale = 1.0,
  aabbMax = [1, 1, 1],
  optimizeSize = false,
  usePostDilatation = false,
  dilationRadius = 1,
  samplingCacheOverride = null, // Shared sampling cache for multiple instances
  frustumCulled = false,
  showWireframe = false,
}) {
  // Load GLTF model using drei
  const gltf = useGLTF(modelPath);

  // Create a stable mesh reference from GLTF
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
    if (foundMesh) {
      foundMesh.userData.__impostorSourceId = modelPath;
    }

    return foundMesh;
  }, [gltf, modelPath]);

  // Generate atlas using WebGPU compute shaders
  const { atlas, isGenerating } = useOctahedralAtlasCompute({
    mesh: sourceMesh,
    gridSize,
    atlasSize,
    octType,
    enabled: !!sourceMesh,
    usePostProcessing,
    brightness,
    contrast,
    optimizeSize,
    atlasCoverage,
    usePostDilatation,
    dilationRadius,
  });

  // Show loading indicator while generating
  if (isGenerating || !atlas) {
    return (
      <group position={position} scale={scale}>
        <mesh>
          <planeGeometry args={geometryArgs} />
          <meshBasicMaterial color="#ffff00" transparent opacity={0.5} />
        </mesh>
        {/* Optional: Add text label */}
        {/* <Html center>
          <div style={{ color: 'white', background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
            Generating Atlas...
          </div>
        </Html> */}
      </group>
    );
  }

  // Render impostor using generated atlas
  return (
    <OctahedralImpostor
      mesh={sourceMesh}
      position={position}
      scale={scale}
      gridSize={gridSize}
      atlasSize={atlasSize}
      octType={octType}
      geometryArgs={geometryArgs}
      roughness={roughness}
      metalness={metalness}
      alphaTest={alphaTest}
      envMapIntensity={envMapIntensity}
      enabled={true}
      directionThresholdRadians={directionThresholdRadians}
      atlasCoverage={atlasCoverage}
      useDither={useDither}
      depthScale={depthScale}
      aabbMax={aabbMax}
      samplingCacheOverride={samplingCacheOverride}
      frustumCulled={frustumCulled}
      showWireframe={showWireframe}
    />
  );
}

// Preload GLTF models (if needed, call useGLTF.preload(path) directly)
// Note: useGLTF.preload is already available from @react-three/drei
