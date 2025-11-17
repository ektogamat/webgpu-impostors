# Guia de Otimização para 10.000+ Instâncias

## Análise e Adaptações de Técnicas de Impostor para TSL + WebGPU

---

## 🎯 Objetivo

Elevar a capacidade de renderização de **500 instâncias** para **10.000+ instâncias** mantendo performance aceitável (>30 FPS).

---

## 📊 Análise do Código Atual

### ✅ O que já está bem implementado:

1. **Atlas Cache System** - Compartilhamento de atlas entre instâncias (`useOctahedralAtlasCompute`)
2. **WebGPU Compute Shaders** - Geração de atlas otimizada na GPU
3. **Sampling Cache** - Cache de direções octahedrais compartilhado
4. **Billboard Rotation** - Rotação otimizada com threshold

### ❌ Principais Gargalos Identificados:

1. **Renderização Individual** - Cada instância é um componente React separado
2. **Draw Calls Excessivos** - Um draw call por instância (500 draw calls para 500 instâncias)
3. **Update por Frame** - `useFrame()` executado para cada instância
4. **Sem LOD System** - Todas instâncias renderizadas com mesma qualidade
5. **Frustum Culling** - Desabilitado (`frustumCulled={false}`)

---

## 🚀 Principais Técnicas para Implementar

### 1. InstancedMesh - CRÍTICO ⭐⭐⭐⭐⭐

**Prioridade: MÁXIMA**

#### Por que é importante:

- Reduz de **N draw calls** para **1 draw call** (500 → 1)
- GPU processa todas instâncias em paralelo
- Economia massiva de CPU

#### Implementação no Código:

```javascript
// NEW FILE: src/TreeOctahedralImpostorInstanced.jsx
import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three/webgpu";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useOctahedralAtlasCompute } from "./hooks/useOctahedralAtlasCompute";
import { getSamplingCache } from "./utils/octahedralImpostorMath";

/**
 * TreeOctahedralImpostorInstanced - Renders thousands of impostors
 * using a single InstancedMesh for optimal performance.
 * Uses WebGPU compute shaders for atlas generation.
 */
export default function TreeOctahedralImpostorInstanced({
  modelPath,
  count = 1000,
  areaSize = [100, 100],
  position = [0, 0, 0],
  minScale = 0.8,
  maxScale = 1.2,
  baseScale = [1, 1, 1],
  gridSize = 16,
  atlasSize = 2048,
  octType = 0,
  geometryArgs = [2, 2],
  roughness = 1,
  metalness = 0,
  alphaTest = 0.5,
  seed = 2024,
  // Optimization parameters
  enableFrustumCulling = true,
  lodDistances = [50, 100, 200], // Distance thresholds for LOD
  maxVisibleDistance = 300,
}) {
  const instancedMeshRef = useRef(null);
  const { camera } = useThree();

  // Load model and generate atlas (cached)
  const gltf = useGLTF(modelPath);
  const sourceMesh = useMemo(() => {
    if (!gltf?.scene) return null;
    let foundMesh = null;
    gltf.scene.traverse((child) => {
      if (!foundMesh && child.isMesh) {
        foundMesh = child;
      }
    });
    if (foundMesh) {
      foundMesh.userData.__impostorSourceId = modelPath;
    }
    return foundMesh;
  }, [gltf, modelPath]);

  const { atlas, isGenerating } = useOctahedralAtlasCompute({
    mesh: sourceMesh,
    gridSize,
    atlasSize,
    octType,
    enabled: !!sourceMesh,
  });

  // Generate instance positions (same logic as before)
  const instances = useMemo(() => {
    // ... same position generation logic from TreeOctahedralImpostorFieldCompute
    // Returns array of { position: [x, y, z], scale: [sx, sy, sz] }
  }, [count, areaSize, position, seed, minScale, maxScale, baseScale]);

  // Create instanced matrices
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!instancedMeshRef.current || instances.length === 0) return;

    const mesh = instancedMeshRef.current;

    // Set initial transforms for all instances
    instances.forEach((instance, i) => {
      dummy.position.set(...instance.position);
      dummy.scale.set(...instance.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [instances, dummy]);

  // Billboard update - optimized for instanced mesh
  useFrame(() => {
    if (!instancedMeshRef.current || !camera) return;

    const mesh = instancedMeshRef.current;
    const cameraPos = camera.position;

    // Update only visible instances (frustum culling)
    instances.forEach((instance, i) => {
      const pos = instance.position;

      // Distance culling
      const dx = cameraPos.x - pos[0];
      const dy = cameraPos.y - pos[1];
      const dz = cameraPos.z - pos[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      const maxDistSq = maxVisibleDistance * maxVisibleDistance;

      if (distSq > maxDistSq) {
        // Hide instance by scaling to 0
        dummy.scale.set(0, 0, 0);
      } else {
        // Billboard rotation toward camera
        dummy.position.set(...pos);
        dummy.scale.set(...instance.scale);
        dummy.lookAt(cameraPos);

        // LOD based on distance
        const dist = Math.sqrt(distSq);
        let lodScale = 1.0;
        if (dist > lodDistances[2]) {
          lodScale = 0.5; // Lowest detail
        } else if (dist > lodDistances[1]) {
          lodScale = 0.75; // Medium detail
        } else if (dist > lodDistances[0]) {
          lodScale = 0.9; // High detail
        }

        dummy.scale.multiplyScalar(lodScale);
      }

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  // Material with TSL (same as OctahedralImpostor but instanced-aware)
  const material = useMemo(() => {
    if (!atlas) return null;

    // Create material with TSL nodes
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.alphaTest = alphaTest;

    // ... implement TSL material nodes (same as OctahedralImpostor.jsx)

    return mat;
  }, [atlas, gridSize, alphaTest]);

  if (isGenerating || !atlas || !material) {
    return null;
  }

  return (
    <instancedMesh
      ref={instancedMeshRef}
      args={[null, null, count]}
      frustumCulled={enableFrustumCulling}
    >
      <planeGeometry args={geometryArgs} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}
```

