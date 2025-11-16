import { useState, useEffect } from "react";
import TreeOctahedralImpostor from "./TreeOctahedralImpostor";
import TreeOctahedralImpostorCompute from "./TreeOctahedralImpostorCompute";
import { determineBestAtlasMethod } from "./utils/webgpuDetection";

/**
 * TreeOctahedralImpostorAuto - Automatically selects best implementation
 * This component detects WebGPU support and chooses between:
 * - WebGPU Compute Shader approach (faster, WebGPU required)
 * - Traditional WebGL approach (compatible, slower)
 *
 * Comments in English per project guidelines.
 */
export default function TreeOctahedralImpostorAuto({
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
  // Compute-specific options (used only if WebGPU is available)
  usePostProcessing = true,
  brightness = 1.0,
  contrast = 1.0,
  // Force specific implementation (for testing)
  forceMethod = null, // 'compute' | 'webgl' | null (auto)
}) {
  const [selectedMethod, setSelectedMethod] = useState(null);

  useEffect(() => {
    async function detectMethod() {
      if (forceMethod) {
        console.log(`🔧 Forced atlas method: ${forceMethod}`);
        setSelectedMethod(forceMethod);
        return;
      }

      const method = await determineBestAtlasMethod(atlasSize);
      setSelectedMethod(method);
    }

    detectMethod();
  }, [atlasSize, forceMethod]);

  // Show loading state while detecting
  if (!selectedMethod) {
    return (
      <group position={position} scale={scale}>
        <mesh>
          <planeGeometry args={geometryArgs} />
          <meshBasicMaterial color="#00ffff" transparent opacity={0.3} />
        </mesh>
      </group>
    );
  }

  // Render compute-based component if selected
  if (selectedMethod === "compute") {
    return (
      <TreeOctahedralImpostorCompute
        modelPath={modelPath}
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
        usePostProcessing={usePostProcessing}
        brightness={brightness}
        contrast={contrast}
      />
    );
  }

  // Render traditional WebGL component if selected
  return (
    <TreeOctahedralImpostor
      modelPath={modelPath}
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
    />
  );
}
