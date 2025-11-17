import * as THREE from "three/webgpu";
import { Canvas, extend } from "@react-three/fiber";
import SceneLight from "./SceneLight";
import { Suspense } from "react";
import TreeOctahedralImpostorField from "./TreeOctahedralImpostorField";
import TreeOctahedralImpostor from "./TreeOctahedralImpostor";
import TreeOctahedralImpostorCompute from "./TreeOctahedralImpostorCompute"; // New: WebGPU Compute-based
import TreeOctahedralImpostorFieldCompute from "./TreeOctahedralImpostorFieldCompute"; // New: WebGPU Compute-based field with atlas caching
import { Gltf, Loader, OrbitControls } from "@react-three/drei";
import GridWrapper from "./GridWrapper";
import TreeOctahedralImpostorInstanced from "./TreeOctahedralImpostorInstanced";
import { Inspector } from "three/examples/jsm/inspector/Inspector.js";
import { Perf } from "./Perf";
import { useControls } from "leva";

export default function App() {
  const { showInpostorWireframe, showOriginalModel } = useControls({
    showInpostorWireframe: {
      value: false,
      label: "Show Inpostor Wireframe",
    },
    showOriginalModel: {
      value: true,
      label: "Show Original Model",
    },
  });

  return (
    <>
      <Canvas
        gl={async (props) => {
          extend(THREE);
          const renderer = new THREE.WebGPURenderer(props);

          const inspector = new Inspector();
          // Attach the inspector instance so we can expose runtime tools later
          renderer.inspector = inspector;

          await renderer.init();

          const parent = renderer.domElement.parentElement;
          if (parent && !inspector.domElement.parentElement) {
            parent.appendChild(inspector.domElement);
          }

          return renderer;
        }}
        camera={{
          position: [7, 8, 15],
          fov: 30,
          near: 0.1,
          far: 3000,
        }}
      >
        <Suspense fallback={null}>
          <SceneLight />
          <OrbitControls
            maxDistance={150}
            minDistance={10}
            enableDamping={false}
            maxPolarAngle={Math.PI / 2}
          />
          <Perf position="top-left" showInfo={true} />

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

          {/* 🔥 NEW: WebGPU Compute-based Field with Atlas Caching */}
          {/* Uncomment to render hundreds of instances sharing a single atlas */}
          {/* Atlas is generated once and automatically cached for all instances */}

          {/* OPTIMIZED: InstancedMesh for 10,000+ instances */}
          <TreeOctahedralImpostorInstanced
            modelPath="/tree2.glb"
            position={[0, 0, 0]}
            count={5000} // 🎯 META: 10,000 instances!
            areaSize={[300, 300]} // Larger area for 10k instances
            minHeight={0}
            maxHeight={0}
            minScale={0.5}
            maxScale={1.5}
            baseScale={[1, 1, 1]}
            avoidRadius={8}
            seed={22}
            gridSize={24}
            atlasSize={4096}
            octType={0}
            geometryArgs={[4, 4]}
            showWireframe={showInpostorWireframe}
            maxVisibleDistance={500}
            lodDistances={[50, 100, 200, 400]}
            updateBatchSize={800}
            optimizeSize={false}
            enableFrustumCulling={true}
          />

          {/* Old version (slow, many components) */}
          {/* <TreeOctahedralImpostorFieldCompute
            modelPath="/car.glb"
            position={[0, -2, 0]}
            count={100}
            areaSize={[50, 50]}
            minHeight={0}
            maxHeight={0}
            minScale={0.8}
            maxScale={1}
            baseScale={[1.8, 1.8, 1.8]}
            avoidRadius={3}
            seed={2024}
            gridSize={16}
            atlasSize={2048}
            octType={0}
            geometryArgs={[4, 4]}
            roughness={1}
            metalness={0}
            alphaTest={0.5}
            envMapIntensity={1}
            usePostProcessing={true}
            brightness={1.0}
            contrast={1.0}
            optimizeSize={false}
            atlasCoverage={1.0}
            usePostDilatation={false}
            dilationRadius={0}
            showWireframe={false}
            directionThresholdRadians={0.0872665}
            maxVisibleDistance={200}
            lodDistances={[30, 60, 120, 180]}
            updateBatchSize={100}
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

          {/* <TreeOctahedralImpostorCompute
            modelPath="/tree.glb"
            position={[-6, -2, 0]}
            // scale={[3, 3, 3]}
            gridSize={21}
            atlasSize={4096}
            octType={0} // 0 = HEMI, 1 = FULL
            geometryArgs={[6, 6]}
            directionThresholdRadians={0.01872665}
            optimizeSize={true}
            usePostDilatation={true}
            dilationRadius={0}
            envMapIntensity={1}
          /> */}

          {showOriginalModel && (
            <Gltf src="/tree2.glb" position={[0, -1.2, 0]} scale={[1, 1, 1]} />
          )}
          <GridWrapper />
        </Suspense>
      </Canvas>

      <Loader />
    </>
  );
}