**Ganho Esperado:**

- **5-10x mais instâncias** com mesmo desempenho
- Redução de draw calls de 500 para 1

---

### 2. LOD (Level of Detail) Dinâmico ⭐⭐⭐⭐

#### Conceito:

Reduzir qualidade/tamanho de impostors distantes automaticamente.

#### Implementação:

```javascript
// In useFrame() hook
const calculateLOD = (distance) => {
  if (distance < 30) return { scale: 1.0, visible: true };
  if (distance < 100) return { scale: 0.8, visible: true };
  if (distance < 200) return { scale: 0.5, visible: true };
  if (distance < 400) return { scale: 0.3, visible: true };
  return { scale: 0, visible: false }; // Hide completely
};

// Apply to each instance
instances.forEach((instance, i) => {
  const dist = instance.position.distanceTo(camera.position);
  const lod = calculateLOD(dist);

  if (!lod.visible) {
    dummy.scale.set(0, 0, 0); // Hide instance
  } else {
    dummy.scale.set(
      instance.baseScale.x * lod.scale,
      instance.baseScale.y * lod.scale,
      instance.baseScale.z * lod.scale
    );
  }

  mesh.setMatrixAt(i, dummy.matrix);
});
```

**Ganho Esperado:**

- **2-3x mais instâncias** visíveis mantendo FPS
- Economia de fill rate

---

### 3. Spatial Partitioning (Octree/Grid) ⭐⭐⭐⭐

#### Por que é importante:

Evitar processar instâncias fora da câmera.

#### Implementação:

