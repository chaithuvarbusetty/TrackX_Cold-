import * as THREE from 'three';

export interface ThermalGridNode {
  position: THREE.Vector3;
  zone: 'front' | 'center' | 'rear' | 'ceiling';
  tempOffset: number;
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
}

export interface ThermalHeatmapGrid {
  root: THREE.Group;
  nodes: ThermalGridNode[];
  update: (baseTemp: number, isDoorOpen: boolean, delta: number, elapsed: number) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

// Color lookup helper based on temperature (Celsius)
function getHeatmapColor(temp: number, outColor: THREE.Color): THREE.Color {
  if (temp <= 2.0) {
    // Deep Sub-zero / Freezing - Indigo/Violet
    return outColor.setHex(0x6366f1);
  } else if (temp <= 4.0) {
    // Optimal Cold - Deep Cyan/Ice Blue
    return outColor.setHex(0x0284c7);
  } else if (temp <= 6.5) {
    // Safe Mid - Teal / Emerald
    return outColor.setHex(0x10b981);
  } else if (temp <= 8.0) {
    // Warning Margin - Amber / Yellow
    return outColor.setHex(0xf59e0b);
  } else {
    // Critical Excursion - Crimson Red
    return outColor.setHex(0xef4444);
  }
}

export function buildThermalHeatmapGrid(): ThermalHeatmapGrid {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();
  root.name = 'ThermalHeatmapGrid';

  // 12 volumetric grid measurement points inside the trailer
  // X: Front (+1.4) -> Mid (-1.5) -> Rear (-4.4)
  // Y: Bottom (1.8) -> Ceiling (3.4)
  // Z: Left (-0.7) -> Right (+0.7)
  const nodeDefs: Array<{ pos: [number, number, number]; zone: 'front' | 'center' | 'rear' | 'ceiling'; baseOffset: number }> = [
    // Front Cooling Zone (Near Reefer Discharge)
    { pos: [1.4, 3.2, -0.6], zone: 'front', baseOffset: -1.2 },
    { pos: [1.4, 3.2, 0.6], zone: 'front', baseOffset: -1.2 },
    { pos: [1.4, 1.8, 0.0], zone: 'front', baseOffset: -0.8 },

    // Center Cargo Bay (Core Shelf)
    { pos: [-0.6, 3.2, -0.6], zone: 'center', baseOffset: -0.2 },
    { pos: [-0.6, 3.2, 0.6], zone: 'center', baseOffset: -0.2 },
    { pos: [-0.6, 1.8, 0.0], zone: 'center', baseOffset: 0.0 },

    // Aft Cargo Bay
    { pos: [-2.6, 3.2, -0.6], zone: 'center', baseOffset: 0.3 },
    { pos: [-2.6, 3.2, 0.6], zone: 'center', baseOffset: 0.3 },
    { pos: [-2.6, 1.8, 0.0], zone: 'center', baseOffset: 0.5 },

    // Rear Door Thermal Infiltration Zone (Heats up immediately on door breach)
    { pos: [-4.4, 3.2, -0.6], zone: 'rear', baseOffset: 0.8 },
    { pos: [-4.4, 3.2, 0.6], zone: 'rear', baseOffset: 0.8 },
    { pos: [-4.4, 1.8, 0.0], zone: 'rear', baseOffset: 1.1 },
  ];

  const nodeGeo = track(new THREE.SphereGeometry(0.18, 16, 12));
  const haloGeo = track(new THREE.SphereGeometry(0.32, 16, 12));
  const nodes: ThermalGridNode[] = [];
  const tempColor = new THREE.Color();

  nodeDefs.forEach((def) => {
    const mat = track(
      new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.85,
        wireframe: false,
      })
    );
    const haloMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.28,
        wireframe: true,
      })
    );

    const mesh = new THREE.Mesh(nodeGeo, mat);
    mesh.position.set(...def.pos);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(...def.pos);

    root.add(mesh);
    root.add(halo);

    nodes.push({
      position: new THREE.Vector3(...def.pos),
      zone: def.zone,
      tempOffset: def.baseOffset,
      mesh,
      halo,
      mat,
      haloMat,
    });
  });

  // Connecting volumetric lattice lines
  const latticeMat = track(
    new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
    })
  );

  const linePositions: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dist = nodes[i].position.distanceTo(nodes[j].position);
      if (dist < 2.5) {
        linePositions.push(
          nodes[i].position.x, nodes[i].position.y, nodes[i].position.z,
          nodes[j].position.x, nodes[j].position.y, nodes[j].position.z
        );
      }
    }
  }

  const latticeGeo = track(new THREE.BufferGeometry());
  latticeGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const latticeMesh = new THREE.LineSegments(latticeGeo, latticeMat);
  root.add(latticeMesh);

  return {
    root,
    nodes,
    update: (baseTemp: number, isDoorOpen: boolean, delta: number, elapsed: number) => {
      nodes.forEach((node) => {
        // Physical thermal infiltration calculation:
        // When doors are open, rear zone heats up dramatically (+6 to +8°C), center heats moderately (+3°C),
        // front cooling unit struggles but stays coolest.
        let localTemp = baseTemp + node.tempOffset;
        if (isDoorOpen) {
          if (node.zone === 'rear') {
            localTemp += 6.5 + Math.sin(elapsed * 3.5 + node.position.x) * 0.4;
          } else if (node.zone === 'center') {
            localTemp += 2.8 + Math.sin(elapsed * 2.0 + node.position.x) * 0.2;
          } else {
            localTemp += 0.8;
          }
        }

        getHeatmapColor(localTemp, tempColor);
        node.mat.color.copy(tempColor);
        node.haloMat.color.copy(tempColor);

        // Gentle pulse breathing
        const pulse = 1.0 + Math.sin(elapsed * 3.0 + node.position.x * 2.0) * 0.08;
        node.mesh.scale.setScalar(pulse);
        node.halo.scale.setScalar(1.0 + Math.sin(elapsed * 4.0 + node.position.z) * 0.12);
      });
    },
    setVisible: (visible: boolean) => {
      root.visible = visible;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
