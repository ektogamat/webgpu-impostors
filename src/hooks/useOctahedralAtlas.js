import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import * as THREEGL from "three"; // WebGL version for pixel reading
import { useThree } from "@react-three/fiber";
import { buildOctahedralMesh, OCT_TYPE } from "../utils/octahedralHelper";

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
}) {
  const { gl, scene, camera } = useThree();
  const [atlas, setAtlas] = useState(null);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const octahedralDataRef = useRef(null);

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

  // Generate atlas
  useEffect(() => {
    if (!enabled || !mesh || !octahedralData || !gl) {
      setAtlas(null);
      return;
    }

    const cacheKey = buildAtlasCacheKey(mesh, gridSize, atlasSize, octType);

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
        mesh,
        octahedralData,
        gridSize,
        atlasSize,
        gl,
        scene,
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
    octahedralData,
    gridSize,
    atlasSize,
    enabled,
    gl,
    scene,
    camera,
    octType,
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
  mesh,
  octahedralData,
  gridSize,
  atlasSize,
  gl,
  scene,
  camera,
}) {
  // Clone mesh/group for rendering
  // mesh can be a single Mesh or a Group containing multiple meshes
  const renderMesh =
    mesh instanceof THREE.Group
      ? mesh.clone()
      : (() => {
          const group = new THREE.Group();
          group.add(mesh.clone());
          return group;
        })();
  renderMesh.visible = true;

  // Create isolated scene for offscreen rendering
  const renderScene = new THREE.Scene();

  // Add lighting
  // const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
  // renderScene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(5, 1, 7.5);
  renderScene.add(directionalLight);

  renderScene.add(renderMesh);

  // Center geometry origin to bounding sphere (like original)
  renderMesh.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
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

  const radius = boundingSphere.radius * 1.5;
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
    10
  );

  // Save original render state
  const originalRenderTarget = gl.getRenderTarget();
  const originalClearColor = new THREE.Color();
  gl.getClearColor(originalClearColor);

  const numCells = gridSize;
  const cellSize = Math.floor((atlasSize / numCells) * 1.0);

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
    antialias: false,
  });

  tempGlRenderer.setSize(cellSize, cellSize);
  tempGlRenderer.setClearColor(0x000000, 0);

  // Create reusable WebGL scene and lighting (created once)
  const glRenderScene = new THREEGL.Scene();
  // const glAmbientLight = new THREEGL.AmbientLight(0xffffff, 0.2);
  // glRenderScene.add(glAmbientLight);
  const glDirectionalLight = new THREEGL.DirectionalLight(0xffffff, 0.5);
  glDirectionalLight.position.set(5, 1, 7.5);
  glRenderScene.add(glDirectionalLight);

  // Create reusable WebGL camera
  const glRenderCam = new THREEGL.OrthographicCamera(
    -orthoSize,
    orthoSize,
    orthoSize,
    -orthoSize,
    0.001,
    10
  );

  // Clone mesh once for WebGL rendering
  const glRenderMesh = renderMesh.clone();
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

      // Position camera - EXACTLY AS ORIGINAL
      // Original: renderCam.position.copy(viewDir.multiplyScalar(1.1));
      // Original: renderCam.lookAt(centerX, centerY, centerZ); // Always look at bounding sphere center
      const cameraDistance = 1.1; // Original uses 1.1
      renderCam.position.copy(viewDir.multiplyScalar(cameraDistance));
      renderCam.lookAt(0, 0.5, 0); // Look at origin since mesh is centered

      // Update WebGL camera to match
      glRenderCam.position.copy(renderCam.position);
      glRenderCam.lookAt(0, 0.5, 0); // Look at origin

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
