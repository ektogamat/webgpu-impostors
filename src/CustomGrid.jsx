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

  // Create fixed 1x1 geometry - pattern repetition is handled in shader
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    return geo;
  }, []);

  // Combine worldSize scale with user-provided scale
  const finalScale = useMemo(() => {
    return [worldSize * scale[0], worldSize * scale[1], scale[2]];
  }, [worldSize, scale]);

  // Create TSL shader material
  const material = useMemo(() => {
    // Create TSL material
    const mat = new MeshStandardNodeMaterial();

    // Create uniforms
    const gridColorUniform = TSL.uniform(new THREE.Color(color));
    const opacityUniform = TSL.uniform(opacity);
    const dotRadiusUniform = TSL.uniform(dotRadius);
    const divisionsUniform = TSL.uniform(divisions);
    const worldSizeUniform = TSL.uniform(worldSize);

    // Get UV coordinates (0-1 range for the 1x1 plane)
    const uvCoords = TSL.uv();

    // Scale UV by worldSize to get world coordinates, then divide by spacing to get grid cells
    // This repeats the pattern across the entire grid
    const gridSpacing = TSL.div(worldSizeUniform, divisionsUniform);
    const worldPos = TSL.mul(uvCoords, worldSizeUniform);
    const gridUv = TSL.div(worldPos, gridSpacing);

    // Get fractional part to repeat pattern in each grid cell (0-1 range per cell)
    const gridPos = TSL.fract(gridUv);

    // Calculate distance from grid cell center for each dot
    const center = TSL.vec2(0.5, 0.5);
    const dist = TSL.length(TSL.sub(gridPos, center));

    // Create circular dots at grid intersections
    const dotMask = TSL.step(dist, dotRadiusUniform);

    // Set the nodes for MeshStandardNodeMaterial
    mat.colorNode = TSL.color(gridColorUniform);
    mat.opacityNode = TSL.mul(dotMask, opacityUniform);

    // Set material properties
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.depthWrite = false;

    return mat;
  }, [color, opacity, dotRadius, divisions, worldSize]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
      scale={finalScale}
      {...props}
    />
  );
};

export default CustomGrid;
