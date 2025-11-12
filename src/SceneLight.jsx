import { Suspense } from "react";
import { Environment } from "@react-three/drei";

export default function SceneLight() {
  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <directionalLight
        castShadow
        intensity={3}
        position={[0, 4, 8]}
        shadow-mapSize={2048}
        shadow-camera-near={20}
        shadow-camera-far={60}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={0.0001}
        shadow-normalBias={0.017}
      />

      <Suspense fallback={null}>
        <Environment preset="forest" />
      </Suspense>
    </>
  );
}
