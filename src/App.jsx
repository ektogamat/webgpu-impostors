import * as THREE from "three/webgpu";
import { Canvas, extend } from "@react-three/fiber";
import SceneLight from "./SceneLight";
import { Suspense } from "react";
import TreeOctahedralImpostorField from "./TreeOctahedralImpostorField";
import { Loader, OrbitControls } from "@react-three/drei";

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
          <OrbitControls />

          <TreeOctahedralImpostorField
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
          />
        </Suspense>
      </Canvas>

      <Loader />
    </>
  );
}
