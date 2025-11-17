import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import * as THREEGL from "three"; // WebGL version for pixel reading
import { useThree } from "@react-three/fiber";
import { buildOctahedralMesh, OCT_TYPE } from "../utils/octahedralHelper";
import { useEnvironment, useGLTF } from "@react-three/drei";
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
 * Hook to generate octahedral impostor atlas dynamically from a mesh.
 * Comments in English per project guidelines.
 */
export function useOctahedralAtlas({
  mesh = null,
  gridSize = 16,
  atlasSize = 2048,
  octType = OCT_TYPE.HEMI,
  enabled = true,
  optimizeSize = false, // Reduce resolution of non-critical textures to save VRAM
  atlasCoverage = 1.0, // How much of each atlas tile the geometry takes up (0-1)
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
  // This ensures we get the original, unmodified model
  // useGLTF must always be called (hooks rule), but we'll only use it if modelPath exists
  const gltfScene = useGLTF(modelPath || "/dummy.glb"); // Dummy path if no modelPath

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

  // Generate atlas
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
      const atlasPromise = generateAtlas({
        environment,
        gltfScene: modelPath ? gltfScene : null, // Use loaded scene if modelPath exists
        mesh, // Keep mesh for cache key
        octahedralData,
        gridSize,
        atlasSize: effectiveAtlasSize,
        atlasCoverage,
        gl,
        camera,
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
    optimizeSize,
    atlasCoverage,
  ]);

  return {
    atlas,
    error,
    isGenerating,
    octahedralData,
  };
}

/**
 * Generates the octahedral impostor atlas by rendering the mesh from multiple angles.
 * @param {Object} params - Generation parameters
 */
async function generateAtlas({
  environment,
  gltfScene,
  mesh,
  octahedralData,
  gridSize,
  atlasSize,
  atlasCoverage = 1.0,
  gl,
  camera,
}) {
  // Use the same method as TreeOctahedralImpostor: load from gltfScene and create group
  // This ensures we get all meshes correctly, same as drei's useGLTF
  const renderGroup = new THREE.Group();
  let meshCount = 0;

  // Use gltfScene if available (loaded with drei's useGLTF), otherwise fallback to mesh
  const sourceScene = gltfScene?.scene || mesh;

  if (sourceScene) {
    sourceScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Clone each mesh exactly as TreeOctahedralImpostor does
        const clonedMesh = child.clone();
        // Clone geometry to avoid affecting source
        clonedMesh.geometry = child.geometry.clone();
        // Clone material to avoid affecting source
        if (child.material) {
          if (Array.isArray(child.material)) {
            clonedMesh.material = child.material.map((mat) => mat.clone());
          } else {
            clonedMesh.material = child.material.clone();
          }
        }
        renderGroup.add(clonedMesh);
        meshCount++;
        console.log(
          `Atlas generation: Cloning mesh ${meshCount}: ${
            child.name || "unnamed"
          }`
        );
      }
    });
  }

  const renderMesh = renderGroup;
  renderMesh.visible = true;

  console.log(
    `Atlas generation: Cloned ${meshCount} meshes from ${
      gltfScene ? "gltfScene" : "mesh"
    }`
  );

  // Create isolated scene for offscreen rendering
  const renderScene = new THREE.Scene();

  // Add lighting - match main scene (no ambient, directional at (0, 4, 8))
  const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
  directionalLight.position.set(0, 4, 8);
  renderScene.add(directionalLight);

  // Use environment map from main scene if available (matches Environment preset)
  // The Environment component from drei sets scene.environment automatically
  if (environment) {
    renderScene.environment = environment;
    console.log("Atlas generation: Using environment map from main scene");
  } else {
    console.warn(
      "Atlas generation: No environment map found in main scene. Environment may still be loading."
    );
  }

  renderScene.add(renderMesh);

  // Center geometry origin to bounding sphere (like original)
  // IMPORTANT: Clone geometry AND material instances before mutating them, otherwise
  // GLTF shared geometries/materials will be modified and the original model will
  // appear distorted in the main scene. (English comment)
  let processedMeshCount = 0;
  renderMesh.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      processedMeshCount++;
      // Clone geometry to avoid affecting the source GLTF meshes
      node.geometry = node.geometry.clone();

      // CRITICAL: Clone materials before modifying them, otherwise we modify
      // the original GLTF materials that are shared with the main scene
      if (node.material) {
        if (Array.isArray(node.material)) {
          // Clone each material in the array
          node.material = node.material.map((mat) => mat.clone());
        } else {
          // Clone single material
          node.material = node.material.clone();
        }
      }

      // Now configure the cloned materials safely
      if (node.material) {
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        materials.forEach((mat) => {
          if (mat && mat.isMeshStandardMaterial) {
            // Use environment map if available
            if (environment) {
              mat.envMap = environment;
            }
            // Configure tone mapping to match impostor material settings
            mat.toneMapped = true;
            mat.needsUpdate = true;
          }
        });
      }

      const geometry = node.geometry;
      geometry.computeBoundingSphere();
      if (geometry.boundingSphere) {
        const center = geometry.boundingSphere.center.clone();
        // Translate geometry so bounding sphere center becomes origin
        geometry.translate(-center.x, -center.y, -center.z);
        // Move mesh to compensate
        node.position.add(center);
      }
    }
  });
  console.log(
    `Atlas generation: Processed ${processedMeshCount} meshes for centering`
  );

  // Compute bounding sphere after centering
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

  const radius = boundingSphere.radius * 2;
  const scaleFactor = 0.5 / radius; // scale to unit sphere
  renderMesh.scale.setScalar(scaleFactor);

  // Ensure mesh is at origin
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

  // Create canvas for building atlas (2D approach for WebGPU compatibility)
  const canvas = document.createElement("canvas");
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Failed to create 2D canvas context for atlas generation");
  }

  // Clear canvas with transparent background
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, atlasSize, atlasSize);

  // Create a single reusable WebGL renderer for all cells
  // This prevents creating too many WebGL contexts
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = cellSize;
  tempCanvas.height = cellSize;

  const tempGlRenderer = new THREEGL.WebGLRenderer({
    canvas: tempCanvas,
    preserveDrawingBuffer: true,
    antialias: true,
  });

  tempGlRenderer.setSize(cellSize, cellSize);
  tempGlRenderer.setClearColor(0x000000, 0);

  // Match main renderer settings for consistent color output
  // Copy tone mapping and color space settings from main renderer
  if (gl && gl.toneMapping !== undefined) {
    tempGlRenderer.toneMapping = gl.toneMapping;
  } else {
    // Default: disable tone mapping to match impostor material (toneMapped = false)
    tempGlRenderer.toneMapping = THREEGL.NoToneMapping;
  }

  if (gl && gl.toneMappingExposure !== undefined) {
    tempGlRenderer.toneMappingExposure = gl.toneMappingExposure;
  } else {
    tempGlRenderer.toneMappingExposure = 1.0;
  }

  // Handle color space / output encoding
  if (gl && gl.outputColorSpace !== undefined) {
    tempGlRenderer.outputColorSpace = gl.outputColorSpace;
  } else if (gl && gl.outputEncoding !== undefined) {
    // Fallback for older Three.js versions
    tempGlRenderer.outputEncoding = gl.outputEncoding;
  } else {
    // Default to sRGB
    tempGlRenderer.outputColorSpace = THREEGL.SRGBColorSpace;
  }

  // Create reusable WebGL scene and lighting (created once)
  // Match main scene: no ambient light, directional at (0, 4, 8)
  const glRenderScene = new THREEGL.Scene();

  const glDirectionalLight = new THREEGL.DirectionalLight(0xffffff, 3);
  glDirectionalLight.position.set(0, 4, 8);
  glRenderScene.add(glDirectionalLight);

  // Use environment map from main scene if available (matches Environment preset)
  // The Environment component from drei sets scene.environment automatically
  if (environment) {
    glRenderScene.environment = environment;
  }

  // Create reusable WebGL camera
  const glRenderCam = new THREEGL.OrthographicCamera(
    -orthoSize,
    orthoSize,
    orthoSize,
    -orthoSize,
    0.001,
    100
  );

  // Clone mesh once for WebGL rendering using deep clone
  // renderMesh already has cloned materials, but we need to ensure
  // materials are cloned for WebGL version (THREEGL) as well
  const glRenderMesh = renderMesh.clone(true); // Deep clone to preserve all meshes

  // Debug: Count meshes in WebGL clone
  let glMeshCount = 0;
  glRenderMesh.traverse((node) => {
    if (node instanceof THREEGL.Mesh) {
      glMeshCount++;
    }
  });
  console.log(`Atlas generation: WebGL clone has ${glMeshCount} meshes`);

  // Ensure materials are cloned for WebGL renderer (they should be from renderMesh, but ensure)
  glRenderMesh.traverse((node) => {
    if (node instanceof THREEGL.Mesh && node.material) {
      // Materials should already be cloned from renderMesh, but clone again to be safe
      // This ensures we don't modify materials that might be shared
      if (Array.isArray(node.material)) {
        node.material = node.material.map((mat) => mat.clone());
      } else {
        node.material = node.material.clone();
      }
    }
  });

  // Now configure the cloned materials safely
  glRenderMesh.traverse((node) => {
    if (node instanceof THREEGL.Mesh && node.material) {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      materials.forEach((mat) => {
        if (mat && mat.isMeshStandardMaterial) {
          // Use environment map if available
          if (environment) {
            mat.envMap = environment;
          }
          // Configure tone mapping to match impostor material settings
          mat.toneMapped = true;
          mat.needsUpdate = true;
        }
      });
    }
  });

  glRenderScene.add(glRenderMesh);

  // Render each cell
  // Following original example exactly: use numCells (gridSize) for flatIdx calculation
  for (let rowIdx = 0; rowIdx <= numCells; rowIdx++) {
    for (let colIdx = 0; colIdx <= numCells; colIdx++) {
      // Original uses: flatIdx = (rowIdx * numCells) + colIdx
      const flatIdx = rowIdx * numCells + colIdx;
      if (flatIdx * 3 + 2 >= pntOct.length) continue;

      const px = pntOct[flatIdx * 3];
      const py = pntOct[flatIdx * 3 + 1];
      const pz = pntOct[flatIdx * 3 + 2];

      const viewDir = new THREE.Vector3(px, py, pz).normalize();

      // Position camera - match original distance
      // Original uses 1.1, which is more than 2x the mesh radius (0.5 after scaling)
      // This ensures proper perspective and avoids clipping, especially when looking from above
      const cameraDistance = 1.1; // Match original value
      renderCam.position.copy(viewDir.multiplyScalar(cameraDistance));
      // Look at true mesh center (origin after recentering), otherwise the
      // captured angle will be slightly tilted compared to the sampling
      // direction used at runtime. (English comment)
      renderCam.lookAt(0, 0, 0);

      // Update WebGL camera to match
      glRenderCam.position.copy(renderCam.position);
      glRenderCam.lookAt(0, 0, 0);

      // Render using the reusable WebGL renderer
      let imageData = null;

      try {
        tempGlRenderer.clear();
        tempGlRenderer.render(glRenderScene, glRenderCam);

        // Read pixels directly from WebGL context
        const glContext = tempGlRenderer.getContext();
        if (glContext) {
          const pixels = new Uint8Array(cellSize * cellSize * 4);
          // Read pixels from the default framebuffer (the canvas)
          glContext.readPixels(
            0,
            0,
            cellSize,
            cellSize,
            glContext.RGBA,
            glContext.UNSIGNED_BYTE,
            pixels
          );
          imageData = pixels;
        } else {
          throw new Error("Unable to get WebGL context from renderer");
        }
      } catch (err) {
        console.warn("Error reading pixels from render target:", err);
        // Skip this cell if we can't read pixels
        continue;
      }

      if (!imageData) continue;

      // Create ImageData and draw to canvas
      const cellImageData = ctx.createImageData(cellSize, cellSize);
      cellImageData.data.set(imageData);

      // Calculate position in atlas
      // Original uses: pixelX = (colIdx / numCells * renderTarget.width)
      const pixelX = Math.floor((colIdx / numCells) * atlasSize);
      const pixelY = Math.floor((rowIdx / numCells) * atlasSize);

      // Draw cell to canvas at correct position
      ctx.putImageData(cellImageData, pixelX, pixelY);
    }
  }

  // Cleanup WebGL renderer and resources (only once at the end)
  tempGlRenderer.dispose();
  glRenderMesh.geometry?.dispose();
  glRenderMesh.material?.dispose();

  // Create texture from canvas
  const atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.needsUpdate = true;
  atlasTexture.flipY = false; // Original uses default (false)
  atlasTexture.minFilter = THREE.LinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;

  // Match color space from main renderer
  if (gl && gl.outputColorSpace !== undefined) {
    atlasTexture.colorSpace = gl.outputColorSpace;
  } else if (gl && gl.outputEncoding !== undefined) {
    // Fallback for older Three.js versions
    atlasTexture.encoding = gl.outputEncoding;
  } else {
    // Default to sRGB
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
  }

  // Debug: Log atlas info
  console.log("Atlas generated:", {
    width: canvas.width,
    height: canvas.height,
    cellSize,
    numCells: numCells + 1,
    totalCells: (numCells + 1) * (numCells + 1),
  });

  // Debug: Check if canvas has content by sampling a pixel
  const testCtx = canvas.getContext("2d");
  if (testCtx) {
    const testImageData = testCtx.getImageData(
      0,
      0,
      Math.min(100, canvas.width),
      Math.min(100, canvas.height)
    );
    const hasContent = testImageData.data.some(
      (val, idx) => idx % 4 === 3 && val > 0
    ); // Check alpha channel
    console.log("Atlas has content:", hasContent);
    if (!hasContent) {
      console.warn("Atlas appears to be empty!");
    }
  }

  // Restore original state
  gl.setRenderTarget(originalRenderTarget);
  gl.setClearColor(originalClearColor);

  // Cleanup
  renderScene.remove(renderMesh);
  renderMesh.geometry?.dispose();
  renderMesh.material?.dispose();

  return atlasTexture;
}
