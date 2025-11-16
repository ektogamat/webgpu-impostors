import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import {
  WebGPURenderer,
  DoubleSide,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import * as TSL from "three/tsl";

/**
 * CustomGrid component that renders a dotted grid using TSL shaders for WebGPU
 * Similar to Drei's Grid but with dots instead of lines and WebGPU compatibility
 */
const CustomGrid = ({
  // Grid configuration
  unit = "meters",
  size = 5,
  divisions = 10,

  // Visual properties
  color = "#888888",
  opacity = 0.5,
  dotRadius = 0.02,

  // Grid properties
  fadeDistance = 0,
  fadeStrength = 1,
  followCamera = false,

  // Position and rotation
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],

  ...props
}) => {
  const meshRef = useRef();

  // Convert unit to appropriate scale
  const unitScale = useMemo(() => {
    switch (unit) {
      case "meters":
        return 1.0;
      case "feet":
        return 0.3048; // 1 foot = 0.3048 meters
      case "inches":
        return 0.0254; // 1 inch = 0.0254 meters
      case "centimeters":
        return 0.01; // 1 cm = 0.01 meters
      default:
        return 1.0;
    }
  }, [unit]);

  // Calculate actual grid size in world units
  const worldSize = useMemo(() => size * unitScale, [size, unitScale]);
  const gridSpacing = useMemo(
    () => worldSize / divisions,
    [worldSize, divisions]
  );

  // Create geometry for the grid plane
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      worldSize,
      worldSize,
      divisions,
      divisions
    );
    return geo;
  }, [worldSize, divisions]);

  // Create TSL shader material
  const material = useMemo(() => {
    // Create TSL material
    const mat = new MeshStandardNodeMaterial();

    // Create uniforms
    const gridColorUniform = TSL.uniform(new THREE.Color(color));
    const opacityUniform = TSL.uniform(opacity);
    const dotRadiusUniform = TSL.uniform(dotRadius);
    const divisionsUniform = TSL.uniform(divisions);

    // Create simple TSL nodes for grid pattern
    const uvCoords = TSL.uv();
    const gridUv = TSL.mul(uvCoords, divisionsUniform);
    const gridPos = TSL.fract(gridUv);

    // Calculate distance from grid center for each dot
    const center = TSL.vec2(0.5, 0.5);
    const dist = TSL.length(TSL.sub(gridPos, center));

    // Create circular dots
    const dotMask = TSL.step(dist, dotRadiusUniform);

    // Create simple grid pattern - just use mod without complex operations
    const gridMask = TSL.step(0.1, TSL.mod(gridUv.x, 1.0));

    // Combine dot and grid masks
    const finalMask = TSL.mul(dotMask, gridMask);

    // Set the nodes for MeshStandardNodeMaterial
    mat.colorNode = TSL.color(gridColorUniform);
    mat.opacityNode = TSL.mul(finalMask, opacityUniform);

    // Set material properties
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.depthWrite = false;

    return mat;
  }, [color, opacity, dotRadius, divisions]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
      scale={scale}
      {...props}
    />
  );
};

export default CustomGrid;
