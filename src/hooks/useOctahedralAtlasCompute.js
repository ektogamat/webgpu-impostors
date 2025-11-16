import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useThree } from "@react-three/fiber";
import { buildOctahedralMesh, OCT_TYPE } from "../utils/octahedralHelper";
import { useEnvironment, useGLTF } from "@react-three/drei";
import {
  createAtlasCopyComputeShader,
  createAtlasPostProcessShader,
  createAtlasDilatationShader,
  createStorageTexture,
} from "../utils/atlasComputeShader";
import { texture } from "three/tsl";

/**
 * Cache storage shared across impostor instances. (English comment)
 */
const atlasCache = new Map();
const pendingAtlasPromises = new Map();

/**
 * Builds a cache key for atlas generation. (English comment)
 */
function buildAtlasCacheKey(mesh, gridSize, atlasSize, octType) {
  if (!mesh) {
    return null;
  }

  if (!mesh.userData.__impostorSourceId) {
    // Persist an identifier to allow clones to reuse the same atlas. (English comment)
    mesh.userData.__impostorSourceId =
      mesh.name && mesh.name.length > 0
        ? mesh.name
        : THREE.MathUtils.generateUUID();
  }

  return `${mesh.userData.__impostorSourceId}|g${gridSize}|a${atlasSize}|o${octType}`;
}

/**
 * Hook to generate octahedral impostor atlas using WebGPU compute shaders.
 * This version uses StorageTexture for direct GPU-based atlas generation.
 * Comments in English per project guidelines.
 */
export function useOctahedralAtlasCompute({
  mesh = null,
  gridSize = 16,
  atlasSize = 2048,
  octType = OCT_TYPE.HEMI,
  enabled = true,
  usePostProcessing = true, // Enable GPU post-processing
  brightness = 1.0,
  contrast = 1.0,
  optimizeSize = false, // Reduce resolution of non-critical textures to save VRAM
  atlasCoverage = 1.0, // How much of each atlas tile the geometry takes up (0-1)
  usePostDilatation = false, // Expand textures to avoid bleeding between atlas cells
  dilationRadius = 1, // Number of pixels to expand
}) {
  const { gl, scene, camera } = useThree();
  const [atlas, setAtlas] = useState(null);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const environment = useEnvironment({ preset: "city" });
  const octahedralDataRef = useRef(null);

  // Get model path from mesh userData (same way drei stores it)
  const modelPath = mesh?.userData?.__impostorSourceId || null;

  // Load the GLTF model using drei's useGLTF (same method as TreeOctahedralImpostor)
  const gltfScene = useGLTF(modelPath || "/dummy.glb");

  // Build octahedral mesh data
  const octahedralData = useMemo(() => {
    if (!enabled) return null;
    try {
      return buildOctahedralMesh(octType, gridSize);
    } catch (err) {
      console.error("Failed to build octahedral mesh:", err);
      return null;
    }
  }, [octType, gridSize, enabled]);

  octahedralDataRef.current = octahedralData;

  // Calculate effective atlas size (may be reduced for optimization)
  const effectiveAtlasSize = useMemo(() => {
    if (optimizeSize) {
      // Reduce atlas size by 50% to save VRAM (can be adjusted)
      return Math.max(512, Math.floor(atlasSize * 0.5));
    }
    return atlasSize;
  }, [atlasSize, optimizeSize]);

  // Generate atlas using WebGPU compute shaders
  useEffect(() => {
    // Wait for gltfScene to load if using modelPath
    if (modelPath && (!gltfScene || !gltfScene.scene)) {
      return; // Still loading
    }

    // Only proceed if we have either mesh or a valid gltfScene
    const hasValidSource = mesh || (modelPath && gltfScene?.scene);

    if (!enabled || !hasValidSource || !octahedralData || !gl) {
      setAtlas(null);
      return;
    }

    const cacheKey = buildAtlasCacheKey(
      mesh,
      gridSize,
      effectiveAtlasSize,
      octType
    );

    if (cacheKey && atlasCache.has(cacheKey)) {
      const cachedAtlas = atlasCache.get(cacheKey);
      setAtlas(cachedAtlas);
      setIsGenerating(false);
      setError(null);
      return;
    }

    if (cacheKey && pendingAtlasPromises.has(cacheKey)) {
      setIsGenerating(true);
      setError(null);
      const pendingPromise = pendingAtlasPromises.get(cacheKey);
      pendingPromise
        .then((cachedAtlas) => {
          setAtlas(cachedAtlas);
          setIsGenerating(false);
        })
        .catch((err) => {
          console.error("Failed to generate atlas:", err);
          setError(err);
          setIsGenerating(false);
        });
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const atlasPromise = generateAtlasWithCompute({
        environment,
        gltfScene: modelPath ? gltfScene : null,
        mesh,
        octahedralData,
        gridSize,
        atlasSize: effectiveAtlasSize,
        atlasCoverage,
        gl,
        camera,
        usePostProcessing,
        brightness,
        contrast,
        usePostDilatation,
        dilationRadius,
        gridSize,
      }).then(
        (texture) => {
          const atlasPayload = {
            texture,
            gridSize,
            octType,
            octahedralData,
          };

          if (cacheKey) {
            atlasCache.set(cacheKey, atlasPayload);
          }

          setAtlas(atlasPayload);
          setIsGenerating(false);

          return atlasPayload;
        },
        (err) => {
          console.error("Failed to generate atlas:", err);
          setError(err);
          setIsGenerating(false);
          throw err;
        }
      );

      if (cacheKey) {
        pendingAtlasPromises.set(cacheKey, atlasPromise);
      }

      atlasPromise.finally(() => {
        if (cacheKey) {
          pendingAtlasPromises.delete(cacheKey);
        }
      });
    } catch (err) {
      console.error("Error in atlas generation:", err);
      setError(err);
      setIsGenerating(false);
    }
  }, [
    mesh,
    gltfScene,
    modelPath,
    octahedralData,
    gridSize,
    effectiveAtlasSize,
    atlasSize,
    enabled,
    gl,
    scene,
    camera,
    octType,
    environment,
    usePostProcessing,
    brightness,
    contrast,
    optimizeSize,
    atlasCoverage,
    usePostDilatation,
    dilationRadius,
  ]);

  return {
    atlas,
    error,
    isGenerating,
    octahedralData,
  };
}

