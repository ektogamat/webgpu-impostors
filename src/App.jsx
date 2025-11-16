import * as THREE from "three/webgpu";
import { Canvas, extend } from "@react-three/fiber";
import SceneLight from "./SceneLight";
import { Suspense } from "react";
import TreeOctahedralImpostorField from "./TreeOctahedralImpostorField";
import TreeOctahedralImpostor from "./TreeOctahedralImpostor";
import TreeOctahedralImpostorCompute from "./TreeOctahedralImpostorCompute"; // New: WebGPU Compute-based
import { Gltf, Loader, OrbitControls } from "@react-three/drei";
import GridWrapper from "./GridWrapper";

export default function App() {
  return (
    <>
      <Canvas
        gl={async (props) => {
          extend(THREE);
          const renderer = new THREE.WebGPURenderer(props);

          await renderer.init();
          return renderer;
        }}
        camera={{
          position: [7, 8, 15],
          fov: 45,
          near: 0.5,
          far: 1000,
        }}
      >
        <Suspense fallback={null}>
          <SceneLight />
          <OrbitControls maxPolarAngle={Math.PI / 2} />

          {/* <TreeOctahedralImpostorField
            // modelPath="/tree.gltf"
            modelPath="/tree.glb"
            // modelPath="/car.gltf" // This we can see the rotation problems
            position={[0, 0.5, 0]}
            count={100} // Intented to be 20.000 trees
            areaSize={[60, 60]}
            minScale={1}
            maxScale={2}
            baseScale={[1, 1, 1]}
            avoidRadius={1}
            gridSize={8}
            atlasSize={2048}
            octType={0}
            geometryArgs={[2, 2]}
            roughness={1}
            metalness={0}
            alphaTest={0.6}
            envMapIntensity={0.2}
          /> */}

          {/* 🔥 NEW: WebGPU Compute-based Atlas Generation */}
          {/* Uncomment to use GPU compute shaders (faster, more efficient) */}
          {/* 
          <TreeOctahedralImpostorCompute
            modelPath="/car.glb"
            position={[-1, -1, 0]}
            scale={[2, 2, 2]}
            gridSize={24}
            atlasSize={8192}
            octType={1} // 0 = HEMI, 1 = FULL
            geometryArgs={[3.5, 3.5]}
            roughness={1}
            metalness={0}
            alphaTest={0.5}
            envMapIntensity={1}
            // GPU Post-Processing Options
            usePostProcessing={true}
            brightness={1.05} // 5% brighter
            contrast={1.0}    // No contrast change
          />
          */}

          {/* Original WebGL-based Atlas Generation */}
          {/* <TreeOctahedralImpostor
            modelPath="/car.glb"
            position={[-3, -1, 0]}
            scale={[2, 2, 2]}
            gridSize={24}
            atlasSize={8192}
            octType={1} // 0 = HEMI, 1 = FULL
            geometryArgs={[3.5, 3.5]}
            roughness={1}
            metalness={0}
            alphaTest={0.5} // 0.5
            envMapIntensity={1}
          /> */}

          <TreeOctahedralImpostorCompute
            modelPath="/car.glb"
            position={[-1, -1, 0]}
            scale={[2, 2, 2]}
            gridSize={32}
            atlasSize={8192}
            octType={1} // 0 = HEMI, 1 = FULL
            geometryArgs={[3.5, 3.5]}
            directionThresholdRadians={0.01872665}
          />

          <Gltf src="/car.glb" position={[1, -1.2, 0]} scale={[1, 1, 1]} />
          <GridWrapper />
        </Suspense>
      </Canvas>

      <Loader />
    </>
  );
}
