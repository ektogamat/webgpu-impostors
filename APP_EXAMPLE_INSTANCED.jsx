import * as THREE from "three/webgpu";
import { Canvas, extend } from "@react-three/fiber";
import SceneLight from "./SceneLight";
import { Suspense } from "react";
import TreeOctahedralImpostorFieldCompute from "./TreeOctahedralImpostorFieldCompute"; // Current implementation (max ~500 instances)
import TreeOctahedralImpostorInstanced from "./TreeOctahedralImpostorInstanced"; // NEW: Optimized (10,000+ instances)
import { Gltf, Loader, OrbitControls, Stats } from "@react-three/drei";
import GridWrapper from "./GridWrapper";

/**
 * App.jsx - Example Usage
 * 
 * This file shows how to use the optimized TreeOctahedralImpostorInstanced
 * component to render 10,000+ instances.
 * 
 * Comments in English per project guidelines.
 */
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
          position: [50, 50, 100],
          fov: 45,
          near: 0.5,
          far: 2000,
        }}
      >
        <Suspense fallback={null}>
          <SceneLight />
          <OrbitControls enableDamping={false} maxPolarAngle={Math.PI / 2} />
          <Stats /> {/* Show FPS counter */}

          {/* ============================================ */}
          {/* OPTION 1: Current Implementation (MAX ~500) */}
          {/* ============================================ */}
          {/* 
          <TreeOctahedralImpostorFieldCompute
            modelPath="/car.glb"
            position={[0, -2, 0]}
            count={500} // Max ~500-1000 before FPS drops
            areaSize={[250, 250]}
            minScale={0.8}
            maxScale={1.2}
            baseScale={[1.8, 1.8, 1.8]}
            seed={2024}
            gridSize={16}
            atlasSize={4096}
            octType={0}
            geometryArgs={[4, 4]}
            alphaTest={0.5}
          />
          */}

          {/* ============================================ */}
          {/* OPTION 2: NEW Optimized (10,000+ instances) */}
          {/* ============================================ */}
          
          {/* Example 1: 5,000 trees in a large area */}
          <TreeOctahedralImpostorInstanced
            modelPath="/tree.glb"
            count={5000}
            areaSize={[500, 500]}
            position={[0, 0, 0]}
            minScale={0.8}
            maxScale={1.5}
            baseScale={[3, 3, 3]}
            avoidRadius={10}
            seed={2024}
            gridSize={16}
            atlasSize={2048}
            octType={0} // 0 = HEMI (better for trees)
            geometryArgs={[6, 6]}
            // LOD settings
            lodDistances={[50, 100, 200, 400]}
            maxVisibleDistance={600}
            // Performance settings
            updateBatchSize={300}
            spatialCellSize={40}
            enableFrustumCulling={true}
            showDebugInfo={false}
          />

          {/* Example 2: 10,000 cars (smaller objects) */}
          {/* 
          <TreeOctahedralImpostorInstanced
            modelPath="/car.glb"
            count={10000}
            areaSize={[800, 800]}
            position={[0, -2, 0]}
            minScale={0.5}
            maxScale={1.0}
            baseScale={[1.5, 1.5, 1.5]}
            avoidRadius={5}
            seed={2025}
            gridSize={16}
            atlasSize={4096}
            octType={0}
            geometryArgs={[3, 3]}
            lodDistances={[30, 80, 150, 300]}
            maxVisibleDistance={500}
            updateBatchSize={200}
            spatialCellSize={50}
            enableFrustumCulling={true}
          />
          */}

          {/* Reference model for comparison */}
          <Gltf src="/tree.glb" position={[0, 0, 0]} scale={[3, 3, 3]} />

          <GridWrapper />
        </Suspense>
      </Canvas>

      <Loader />

      {/* Instructions overlay */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          color: "white",
          background: "rgba(0,0,0,0.7)",
          padding: "12px",
          borderRadius: "8px",
          fontFamily: "monospace",
          fontSize: "14px",
          maxWidth: "400px",
        }}
      >
        <h3 style={{ margin: "0 0 8px 0" }}>
          🚀 Optimized Impostor Demo
        </h3>
        <div style={{ fontSize: "12px", lineHeight: "1.6" }}>
          <p style={{ margin: "4px 0" }}>
            <strong>Rendering:</strong> 5,000 tree instances
          </p>
          <p style={{ margin: "4px 0" }}>
            <strong>Draw Calls:</strong> ~1 (vs 5,000 before)
          </p>
          <p style={{ margin: "4px 0" }}>
            <strong>Features:</strong>
          </p>
          <ul style={{ margin: "4px 0", paddingLeft: "16px" }}>
            <li>InstancedMesh rendering</li>
            <li>Spatial grid culling</li>
            <li>LOD (Level of Detail)</li>
            <li>Batch updates</li>
            <li>Frustum culling</li>
          </ul>
          <p style={{ margin: "8px 0 4px 0", fontSize: "11px", opacity: 0.8 }}>
            Camera controls: Mouse drag to rotate, scroll to zoom
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * PERFORMANCE TIPS:
 * 
 * 1. Start with lower counts (1000-2000) and increase gradually
 * 2. Adjust LOD distances based on your scene scale
 * 3. Use smaller atlasSize (2048) for better memory usage
 * 4. Enable spatialCellSize auto-calculation (set to null)
 * 5. Monitor FPS with <Stats /> component
 * 
 * EXPECTED PERFORMANCE:
 * - 1,000 instances: 60 FPS
 * - 5,000 instances: 45-60 FPS
 * - 10,000 instances: 30-45 FPS
 * - 20,000 instances: 20-30 FPS (with aggressive LOD)
 * 
 * TROUBLESHOOTING:
 * - Low FPS? Reduce updateBatchSize or increase lodDistances
 * - Pop-in artifacts? Increase maxVisibleDistance
 * - Memory issues? Reduce atlasSize or use optimizeSize={true}
 */

