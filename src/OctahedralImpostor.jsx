import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three/webgpu";
import { useFrame, useThree } from "@react-three/fiber";
import { texture, uniform, uv, vec2, vec3, float, Fn } from "three/tsl";
import { useOctahedralAtlas } from "./hooks/useOctahedralAtlas";
import {
  getSamplingCache,
  sampleOctahedralDirection,
} from "./utils/octahedralImpostorMath";

export default function OctahedralImpostor({
  mesh,
  position = [0, 0, 0],
  scale = [1, 1, 1],
  gridSize = 16,
  atlasSize = 2048,
  octType = 0,
  geometryArgs = [2, 2],
  roughness = 1,
  metalness = 0,
  alphaTest = 0.5,
  envMapIntensity = 1,
  enabled = true,
  samplingCacheOverride = null,
  directionThresholdRadians = 0.0174533,
  // New parameters from Godot implementation
  atlasCoverage = 0.5, // Controls how much of each atlas tile the geometry takes up (0-1)
  useDither = true, // Use dithering instead of alpha cut
  depthScale = 10.0, // Scale of depth texture parallax influence
  aabbMax = [1, 1, 1], // Bounding box based impostor offset
  // Billboard rotation parameters
  lockVerticalRotation = true, // Lock rotation when camera is above/below to avoid flipping
  verticalRotationThreshold = 0.5, // Threshold in radians (0.4 = ~72 degrees) for vertical viewing
  smoothRotation = true, // Smooth rotation transitions (uses slerp)
  rotationSmoothness = 0.5, // Smoothness factor (0-1, lower = smoother)
}) {
  const groupRef = useRef(null);
  const billboardRef = useRef(null);
  const faceIndicesRef = useRef(new THREE.Vector3());
  const faceWeightsRef = useRef(new THREE.Vector3());
  const lastDirectionRef = useRef(null);
  const { camera, scene } = useThree();

  const tempCenter = useMemo(() => new THREE.Vector3(), []);
  const tempDirection = useMemo(() => new THREE.Vector3(), []);
  const tempUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tempCameraDir = useMemo(() => new THREE.Vector3(), []);
  const tempBillboardPos = useMemo(() => new THREE.Vector3(), []);
  const tempHorizontalDir = useMemo(() => new THREE.Vector3(), []);
  const tempLookAtPoint = useMemo(() => new THREE.Vector3(), []);
  const tempCurrentForward = useMemo(() => new THREE.Vector3(), []);
  const tempTiltAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const lastQuaternion = useRef(null);
  const tempGroup = useMemo(() => new THREE.Group(), []);

  const { atlas, error, isGenerating, octahedralData } = useOctahedralAtlas({
    mesh,
    gridSize,
    atlasSize,
    octType,
    enabled: enabled && !!mesh,
    atlasCoverage,
  });

  const samplingCache = useMemo(() => {
    if (samplingCacheOverride) return samplingCacheOverride;
    return getSamplingCache(octType, gridSize);
  }, [samplingCacheOverride, octType, gridSize]);

  const directionThresholdDot = useMemo(() => {
    const clamped = Math.min(Math.max(directionThresholdRadians, 0), Math.PI);
    return Math.cos(clamped);
  }, [directionThresholdRadians]);

  useEffect(() => {
    if (
      !octahedralData?.geometry?.index ||
      octahedralData.geometry.index.count <= 0
    ) {
      return;
    }

    const indices = octahedralData.geometry.index;
    // Ensure we have valid indices - use first triangle
    const a = indices.getX(0);
    const b = indices.getY(0);
    const c = indices.getZ(0);

    // Validate indices are within bounds
    const maxIndex = octahedralData.geometry.attributes.position.count - 1;
    const validA = Math.max(0, Math.min(a, maxIndex));
    const validB = Math.max(0, Math.min(b, maxIndex));
    const validC = Math.max(0, Math.min(c, maxIndex));

    faceIndicesRef.current.set(validA, validB, validC);
    faceWeightsRef.current.set(1 / 3, 1 / 3, 1 / 3);
  }, [octahedralData]);

  // Material with barycentric interpolation
  const nodeMaterial = useMemo(() => {
    if (!atlas || !octahedralData) return null;

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.alphaTest = alphaTest;
    material.side = THREE.FrontSide;
    material.roughness = roughness;
    material.metalness = metalness;
    material.wireframe = false;

    // Uniforms - FOLLOWING ORIGINAL EXAMPLE EXACTLY
    const gridSizeUniform = uniform(float(gridSize));
    const atlasTexture = texture(atlas.texture);

    // Face indices and weights from raycast
    // Use current face indices if available, otherwise fallback to first triangle
    let initialIndices = [0, 1, 2];
    if (
      octahedralData.geometry.index &&
      octahedralData.geometry.index.count > 0
    ) {
      const indices = octahedralData.geometry.index;
      const maxIndex = octahedralData.geometry.attributes.position.count - 1;
      initialIndices = [
        Math.max(0, Math.min(indices.getX(0), maxIndex)),
        Math.max(0, Math.min(indices.getY(0), maxIndex)),
        Math.max(0, Math.min(indices.getZ(0), maxIndex)),
      ];
    }
    const faceIndicesUniform = uniform(
      vec3(initialIndices[0], initialIndices[1], initialIndices[2])
    );
    const faceWeightsUniform = uniform(vec3(1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0));

    // Get UV coordinates
    const vUv = uv();

    // Convert flat indices to row/col coordinates - EXACTLY AS ORIGINAL
    // Original: vec2 flatToCoords(float flatIndex) {
    //   float row = floor(flatIndex / gridSize);
    //   float col = flatIndex - row * gridSize;
    //   return vec2(col, row);
    // }
    const flatIndexA = float(faceIndicesUniform.x);
    const flatIndexB = float(faceIndicesUniform.y);
    const flatIndexC = float(faceIndicesUniform.z);

    const rowA = flatIndexA.div(gridSizeUniform).floor();
    const colA = flatIndexA.sub(rowA.mul(gridSizeUniform));
    // Clamp to valid grid range
    const maxRow = float(gridSize - 1);
    const maxCol = float(gridSize - 1);
    const safeRowA = rowA.clamp(0.0, maxRow);
    const safeColA = colA.clamp(0.0, maxCol);
    const cellIndexA = vec2(safeColA, safeRowA);

    const rowB = flatIndexB.div(gridSizeUniform).floor();
    const colB = flatIndexB.sub(rowB.mul(gridSizeUniform));
    const safeRowB = rowB.clamp(0.0, maxRow);
    const safeColB = colB.clamp(0.0, maxCol);
    const cellIndexB = vec2(safeColB, safeRowB);

    const rowC = flatIndexC.div(gridSizeUniform).floor();
    const colC = flatIndexC.sub(rowC.mul(gridSizeUniform));
    const safeRowC = rowC.clamp(0.0, maxRow);
    const safeColC = colC.clamp(0.0, maxCol);
    const cellIndexC = vec2(safeColC, safeRowC);

    // Compute final UV with Atlas Coverage support
    // Atlas Coverage controls how much of each tile is used (adds margin)
    const atlasCoverageUniform = uniform(float(atlasCoverage));
    const invGridSize = float(1.0).div(gridSizeUniform);
    const flippedUv = vec2(vUv.x, float(1.0).sub(vUv.y)); // Flip Y

    // Apply atlas coverage: scale UV within cell and center it
    // coverage = 1.0 means use full cell, < 1.0 adds margin
    const coverageOffset = float(1.0).sub(atlasCoverageUniform).mul(0.5);
    const scaledUv = vUv.mul(atlasCoverageUniform).add(coverageOffset);

    // Clamp UV to prevent sampling outside cell boundaries
    // This is critical when vertices are in different cells
    const clampedUv = vec2(
      scaledUv.x.clamp(0.0, 1.0),
      scaledUv.y.clamp(0.0, 1.0)
    );

    // Calculate UV for each cell, ensuring they stay within bounds
    // Add small epsilon to prevent edge sampling issues
    const epsilon = float(0.0001);
    const safeUv = vec2(
      clampedUv.x.mul(float(1.0).sub(epsilon.mul(2.0))).add(epsilon),
      clampedUv.y.mul(float(1.0).sub(epsilon.mul(2.0))).add(epsilon)
    );

    const atlasUVA = cellIndexA.add(safeUv).mul(invGridSize);
    const atlasUVB = cellIndexB.add(safeUv).mul(invGridSize);
    const atlasUVC = cellIndexC.add(safeUv).mul(invGridSize);

    // Final clamp to ensure UVs are within [0, 1] range
    const finalUVA = vec2(
      atlasUVA.x.clamp(0.0, 1.0),
      atlasUVA.y.clamp(0.0, 1.0)
    );
    const finalUVB = vec2(
      atlasUVB.x.clamp(0.0, 1.0),
      atlasUVB.y.clamp(0.0, 1.0)
    );
    const finalUVC = vec2(
      atlasUVC.x.clamp(0.0, 1.0),
      atlasUVC.y.clamp(0.0, 1.0)
    );

    // Sample three faces with clamped UVs
    // Use texture sampling with proper filtering
    const colorA = atlasTexture.sample(finalUVA);
    const colorB = atlasTexture.sample(finalUVB);
    const colorC = atlasTexture.sample(finalUVC);

    // Check if vertices are in very different cells (may cause artifacts)
    // If so, blend more conservatively
    const cellDistA = cellIndexA.sub(cellIndexB).length();
    const cellDistB = cellIndexB.sub(cellIndexC).length();
    const cellDistC = cellIndexC.sub(cellIndexA).length();
    const maxCellDist = cellDistA.max(cellDistB).max(cellDistC);

    // If cells are too far apart, use dominant weight to reduce artifacts
    const cellDistThreshold = float(2.0); // Allow up to 2 cells distance
    const useConservativeBlend = maxCellDist.greaterThan(cellDistThreshold);

    // Normalize weights to ensure they sum to 1
    const weightSum = faceWeightsUniform.x
      .add(faceWeightsUniform.y)
      .add(faceWeightsUniform.z);
    const normalizedWeights = vec3(
      faceWeightsUniform.x.div(weightSum.max(0.0001)),
      faceWeightsUniform.y.div(weightSum.max(0.0001)),
      faceWeightsUniform.z.div(weightSum.max(0.0001))
    );

    // Interpolate using barycentric weights
    // Original multiplies by 3.0: finalColor *= 3.0
    let finalColor = colorA.rgb
      .mul(normalizedWeights.x)
      .add(colorB.rgb.mul(normalizedWeights.y))
      .add(colorC.rgb.mul(normalizedWeights.z))
      .mul(float(1.5)); // Multiply by 3.0 as in original

    // If cells are too far apart, use more conservative blending
    // by reducing influence of distant cells
    if (useConservativeBlend) {
      // Find dominant weight and use it more
      const dominantWeight = normalizedWeights.x
        .max(normalizedWeights.y)
        .max(normalizedWeights.z);
      const blendFactor = float(0.7); // 70% dominant, 30% others
      const dominantColor = normalizedWeights.x
        .greaterThan(normalizedWeights.y.max(normalizedWeights.z))
        .select(
          colorA.rgb,
          normalizedWeights.y
            .greaterThan(normalizedWeights.z)
            .select(colorB.rgb, colorC.rgb)
        );
      finalColor = dominantColor
        .mul(blendFactor)
        .add(finalColor.mul(float(1.0).sub(blendFactor)));
    }

    const finalAlpha = colorA.a
      .mul(normalizedWeights.x)
      .add(colorB.a.mul(normalizedWeights.y))
      .add(colorC.a.mul(normalizedWeights.z));

    // Alpha dithering support (alternative to alpha cut)
    const alphaTestUniform = uniform(float(alphaTest));
    const useDitherUniform = uniform(float(useDither ? 1.0 : 0.0));

    // Dithering pattern (Bayer 4x4 matrix)
    // Bayer matrix: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] / 16.0
    const ditherPattern = Fn(({ uv }) => {
      const x = uv.x.mul(4.0).floor().mod(4.0);
      const y = uv.y.mul(4.0).floor().mod(4.0);
      // Simplified Bayer 4x4 lookup
      const bayerMatrix = vec2(x, y);
      const index = bayerMatrix.x.add(bayerMatrix.y.mul(4.0));
      // Approximate Bayer values (0-15 normalized to 0-1)
      const bayerValue = index.div(15.0).sub(0.5); // Range [-0.5, 0.5]
      return bayerValue;
    });

    const ditherValue = ditherPattern({ uv: flippedUv });
    const ditherThreshold = alphaTestUniform.add(ditherValue.mul(0.1)); // Scale dither effect

    // Choose between alpha cut and dither
    // When dithering: use thresholded alpha with dither pattern
    // When not dithering: use standard alpha test
    const ditheredAlpha = finalAlpha
      .sub(ditherThreshold)
      .step(0.0)
      .mul(finalAlpha);
    const cutAlpha = finalAlpha.step(alphaTestUniform).mul(finalAlpha);
    let processedAlpha = useDitherUniform
      .mul(ditheredAlpha)
      .add(float(1.0).sub(useDitherUniform).mul(cutAlpha));

    // Note: We don't force a minimum alpha here because that would make transparent areas visible
    // Instead, we ensure valid sampling and indices are always set (handled in useFrame)

    material.colorNode = finalColor;
    material.opacityNode = processedAlpha;
    material.alphaTest = useDither ? 0.0 : alphaTest; // Disable alphaTest when using dither
    material.toneMapped = true;

    // Store uniforms for updating
    material.userData.faceIndicesUniform = faceIndicesUniform;
    material.userData.faceWeightsUniform = faceWeightsUniform;

    return material;
  }, [
    atlas,
    octahedralData,
    gridSize,
    alphaTest,
    roughness,
    metalness,
    envMapIntensity,
    scene.environment,
    atlasCoverage,
    useDither,
    depthScale,
  ]);

  useEffect(() => {
    return () => {
      if (nodeMaterial) {
        nodeMaterial.dispose();
      }
    };
  }, [nodeMaterial]);

  useEffect(() => {
    lastDirectionRef.current = null;
  }, [samplingCache]);

  // Apply AABB Max offset for bounding box correction
  const aabbOffset = useMemo(() => {
    return new THREE.Vector3(aabbMax[0], aabbMax[1], aabbMax[2]);
  }, [aabbMax]);

  // Billboard rotation and manual triangle selection
  useFrame(() => {
    if (!billboardRef.current || !camera || !nodeMaterial || !samplingCache)
      return;

    const targetCenter = tempCenter;
    if (groupRef.current) {
      groupRef.current.getWorldPosition(targetCenter);
    } else {
      targetCenter.set(position[0], position[1], position[2]);
    }

    // Improved billboard rotation that avoids flipping when camera is above/below
    // Calculate direction from billboard to camera
    tempCameraDir.copy(camera.position).sub(targetCenter).normalize();

    // Calculate vertical angle (how much camera is looking up/down)
    const verticalAngle = Math.abs(Math.asin(tempCameraDir.y));
    const verticalThresholdRad = Math.PI * verticalRotationThreshold;

    let targetQuaternion;

    // When camera is very vertical (above/below), use constrained rotation
    if (lockVerticalRotation && verticalAngle > verticalThresholdRad) {
      // Project camera direction onto horizontal plane to avoid flip
      tempHorizontalDir.copy(tempCameraDir);
      tempHorizontalDir.y = 0;

      // If horizontal direction is too small (camera directly above/below), use last known direction
      if (tempHorizontalDir.length() < 0.1) {
        // Keep current rotation, just adjust pitch
        tempCurrentForward.set(0, 0, -1);
        tempCurrentForward.applyQuaternion(billboardRef.current.quaternion);
        tempHorizontalDir.copy(tempCurrentForward);
        tempHorizontalDir.y = 0;
      }
      tempHorizontalDir.normalize();

      // Create rotation that looks in horizontal direction but tilts toward camera
      tempLookAtPoint.copy(targetCenter).add(tempHorizontalDir);
      tempGroup.position.copy(targetCenter);
      tempGroup.lookAt(tempLookAtPoint);

      // Apply slight tilt toward camera for more natural look
      const tiltAmount = Math.min(
        (verticalAngle - verticalThresholdRad) / (Math.PI * 0.1),
        1.0
      );
      tempGroup.rotateOnAxis(tempTiltAxis, -tiltAmount * 0.3);

      targetQuaternion = tempGroup.quaternion.clone();
    } else {
      // Normal billboard rotation when camera is at reasonable angle
      tempGroup.position.copy(targetCenter);
      tempGroup.lookAt(camera.position);
      targetQuaternion = tempGroup.quaternion.clone();
    }

    // Apply rotation with optional smoothing
    if (smoothRotation && lastQuaternion.current) {
      billboardRef.current.quaternion.slerpQuaternions(
        lastQuaternion.current,
        targetQuaternion,
        1.0 - rotationSmoothness
      );
    } else {
      billboardRef.current.quaternion.copy(targetQuaternion);
    }

    // Store quaternion for next frame smoothing
    if (!lastQuaternion.current) {
      lastQuaternion.current = new THREE.Quaternion();
    }
    lastQuaternion.current.copy(billboardRef.current.quaternion);

    // Calculate direction from object to camera (matching original raycast)
    // Original: raycaster.ray.direction.subVectors(mesh.position, camera.position)
    const viewDir = tempDirection
      .copy(targetCenter)
      .sub(camera.position)
      .normalize();

    // Only skip update if direction hasn't changed significantly
    // But ensure we always have valid indices set
    if (lastDirectionRef.current) {
      const dot = lastDirectionRef.current.dot(viewDir);
      if (dot >= directionThresholdDot) {
        // Direction hasn't changed much, but ensure material is still valid
        // Update uniforms to ensure visibility
        if (
          nodeMaterial.userData.faceIndicesUniform &&
          faceIndicesRef.current
        ) {
          nodeMaterial.userData.faceIndicesUniform.value.set(
            faceIndicesRef.current.x,
            faceIndicesRef.current.y,
            faceIndicesRef.current.z
          );
          nodeMaterial.userData.faceIndicesUniform.needsUpdate = true;
        }
        if (
          nodeMaterial.userData.faceWeightsUniform &&
          faceWeightsRef.current
        ) {
          nodeMaterial.userData.faceWeightsUniform.value.set(
            faceWeightsRef.current.x,
            faceWeightsRef.current.y,
            faceWeightsRef.current.z
          );
          nodeMaterial.userData.faceWeightsUniform.needsUpdate = true;
        }
        nodeMaterial.needsUpdate = true;
        return;
      }
    }

    const samplingSuccess = sampleOctahedralDirection({
      direction: viewDir,
      cache: samplingCache,
      indicesTarget: faceIndicesRef.current,
      weightsTarget: faceWeightsRef.current,
    });

    // If sampling failed, use fallback to ensure something is always visible
    if (!samplingSuccess) {
      // Fallback: use first valid triangle from octahedral mesh
      if (
        octahedralData?.geometry?.index &&
        octahedralData.geometry.index.count > 0
      ) {
        const indices = octahedralData.geometry.index;
        const maxIndex = octahedralData.geometry.attributes.position.count - 1;
        const a = Math.max(0, Math.min(indices.getX(0), maxIndex));
        const b = Math.max(0, Math.min(indices.getY(0), maxIndex));
        const c = Math.max(0, Math.min(indices.getZ(0), maxIndex));
        faceIndicesRef.current.set(a, b, c);
        faceWeightsRef.current.set(1 / 3, 1 / 3, 1 / 3);
      } else {
        // Ultimate fallback: use default indices
        faceIndicesRef.current.set(0, 1, 2);
        faceWeightsRef.current.set(1 / 3, 1 / 3, 1 / 3);
      }
    }

    if (nodeMaterial.userData.faceIndicesUniform) {
      nodeMaterial.userData.faceIndicesUniform.value.set(
        faceIndicesRef.current.x,
        faceIndicesRef.current.y,
        faceIndicesRef.current.z
      );
      nodeMaterial.userData.faceIndicesUniform.needsUpdate = true;
    }

    if (nodeMaterial.userData.faceWeightsUniform) {
      nodeMaterial.userData.faceWeightsUniform.value.set(
        faceWeightsRef.current.x,
        faceWeightsRef.current.y,
        faceWeightsRef.current.z
      );
      nodeMaterial.userData.faceWeightsUniform.needsUpdate = true;
    }

    if (!lastDirectionRef.current) {
      lastDirectionRef.current = new THREE.Vector3();
    }
    lastDirectionRef.current.copy(viewDir);

    nodeMaterial.needsUpdate = true;
  });

  if (isGenerating || !atlas || !nodeMaterial) {
    return null;
  }

  return (
    <group ref={groupRef} position={position} scale={scale}>
      <group ref={billboardRef} position={aabbOffset}>
        <mesh>
          <planeGeometry args={geometryArgs} />
          <primitive object={nodeMaterial} attach="material" />
        </mesh>
      </group>
    </group>
  );
}