```javascript
// NEW FILE: src/utils/spatialGrid.js

/**
 * Simple spatial grid for fast spatial queries
 */
export class SpatialGrid {
  constructor(bounds, cellSize) {
    this.bounds = bounds; // { min: [x,y,z], max: [x,y,z] }
    this.cellSize = cellSize;
    this.grid = new Map();

    this.gridSize = [
      Math.ceil((bounds.max[0] - bounds.min[0]) / cellSize),
      Math.ceil((bounds.max[1] - bounds.min[1]) / cellSize),
      Math.ceil((bounds.max[2] - bounds.min[2]) / cellSize),
    ];
  }

  // Get cell key for position
  getCellKey(position) {
    const x = Math.floor((position[0] - this.bounds.min[0]) / this.cellSize);
    const y = Math.floor((position[1] - this.bounds.min[1]) / this.cellSize);
    const z = Math.floor((position[2] - this.bounds.min[2]) / this.cellSize);
    return `${x},${y},${z}`;
  }

  // Add instance to grid
  addInstance(instance, index) {
    const key = this.getCellKey(instance.position);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key).push({ instance, index });
  }

  // Query instances near camera (frustum)
  queryNearCamera(cameraPos, radius) {
    const visible = [];
    const radiusSq = radius * radius;

    this.grid.forEach((instances, key) => {
      // Quick distance check to cell
      instances.forEach(({ instance, index }) => {
        const dx = instance.position[0] - cameraPos.x;
        const dy = instance.position[1] - cameraPos.y;
        const dz = instance.position[2] - cameraPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq <= radiusSq) {
          visible.push({ instance, index, distance: Math.sqrt(distSq) });
        }
      });
    });

    return visible;
  }
}

// Usage in component:
const spatialGrid = useMemo(() => {
  const grid = new SpatialGrid(
    {
      min: [-areaSize[0] / 2, -10, -areaSize[1] / 2],
      max: [areaSize[0] / 2, 10, areaSize[1] / 2],
    },
    20 // Cell size
  );

  instances.forEach((instance, i) => {
    grid.addInstance(instance, i);
  });

  return grid;
}, [instances, areaSize]);

// In useFrame:
const visibleInstances = spatialGrid.queryNearCamera(
  camera.position,
  maxVisibleDistance
);

// Update only visible instances
visibleInstances.forEach(({ instance, index }) => {
  // Update matrix for this instance
});
```

**Ganho Esperado:**

- **10-20x redução** no tempo de update loop
- Processa apenas ~100-500 instâncias por frame em vez de 10.000

---

### 4. Batch Update Optimization ⭐⭐⭐

#### Conceito:

Atualizar apenas instâncias que mudaram significativamente.

```javascript
// Track last update per instance
const lastUpdateRef = useRef(new Map());
const UPDATE_THRESHOLD = 0.1; // Only update if camera moved >0.1 units

useFrame(() => {
  const cameraPos = camera.position;

  visibleInstances.forEach(({ instance, index }) => {
    const lastCameraPos = lastUpdateRef.current.get(index);

    if (!lastCameraPos) {
      // First update
      updateInstance(instance, index);
      lastUpdateRef.current.set(index, cameraPos.clone());
      return;
    }

    const cameraDist = lastCameraPos.distanceTo(cameraPos);

    // Only update if camera moved significantly
    if (cameraDist > UPDATE_THRESHOLD) {
      updateInstance(instance, index);
      lastUpdateRef.current.set(index, cameraPos.clone());
    }
  });
});
```

**Ganho Esperado:**

- **30-50% redução** em atualizações por frame

---

### 5. GPU-Based Direction Calculation ⭐⭐⭐⭐

#### Conceito:

Mover cálculos de direção para vertex/fragment shader.

```javascript
// In TSL Material:
const cameraPositionUniform = uniform(vec3(camera.position));
const instancePositionAttribute = attribute("instancePosition"); // Custom attribute

// Calculate view direction in vertex shader
const vertexShader = Fn(({ position, instancePosition }) => {
  const worldPos = position.add(instancePosition);
  const viewDir = cameraPositionUniform.sub(worldPos).normalize();

  // Calculate face indices based on viewDir (GPU-side)
  const octUV = encodeDirectionToOctUV(viewDir); // Implement in TSL

  return {
    position: worldPos,
    octUV: octUV,
  };
});
```

**Ganho Esperado:**

- **Remove CPU bottleneck** de cálculo de direção
- GPU faz cálculo em paralelo para todas instâncias

---

### 6. Memory Pooling ⭐⭐⭐

```javascript
// Reuse objects to avoid GC pressure
const tempVector = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();

// Don't create new objects in loops
// BAD:
instances.forEach((i) => {
  const pos = new THREE.Vector3(); // Creates new object every frame!
});

// GOOD:
instances.forEach((i) => {
  tempVector.set(i.x, i.y, i.z); // Reuses existing object
});
```

