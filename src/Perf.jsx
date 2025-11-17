import React, { useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Count triangles in a scene by traversing all objects
 */
function countTrianglesInScene(scene) {
  let triangles = 0;
  let geometries = 0;
  let drawCalls = 0;
  const geometrySet = new Set();

  scene.traverse((object) => {
    if (object.isMesh || object.isInstancedMesh) {
      drawCalls++;

      if (object.geometry) {
        const geometryId = object.geometry.uuid;

        // Count triangles in geometry
        let geomTriangles = 0;
        if (object.geometry.index) {
          // Indexed geometry
          geomTriangles = object.geometry.index.count / 3;
        } else if (object.geometry.attributes.position) {
          // Non-indexed geometry
          geomTriangles = object.geometry.attributes.position.count / 3;
        }

        // For instanced meshes, multiply by instance count
        if (object.isInstancedMesh && object.count) {
          triangles += Math.floor(geomTriangles * object.count);
        } else {
          triangles += Math.floor(geomTriangles);
        }

        // Count unique geometries
        if (!geometrySet.has(geometryId)) {
          geometrySet.add(geometryId);
          geometries++;
        }
      }
    }
  });

  return { triangles: Math.floor(triangles), geometries, drawCalls };
}

/**
 * Performance monitor component that displays FPS, frame time, draw calls, triangles, and other render stats
 * @param {Object} props
 * @param {"top-left" | "top-right" | "bottom-left" | "bottom-right"} props.position - Position of the overlay
 * @param {boolean} props.showGraph - Whether to show a performance graph (not implemented yet)
 * @param {string} props.color - Text color for the overlay
 * @param {boolean} props.showInfo - Whether to show the info overlay
 */
export function Perf({
  position = "top-left",
  showGraph = true,
  color = "#00ff00",
  showInfo = true,
}) {
  const { gl, scene } = useThree();
  const [stats, setStats] = useState({
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
  });

  const frameTimeRef = useRef([]);
  const lastTimeRef = useRef(performance.now());
  const overlayRef = useRef(null);
  const frameCountRef = useRef(0);

  // Create overlay element
  useEffect(() => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.fontFamily = "monospace";
    overlay.style.fontSize = "12px";
    overlay.style.color = color;
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
    overlay.style.padding = "10px";
    overlay.style.borderRadius = "5px";
    overlay.style.zIndex = "1000";
    overlay.style.minWidth = "200px";
    overlay.style.userSelect = "none";

    // Position the overlay
    switch (position) {
      case "top-left":
        overlay.style.top = "10px";
        overlay.style.left = "10px";
        break;
      case "top-right":
        overlay.style.top = "10px";
        overlay.style.right = "10px";
        break;
      case "bottom-left":
        overlay.style.bottom = "10px";
        overlay.style.left = "10px";
        break;
      case "bottom-right":
        overlay.style.bottom = "10px";
        overlay.style.right = "10px";
        break;
    }

    document.body.appendChild(overlay);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        document.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [position, color]);

  useFrame((state, delta) => {
    const currentTime = performance.now();
    const deltaTime = currentTime - lastTimeRef.current;
    lastTimeRef.current = currentTime;
    frameCountRef.current++;

    // Calculate FPS and frame time
    frameTimeRef.current.push(deltaTime);
    if (frameTimeRef.current.length > 60) {
      frameTimeRef.current.shift();
    }

    const avgFrameTime =
      frameTimeRef.current.reduce((a, b) => a + b, 0) /
      frameTimeRef.current.length;

    const fps = Math.round(1000 / avgFrameTime);

    // Update overlay every 60 frames to reduce overhead
    if (frameCountRef.current % 60 === 0) {
      let newStats = {
        fps,
        frameTime: Math.round(avgFrameTime * 100) / 100,
        drawCalls: 0,
        triangles: 0,
        geometries: 0,
        textures: 0,
      };

      // Try to get info from renderer (WebGL)
      if (gl.info && gl.info.render) {
        try {
          newStats.drawCalls = gl.info.render.calls || 0;
          newStats.triangles = gl.info.render.triangles || 0;
          newStats.geometries = gl.info.memory?.geometries || 0;
          newStats.textures = gl.info.memory?.textures || 0;

          // Reset after reading
          gl.info.reset();
        } catch (e) {
          console.warn("Error reading renderer info:", e);
        }
      }

      // If WebGPU or info not available, calculate manually
      if (newStats.triangles === 0 || !gl.info) {
        try {
          const manualCount = countTrianglesInScene(scene);
          newStats.triangles = manualCount.triangles;
          newStats.geometries = manualCount.geometries;
          newStats.drawCalls = manualCount.drawCalls;
        } catch (e) {
          console.warn("Error counting triangles manually:", e);
        }
      }

      // Count textures manually if needed
      if (newStats.textures === 0) {
        try {
          const textureSet = new Set();
          scene.traverse((object) => {
            if (object.material) {
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];

              materials.forEach((mat) => {
                if (mat.map) textureSet.add(mat.map.uuid);
                if (mat.normalMap) textureSet.add(mat.normalMap.uuid);
                if (mat.roughnessMap) textureSet.add(mat.roughnessMap.uuid);
                if (mat.metalnessMap) textureSet.add(mat.metalnessMap.uuid);
                if (mat.envMap) textureSet.add(mat.envMap.uuid);
              });
            }
          });
          newStats.textures = textureSet.size;
        } catch (e) {
          console.warn("Error counting textures:", e);
        }
      }

      setStats(newStats);

      // Update overlay
      if (overlayRef.current && showInfo) {
        overlayRef.current.innerHTML = `
          <div style="color: #00ff00; font-weight: bold; margin-bottom: 5px;">Performance</div>
          <div>FPS: ${newStats.fps}</div>
          <div>Frame Time: ${newStats.frameTime}ms</div>
          <div style="color: #ff6600; font-weight: bold;">Draw Calls: ${
            newStats.drawCalls
          }</div>
          <div>Triangles: ${newStats.triangles.toLocaleString()}</div>
          <div>Geometries: ${newStats.geometries}</div>
          <div>Textures: ${newStats.textures}</div>

        `;
      }

      //   // Log to console for debugging
      //   console.log("🔍 Frame Stats:", newStats);
    }
  });

  return null;
}