/**
 * Generates the octahedral impostor atlas using WebGPU compute shaders.
 * This version uses StorageTexture for direct GPU-based processing.
 * @param {Object} params - Generation parameters
 */
async function generateAtlasWithCompute({
  environment,
  gltfScene,
  mesh,
  octahedralData,
  gridSize,
  atlasSize,
  atlasCoverage = 1.0,
  gl,
  camera,
  usePostProcessing,
  brightness,
  contrast,
  usePostDilatation = false,
  dilationRadius = 1,
}) {
  console.log("🚀 Starting WebGPU Compute-based atlas generation...");

  // Prepare render mesh (same as before)
  const renderGroup = new THREE.Group();
  let meshCount = 0;

  const sourceScene = gltfScene?.scene || mesh;

  if (sourceScene) {
    sourceScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const clonedMesh = child.clone();
        clonedMesh.geometry = child.geometry.clone();
        if (child.material) {
          if (Array.isArray(child.material)) {
            clonedMesh.material = child.material.map((mat) => mat.clone());
          } else {
            clonedMesh.material = child.material.clone();
          }
        }
        renderGroup.add(clonedMesh);
        meshCount++;
      }
    });
  }

  console.log(`✓ Cloned ${meshCount} meshes for rendering`);

  const renderMesh = renderGroup;
  renderMesh.visible = true;

  // Create isolated scene for offscreen rendering
  const renderScene = new THREE.Scene();

  // Add lighting
  const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
  directionalLight.position.set(0, 4, 8);
  renderScene.add(directionalLight);

  if (environment) {
    renderScene.environment = environment;
    console.log("✓ Using environment map");
  }

  renderScene.add(renderMesh);

  // Center geometry and configure materials
  let processedMeshCount = 0;
  renderMesh.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      processedMeshCount++;
      node.geometry = node.geometry.clone();

      if (node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map((mat) => mat.clone());
        } else {
          node.material = node.material.clone();
        }
      }

      if (node.material) {
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        materials.forEach((mat) => {
          if (mat && mat.isMeshStandardMaterial) {
            if (environment) {
              mat.envMap = environment;
            }
            mat.toneMapped = true;
            mat.needsUpdate = true;
          }
        });
      }

      const geometry = node.geometry;
      geometry.computeBoundingSphere();
      if (geometry.boundingSphere) {
        const center = geometry.boundingSphere.center.clone();
        geometry.translate(-center.x, -center.y, -center.z);
        node.position.add(center);
      }
    }
  });

  console.log(`✓ Processed ${processedMeshCount} meshes for centering`);

  // Compute bounding sphere and scale
  const boundingSphere = new THREE.Sphere();
  renderMesh.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      node.geometry.computeBoundingSphere();
      if (node.geometry.boundingSphere) {
        const tempSphere = node.geometry.boundingSphere.clone();
        tempSphere.applyMatrix4(node.matrixWorld);
        boundingSphere.union(tempSphere);
      }
    }
  });

  const radius = boundingSphere.radius * 1.5;
  const scaleFactor = 0.5 / radius;
  renderMesh.scale.setScalar(scaleFactor);
  renderMesh.position.set(0, 0, 0);

  // Set up orthographic camera
  const orthoSize = 0.5;
  const renderCam = new THREE.OrthographicCamera(
    -orthoSize,
    orthoSize,
    orthoSize,
    -orthoSize,
    0.001,
    100
  );

  // Save original render state
  const originalRenderTarget = gl.getRenderTarget();
  const originalClearColor = new THREE.Color();
  gl.getClearColor(originalClearColor);

  const numCells = gridSize;
  // Apply atlas coverage to cell size calculation
  // Coverage < 1.0 means we use less of each cell, so we can render at higher resolution
  const effectiveCellSize = Math.floor((atlasSize / numCells) * atlasCoverage);
  const cellSize = Math.max(1, effectiveCellSize);

  const { pntOct } = octahedralData;

  // 🚀 CREATE STORAGE TEXTURE FOR ATLAS (WebGPU Compute)
  console.log("🚀 Creating StorageTexture for atlas...");
  const storageTexture = createStorageTexture(atlasSize, atlasSize);

  // Create temporary render target for each cell
  // In WebGPU, we use THREE.RenderTarget (not WebGPURenderTarget)
  const cellRenderTarget = new THREE.RenderTarget(cellSize, cellSize, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });

  console.log(`✓ Created ${cellSize}x${cellSize} render target for cells`);

  // Render each cell and copy to StorageTexture using compute shader
  let renderedCells = 0;
  const startTime = performance.now();

  for (let rowIdx = 0; rowIdx <= numCells; rowIdx++) {
    for (let colIdx = 0; colIdx <= numCells; colIdx++) {
      const flatIdx = rowIdx * numCells + colIdx;
      if (flatIdx * 3 + 2 >= pntOct.length) continue;

      const px = pntOct[flatIdx * 3];
      const py = pntOct[flatIdx * 3 + 1];
      const pz = pntOct[flatIdx * 3 + 2];

      const viewDir = new THREE.Vector3(px, py, pz).normalize();

      // Position camera
      const cameraDistance = 0.5;
      renderCam.position.copy(viewDir.multiplyScalar(cameraDistance));
      renderCam.lookAt(0, 0, 0);

      // Render to temporary target
      gl.setRenderTarget(cellRenderTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(renderScene, renderCam);

      // 🚀 USE COMPUTE SHADER TO COPY CELL TO STORAGE TEXTURE
      const pixelX = Math.floor((colIdx / numCells) * atlasSize);
      const pixelY = Math.floor((rowIdx / numCells) * atlasSize);

      // Create compute shader for this cell
      const cellTexture = cellRenderTarget.texture;
      const { computeNode, cellOffsetXUniform, cellOffsetYUniform } =
        createAtlasCopyComputeShader({
          sourceTexture: cellTexture,
          targetStorageTexture: storageTexture,
          cellSize,
          targetX: pixelX,
          targetY: pixelY,
          atlasSize,
        });

      // Execute compute shader
      await gl.computeAsync(computeNode);

      renderedCells++;

      // Progress logging
      if (renderedCells % 50 === 0 || renderedCells === (numCells + 1) ** 2) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(
          `⏳ Progress: ${renderedCells}/${
            (numCells + 1) ** 2
          } cells (${elapsed}s)`
        );
      }
    }
  }

  const renderTime = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`✓ Rendered ${renderedCells} cells in ${renderTime}s`);

  // 🚀 OPTIONAL: POST-PROCESS ATLAS USING COMPUTE SHADER
  let finalTexture = storageTexture;

  // Apply post-processing (brightness/contrast)
  if (usePostProcessing && (brightness !== 1.0 || contrast !== 1.0)) {
    console.log("🚀 Applying post-processing with compute shader...");

    const postProcessedStorage = createStorageTexture(atlasSize, atlasSize);

    const { computeNode } = createAtlasPostProcessShader({
      sourceTexture: finalTexture,
      targetStorageTexture: postProcessedStorage,
      atlasSize,
      brightness,
      contrast,
    });

    await gl.computeAsync(computeNode);
    console.log("✓ Post-processing complete");

    finalTexture = postProcessedStorage;
  }

  // Apply post-dilatation (expand textures to avoid bleeding)
  if (usePostDilatation) {
    console.log("🚀 Applying post-dilatation with compute shader...");

    const dilatedStorage = createStorageTexture(atlasSize, atlasSize);

    const { computeNode } = createAtlasDilatationShader({
      sourceTexture: finalTexture,
      targetStorageTexture: dilatedStorage,
      atlasSize,
      gridSize,
      dilationRadius,
    });

    await gl.computeAsync(computeNode);
    console.log("✓ Post-dilatation complete");

    finalTexture = dilatedStorage;
  }

  // Cleanup temporary resources
  cellRenderTarget.dispose();

  // Convert StorageTexture to regular texture for material use
  // In WebGPU, StorageTexture can be used directly with texture() in TSL
  const atlasTexture = finalTexture;
  atlasTexture.needsUpdate = true;
  atlasTexture.flipY = false;
  atlasTexture.minFilter = THREE.LinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;

  if (gl && gl.outputColorSpace !== undefined) {
    atlasTexture.colorSpace = gl.outputColorSpace;
  } else {
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
  }

  console.log("✅ Atlas generation complete!");
  console.log(`📊 Stats: ${renderedCells} cells, ${renderTime}s total`);

  // Restore original state
  gl.setRenderTarget(originalRenderTarget);
  gl.setClearColor(originalClearColor);

  // Cleanup
  renderScene.remove(renderMesh);
  renderMesh.geometry?.dispose();
  renderMesh.material?.dispose();

  return atlasTexture;
}