---

### 7. Multi-Atlas System ⭐⭐⭐

Para diferentes tipos de objetos, use atlas compartilhado:

```javascript
// Cache global de atlas
const GLOBAL_ATLAS_CACHE = {
  "tree.glb": atlas1,
  "car.glb": atlas2,
  "rock.glb": atlas3,
};

// Agrupe instâncias por modelo
const instancesByModel = useMemo(() => {
  return {
    trees: instances.filter((i) => i.model === "tree.glb"),
    cars: instances.filter((i) => i.model === "car.glb"),
  };
}, [instances]);

// Renderize um InstancedMesh por modelo
return (
  <>
    <InstancedMesh
      instances={instancesByModel.trees}
      atlas={GLOBAL_ATLAS_CACHE["tree.glb"]}
    />
    <InstancedMesh
      instances={instancesByModel.cars}
      atlas={GLOBAL_ATLAS_CACHE["car.glb"]}
    />
  </>
);
```

---

## 📈 Ganhos Esperados (Cumulativos)

| Otimização           | Ganho Individual | Ganho Acumulado   |
| -------------------- | ---------------- | ----------------- |
| Baseline (atual)     | -                | 500 instâncias    |
| InstancedMesh        | 5-10x            | 2.500-5.000       |
| + LOD System         | 2x               | 5.000-10.000      |
| + Spatial Grid       | 1.5x             | 7.500-15.000      |
| + Batch Updates      | 1.3x             | 10.000-20.000     |
| + GPU Direction Calc | 1.2x             | **12.000-24.000** |

---

## 🎬 Plano de Implementação (Ordem de Prioridade)

### Fase 1: InstancedMesh (1-2 dias)

1. Criar `TreeOctahedralImpostorInstanced.jsx`
2. Migrar lógica de material para suportar instancing
3. Testar com 1.000 instâncias
4. **Meta: 2.000-5.000 instâncias**

### Fase 2: LOD + Spatial Grid (2-3 dias)

1. Implementar sistema de LOD
2. Criar `SpatialGrid` utility
3. Integrar com InstancedMesh
4. **Meta: 5.000-10.000 instâncias**

### Fase 3: GPU Optimizations (2-3 dias)

1. Mover cálculos para GPU (TSL)
2. Implementar batch updates
3. Memory pooling
4. **Meta: 10.000-15.000 instâncias**

### Fase 4: Polish (1-2 dias)

1. Multi-atlas system
2. Fine-tuning de parâmetros
3. Profiling e otimização
4. **Meta: 15.000+ instâncias**

---

## 🔧 Código de Referência Completo

### Complete Instanced Component Example

