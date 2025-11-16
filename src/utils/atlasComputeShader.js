import * as THREE from "three/webgpu";
import {
  texture,
  textureStore,
  Fn,
  instanceIndex,
  uvec2,
  vec4,
  vec2,
  float,
  uniform,
} from "three/tsl";

/**
 * Creates a WebGPU compute shader to copy and process atlas cells.
 * This uses StorageTexture for direct GPU-based atlas generation.
 * Comments in English per project guidelines.
 */
export function createAtlasCopyComputeShader({
  sourceTexture,
  targetStorageTexture,
  cellSize,
  targetX,
  targetY,
  atlasSize,
}) {
  const width = cellSize;
  const height = cellSize;

  // Define compute function to copy one cell
  const copyCellShader = Fn(
    ({ storageTexture, sourceTexture, cellOffsetX, cellOffsetY }) => {
      // Get current pixel position within the cell
      const localX = instanceIndex.mod(width);
      const localY = instanceIndex.div(width);

      // Calculate source UV (normalized 0-1)
      const sourceU = float(localX).div(float(width));
      const sourceV = float(localY).div(float(height));
      const sourceUV = vec2(sourceU, sourceV);

      // Sample from source texture
      const color = texture(sourceTexture, sourceUV);

      // Calculate target position in atlas
      const targetPosX = cellOffsetX.add(localX);
      const targetPosY = cellOffsetY.add(localY);
      const targetPos = uvec2(targetPosX, targetPosY);

      // Write to storage texture
      textureStore(storageTexture, targetPos, color).toWriteOnly();
    }
  );

  // Create uniforms for cell offset
  const cellOffsetXUniform = uniform(float(targetX));
  const cellOffsetYUniform = uniform(float(targetY));

  // Create compute node
  const computeNode = copyCellShader({
    storageTexture: targetStorageTexture,
    sourceTexture: sourceTexture,
    cellOffsetX: cellOffsetXUniform,
    cellOffsetY: cellOffsetYUniform,
  }).compute(width * height);

  return {
    computeNode,
    cellOffsetXUniform,
    cellOffsetYUniform,
  };
}

/**
 * Creates a WebGPU compute shader for post-processing the entire atlas.
 * Can be used for brightness/contrast adjustment, sharpening, etc.
 */
export function createAtlasPostProcessShader({
  sourceTexture,
  targetStorageTexture,
  atlasSize,
  brightness = 1.0,
  contrast = 1.0,
}) {
  const width = atlasSize;
  const height = atlasSize;

  const postProcessShader = Fn(
    ({ storageTexture, sourceTexture, brightnessUniform, contrastUniform }) => {
      const posX = instanceIndex.mod(width);
      const posY = instanceIndex.div(width);
      const indexUV = uvec2(posX, posY);

      // Sample source texture
      const u = float(posX).div(float(width));
      const v = float(posY).div(float(height));
      const sourceUV = vec2(u, v);

      let color = texture(sourceTexture, sourceUV);

      // Apply brightness and contrast
      // Formula: ((color - 0.5) * contrast) + 0.5 + brightness
      const rgb = color.rgb;
      const adjusted = rgb
        .sub(0.5)
        .mul(contrastUniform)
        .add(0.5)
        .mul(brightnessUniform);

      const finalColor = vec4(adjusted, color.a);

      // Write to storage texture
      textureStore(storageTexture, indexUV, finalColor).toWriteOnly();
    }
  );

  const brightnessUniform = uniform(float(brightness));
  const contrastUniform = uniform(float(contrast));

  const computeNode = postProcessShader({
    storageTexture: targetStorageTexture,
    sourceTexture: sourceTexture,
    brightnessUniform,
    contrastUniform,
  }).compute(width * height);

  return {
    computeNode,
    brightnessUniform,
    contrastUniform,
  };
}

/**
 * Helper function to create a StorageTexture for WebGPU compute shaders
 */
export function createStorageTexture(width, height) {
  return new THREE.StorageTexture(width, height);
}

/**
 * Helper function to convert StorageTexture to regular Texture for sampling
 */
export async function storageTextureToTexture(renderer, storageTexture) {
  // StorageTexture can be used directly with texture() in TSL
  // But for final use, we might want to copy to a regular texture
  // This is handled automatically by Three.js WebGPU

  // For now, return the storage texture as-is
  // Three.js WebGPU will handle the conversion internally
  return storageTexture;
}
