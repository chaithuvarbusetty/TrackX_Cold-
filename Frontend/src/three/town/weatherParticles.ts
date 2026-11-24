import * as THREE from 'three';

export type WeatherType = 'clear' | 'rain' | 'heatwave';

export interface WeatherSystem {
  root: THREE.Group;
  rainPoints: THREE.Points;
  rainMaterial: THREE.PointsMaterial;
  update: (weather: WeatherType, truckPos: THREE.Vector3, speedKmh: number, delta: number) => void;
  dispose: () => void;
}

export function buildWeatherSystem(): WeatherSystem {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();
  root.name = 'WeatherSystem';

  const rainCount = 1400;
  const rainPositions = new Float32Array(rainCount * 3);
  const rainVelocities = new Float32Array(rainCount);

  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 80;
    rainPositions[i * 3 + 1] = Math.random() * 30;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    rainVelocities[i] = 18 + Math.random() * 12;
  }

  const rainGeo = track(new THREE.BufferGeometry());
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

  const rainMaterial = track(
    new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.18,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    })
  );

  const rainPoints = new THREE.Points(rainGeo, rainMaterial);
  rainPoints.visible = false;
  root.add(rainPoints);

  return {
    root,
    rainPoints,
    rainMaterial,
    update: (weather: WeatherType, truckPos: THREE.Vector3, speedKmh: number, delta: number) => {
      const isRain = weather === 'rain';
      rainPoints.visible = isRain;

      if (!isRain) {
        rainMaterial.opacity = 0;
        return;
      }

      rainMaterial.opacity = 0.65;
      const positions = rainGeo.attributes.position.array as Float32Array;
      const forwardShift = (speedKmh / 3.6) * delta * 0.4;

      for (let i = 0; i < rainCount; i++) {
        // Fall down
        positions[i * 3 + 1] -= rainVelocities[i] * delta;
        // Slant backwards with truck velocity
        positions[i * 3] -= forwardShift;

        // Reset to top if hit ground
        if (positions[i * 3 + 1] < 0) {
          positions[i * 3] = truckPos.x + (Math.random() - 0.5) * 70;
          positions[i * 3 + 1] = 25 + Math.random() * 10;
          positions[i * 3 + 2] = truckPos.z + (Math.random() - 0.5) * 70;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