```javascript
// FILE: src/TreeOctahedralImpostorInstancedOptimized.jsx
import { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three/webgpu";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useOctahedralAtlasCompute } from "./hooks/useOctahedralAtlasCompute";
import { getSamplingCache } from "./utils/octahedralImpostorMath";
import { SpatialGrid } from "./utils/spatialGrid";
import { texture, uniform, vec3, vec2, float, Fn } from "three/tsl";

/**
 * Highly optimized instanced impostor renderer
 * Supports 10,000+ instances with LOD, spatial culling, and GPU optimizations
 */
export default function TreeOctahedralImpostorInstancedOptimized({
  modelPath,
  count = 5000,
  areaSize = [200, 200],
  position = [0, 0, 0],
  minScale = 0.8,
  maxScale = 1.2,
  baseScale = [1, 1, 1],
  gridSize = 16,
  atlasSize = 2048,
  octType = 0,
  geometryArgs = [2, 2],
  seed = 2024,
  // LOD settings
  lodDistances = [50, 100, 200, 400],
  maxVisibleDistance = 500,
  // Optimization settings
  updateBatchSize = 100, // Update N instances per frame
  spatialCellSize = 30,
  frustumCullingMargin = 1.2,
}) {
  const instancedMeshRef = useRef(null);
  const { camera, gl } = useThree();
  const [visibleCount, setVisibleCount] = useState(0);

  // Reusable objects (avoid GC)
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projScreenMatrix = useMemo(() => new THREE.Matrix4(), []);

  // Load model and atlas
  const gltf = useGLTF(modelPath);
  const sourceMesh = useMemo(() => {
    if (!gltf?.scene) return null;
    let foundMesh = null;
    gltf.scene.traverse((child) => {
      if (!foundMesh && child.isMesh) foundMesh = child;
    });
    if (foundMesh) {
      foundMesh.userData.__impostorSourceId = modelPath;
    }
    return foundMesh;
  }, [gltf, modelPath]);

  const { atlas } = useOctahedralAtlasCompute({
    mesh: sourceMesh,
    gridSize,
    atlasSize,
    octType,
    enabled: !!sourceMesh,
  });

  // Generate instances with seeded random
  const instances = useMemo(() => {
    const createSeededRandom = (s) => {
      let seed = s;
      return () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
    };

    const random = createSeededRandom(seed);
    const result = [];
    const [width, depth] = areaSize;
    const [ox, oy, oz] = position;

    for (let i = 0; i < count; i++) {
      const x = ox + (random() - 0.5) * width;
      const z = oz + (random() - 0.5) * depth;
      const scale = minScale + random() * (maxScale - minScale);

      result.push({
        position: [x, oy, z],
        scale: [
          baseScale[0] * scale,
          baseScale[1] * scale,
          baseScale[2] * scale,
        ],
        visible: true,
        lodLevel: 0,
      });
    }

    return result;
  }, [count, areaSize, position, seed, minScale, maxScale, baseScale]);

  // Build spatial grid for fast culling
  const spatialGrid = useMemo(() => {
    const bounds = {
      min: [
        position[0] - areaSize[0] / 2,
        position[1] - 10,
        position[2] - areaSize[1] / 2,
      ],
      max: [
        position[0] + areaSize[0] / 2,
        position[1] + 10,
        position[2] + areaSize[1] / 2,
      ],
    };

    const grid = new SpatialGrid(bounds, spatialCellSize);
    instances.forEach((instance, i) => {
      grid.addInstance(instance, i);
    });

    return grid;
  }, [instances, areaSize, position, spatialCellSize]);

  // Initialize instance matrices
  useEffect(() => {
    if (!instancedMeshRef.current) return;

    const mesh = instancedMeshRef.current;

    instances.forEach((instance, i) => {
      dummy.position.set(...instance.position);
      dummy.scale.set(...instance.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [instances, dummy]);

  // Rolling update index for batch processing
  const updateIndexRef = useRef(0);
  const lastCameraPos = useRef(new THREE.Vector3());

  // Optimized update loop
  useFrame(() => {
    if (!instancedMeshRef.current || !camera || !atlas) return;

    const mesh = instancedMeshRef.current;
    const cameraPos = camera.position;

    // Update frustum for culling
    camera.updateMatrixWorld();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

    // Query visible instances using spatial grid
    const visibleInstances = spatialGrid.queryNearCamera(
      cameraPos,
      maxVisibleDistance * frustumCullingMargin
    );

    // Batch update: update only updateBatchSize instances per frame
    const startIdx = updateIndexRef.current;
    const endIdx = Math.min(
      startIdx + updateBatchSize,
      visibleInstances.length
    );

    let visible = 0;

    // Update batch
    for (let i = startIdx; i < endIdx; i++) {
      const { instance, index, distance } = visibleInstances[i];

      tempVec.set(...instance.position);

      // Frustum culling
      if (!frustum.containsPoint(tempVec)) {
        dummy.scale.set(0, 0, 0);
      } else {
        // LOD calculation
        let lodScale = 1.0;
        if (distance > lodDistances[3]) {
          dummy.scale.set(0, 0, 0); // Hide
        } else if (distance > lodDistances[2]) {
          lodScale = 0.3;
          visible++;
        } else if (distance > lodDistances[1]) {
          lodScale = 0.6;
          visible++;
        } else if (distance > lodDistances[0]) {
          lodScale = 0.9;
          visible++;
        } else {
          lodScale = 1.0;
          visible++;
        }

        if (lodScale > 0) {
          // Billboard rotation
          dummy.position.set(...instance.position);
          dummy.lookAt(cameraPos);
          dummy.scale.set(
            instance.scale[0] * lodScale,
            instance.scale[1] * lodScale,
            instance.scale[2] * lodScale
          );
        }
      }

      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }

    // Update all hidden instances (outside visible range)
    // Set them to scale 0
    instances.forEach((instance, index) => {
      const isVisible = visibleInstances.some((v) => v.index === index);
      if (!isVisible) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
    });

    mesh.instanceMatrix.needsUpdate = true;

    // Advance batch index (rolling update)
    updateIndexRef.current = (updateIndexRef.current + updateBatchSize) % count;

    // Update visible count (for debugging)
    if (Math.abs(updateIndexRef.current) < 10) {
      setVisibleCount(visible * (count / updateBatchSize));
    }

    lastCameraPos.current.copy(cameraPos);
  });

  // Material (same TSL implementation as OctahedralImpostor)
  const material = useMemo(() => {
    if (!atlas) return null;

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.alphaTest = 0.5;
    mat.side = THREE.FrontSide;

    // Implement full TSL material (simplified here)
    const atlasTexture = texture(atlas.texture);
    mat.colorNode = atlasTexture;
    mat.opacityNode = atlasTexture.a;

    return mat;
  }, [atlas]);

  if (!atlas || !material) {
    return null;
  }

  return (
    <>
      <instancedMesh
        ref={instancedMeshRef}
        args={[null, null, count]}
        frustumCulled={false} // We handle culling manually
      >
        <planeGeometry args={geometryArgs} />
        <primitive object={material} attach="material" />
      </instancedMesh>

      {/* Debug info */}
      {/* <Html position={[0, 20, 0]}>
        <div style={{ color: 'white', background: 'rgba(0,0,0,0.7)', padding: '8px' }}>
          Visible: {visibleCount} / {count}
        </div>
      </Html> */}
    </>
  );
}
```

