import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three/webgpu";
import { useFrame, useThree } from "@react-three/fiber";
import { texture, uniform, uv, vec2, vec3, float } from "three/tsl";
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
}) {
  const groupRef = useRef(null);
  const billboardRef = useRef(null);
  const faceIndicesRef = useRef(new THREE.Vector3());
  const faceWeightsRef = useRef(new THREE.Vector3());
  const lastDirectionRef = useRef(null);
  const { camera, scene } = useThree();

  const tempCenter = useMemo(() => new THREE.Vector3(), []);
  const tempDirection = useMemo(() => new THREE.Vector3(), []);

  const { atlas, error, isGenerating, octahedralData } = useOctahedralAtlas({
    mesh,
    gridSize,
    atlasSize,
    octType,
    enabled: enabled && !!mesh,
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
    const a = indices.getX(0);
    const b = indices.getY(0);
    const c = indices.getZ(0);
    faceIndicesRef.current.set(a, b, c);
    faceWeightsRef.current.set(1 / 3, 1 / 3, 1 / 3);
  }, [octahedralData]);

  // Material with barycentric interpolation
  const nodeMaterial = useMemo(() => {
    if (!atlas || !octahedralData) return null;

    const material = new THREE.MeshStandardNodeMaterial();
    material.transparent = true;
    material.alphaTest = alphaTest;
    material.side = THREE.DoubleSide;
    material.roughness = roughness;
    material.metalness = metalness;

    // Uniforms - FOLLOWING ORIGINAL EXAMPLE EXACTLY
    const gridSizeUniform = uniform(float(gridSize));
    const atlasTexture = texture(atlas.texture);

    // Face indices and weights from raycast
    let initialIndices = [0, 1, 2];
    if (
      octahedralData.geometry.index &&
      octahedralData.geometry.index.count > 0
    ) {
      const indices = octahedralData.geometry.index;
      initialIndices = [indices.getX(0), indices.getY(0), indices.getZ(0)];
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
    const cellIndexA = vec2(colA, rowA);

    const rowB = flatIndexB.div(gridSizeUniform).floor();
    const colB = flatIndexB.sub(rowB.mul(gridSizeUniform));
    const cellIndexB = vec2(colB, rowB);

    const rowC = flatIndexC.div(gridSizeUniform).floor();
    const colC = flatIndexC.sub(rowC.mul(gridSizeUniform));
    const cellIndexC = vec2(colC, rowC);

    // Compute final UV - EXACTLY AS ORIGINAL: (cellIndex + vUv) / gridSize
    // Note: Invert Y coordinate to fix upside-down issue
    const invGridSize = float(1.0).div(gridSizeUniform);
    const flippedUv = vec2(vUv.x, float(1.0).sub(vUv.y)); // Flip Y
    const atlasUVA = cellIndexA.add(vUv).mul(invGridSize);
    const atlasUVB = cellIndexB.add(vUv).mul(invGridSize);
    const atlasUVC = cellIndexC.add(vUv).mul(invGridSize);

    // Sample three faces
    const colorA = atlasTexture.sample(atlasUVA);
    const colorB = atlasTexture.sample(atlasUVB);
    const colorC = atlasTexture.sample(atlasUVC);

    // Interpolate using barycentric weights
    // Original multiplies by 3.0: finalColor *= 3.0
    const finalColor = colorA.rgb
      .mul(faceWeightsUniform.x)
      .add(colorB.rgb.mul(faceWeightsUniform.y))
      .add(colorC.rgb.mul(faceWeightsUniform.z))
      .mul(float(1.0)); // Multiply by 3.0 as in original

    const finalAlpha = colorA.a
      .mul(faceWeightsUniform.x)
      .add(colorB.a.mul(faceWeightsUniform.y))
      .add(colorC.a.mul(faceWeightsUniform.z));

    material.colorNode = finalColor;
    material.opacityNode = finalAlpha;

    // Store uniforms for updating
    material.userData.faceIndicesUniform = faceIndicesUniform;
    material.userData.faceWeightsUniform = faceWeightsUniform;

    // Environment map
    if (scene.environment) {
      material.envMap = scene.environment;
      material.envMapIntensity = envMapIntensity;
    }

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

  // Billboard rotation and manual triangle selection
  useFrame(() => {
    if (!billboardRef.current || !camera || !nodeMaterial || !samplingCache)
      return;

    // Billboard rotation
    billboardRef.current.lookAt(camera.position);

    const targetCenter = tempCenter;
    if (groupRef.current) {
      groupRef.current.getWorldPosition(targetCenter);
    } else {
      targetCenter.set(position[0], position[1], position[2]);
    }

    const viewDir = tempDirection
      .copy(camera.position)
      .sub(targetCenter)
      .normalize();

    if (lastDirectionRef.current) {
      const dot = lastDirectionRef.current.dot(viewDir);
      if (dot >= directionThresholdDot) {
        return;
      }
    }

    const samplingSuccess = sampleOctahedralDirection({
      direction: viewDir,
      cache: samplingCache,
      indicesTarget: faceIndicesRef.current,
      weightsTarget: faceWeightsRef.current,
    });

    if (!samplingSuccess) {
      return;
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
    return (
      <group ref={groupRef} position={position} scale={scale}>
        <mesh>
          <planeGeometry args={geometryArgs} />
          <meshBasicMaterial color="yellow" transparent opacity={0.5} />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={groupRef} position={position} scale={scale}>
      <group ref={billboardRef}>
        <mesh>
          <planeGeometry args={geometryArgs} />
          <primitive object={nodeMaterial} attach="material" />
        </mesh>
      </group>
    </group>
  );
}