---

## 🧪 Testes Recomendados

### Performance Benchmarks

```javascript
// Test configurations
const testCases = [
  { count: 1000, expectedFPS: 60 },
  { count: 5000, expectedFPS: 45 },
  { count: 10000, expectedFPS: 30 },
  { count: 20000, expectedFPS: 20 },
];

// Measure with Stats.js
import Stats from "three/addons/libs/stats.module.js";
const stats = new Stats();
document.body.appendChild(stats.dom);
```

### Memory Profiling

- Usar Chrome DevTools → Performance → Memory
- Verificar:
  - Heap size estável (sem memory leaks)
  - GPU memory usage < 1GB
  - Draw calls < 50

---

## 📚 Referências e Leitura Adicional

1. **Three.js InstancedMesh Documentation**

   - https://threejs.org/docs/#api/en/objects/InstancedMesh

2. **WebGPU Best Practices**

   - https://toji.dev/webgpu-best-practices/

3. **Octahedral Impostors**

   - http://www.filmicworlds.com/blog/octahedral-impostors/

4. **LOD Techniques**

   - https://en.wikipedia.org/wiki/Level_of_detail_(computer_graphics)

5. **Spatial Partitioning**
   - https://gameprogrammingpatterns.com/spatial-partition.html

---

## ✅ Checklist de Implementação

- [ ] Criar `TreeOctahedralImpostorInstanced.jsx`
- [ ] Implementar `SpatialGrid` utility
- [ ] Migrar material TSL para instanced mesh
- [ ] Implementar sistema de LOD
- [ ] Adicionar frustum culling otimizado
- [ ] Implementar batch updates
- [ ] Memory pooling (reuse objects)
- [ ] GPU-based direction calculation
- [ ] Testes com 1k, 5k, 10k, 20k instâncias
- [ ] Profiling e otimização final
- [ ] Documentação de uso

---

## 🎉 Resultados Esperados

Após implementar todas as otimizações:

✅ **10.000+ instâncias** a 30+ FPS  
✅ **< 10 draw calls** por frame  
✅ **< 500MB GPU memory**  
✅ **Smooth camera movement**  
✅ **No stuttering or frame drops**

---

**Última atualização:** 2025-11-17  
**Autor:** AI Assistant  
**Projeto:** webgpu-impostors
