import * as THREE from 'three';

export interface TelemetryVisuals {
  root: THREE.Group;
  emitPacket: (isAlert: boolean) => void;
  update: (
    delta: number,
    elapsed: number,
    isAlert: boolean,
    onGatewayReceive?: (isAlert: boolean) => void,
  ) => void;
  dispose: () => void;
}

interface PacketSlot {
  active: boolean;
  progress: number;
  speed: number;
  isAlert: boolean;
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
}

interface UplinkRingSlot {
  active: boolean;
  progress: number;
  isAlert: boolean;
  ring: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export function buildTelemetryVisuals(): TelemetryVisuals {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();

  // Coordinates relative to truck root (Inside Node -> Outside Gateway)
  const nodeTip = new THREE.Vector3(0.76, 3.68, -0.86);
  const midControl1 = new THREE.Vector3(1.25, 4.08, -0.15);
  const midControl2 = new THREE.Vector3(1.85, 4.18, 0.72);
  const gatewayTip = new THREE.Vector3(2.14, 3.96, 1.38);

  const linkCurve = new THREE.CatmullRomCurve3([
    nodeTip,
    midControl1,
    midControl2,
    gatewayTip,
  ]);

  const linkPoints = linkCurve.getPoints(44);
  const linkGeo = track(new THREE.BufferGeometry().setFromPoints(linkPoints));
  const linkLineMat = track(
    new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.14,
      gapSize: 0.09,
      transparent: true,
      opacity: 0.72,
    }),
  );
  const linkLine = new THREE.Line(linkGeo, linkLineMat);
  linkLine.computeLineDistances();
  root.add(linkLine);

  // Door sensor -> Inside Node conduit pulse path
  const doorCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4.95, 3.68, 0.15),
    new THREE.Vector3(-4.85, 3.72, -0.92),
    new THREE.Vector3(0.55, 3.55, -0.92),
    new THREE.Vector3(0.65, 3.22, -0.92),
  ]);

  const orbGeo = track(new THREE.SphereGeometry(0.085, 14, 14));
  const haloGeo = track(new THREE.RingGeometry(0.11, 0.16, 20));
  const packetPool: PacketSlot[] = [];

  for (let i = 0; i < 8; i++) {
    const material = track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.95,
      }),
    );
    const haloMaterial = track(
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(orbGeo, material);
    const halo = new THREE.Mesh(haloGeo, haloMaterial);
    mesh.visible = false;
    halo.visible = false;
    root.add(mesh, halo);

    packetPool.push({
      active: false,
      progress: 0,
      speed: 1.45,
      isAlert: false,
      mesh,
      halo,
      material,
      haloMaterial,
    });
  }

  const wireOrbGeo = track(new THREE.SphereGeometry(0.055, 10, 10));
  const wirePool: PacketSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const material = track(
      new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.9 }),
    );
    const haloMaterial = track(
      new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0 }),
    );
    const mesh = new THREE.Mesh(wireOrbGeo, material);
    const halo = new THREE.Mesh(haloGeo, haloMaterial);
    mesh.visible = false;
    halo.visible = false;
    root.add(mesh);
    wirePool.push({
      active: false,
      progress: 0,
      speed: 1.9,
      isAlert: false,
      mesh,
      halo,
      material,
      haloMaterial,
    });
  }

  // Gateway -> Skyward GPS/Cloud Uplink Rings
  const ringGeo = track(new THREE.RingGeometry(0.16, 0.24, 28));
  const uplinkRings: UplinkRingSlot[] = [];
  for (let i = 0; i < 6; i++) {
    const material = track(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const ring = new THREE.Mesh(ringGeo, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(2.14, 4.18, 1.38);
    ring.visible = false;
    root.add(ring);

    uplinkRings.push({
      active: false,
      progress: 0,
      isAlert: false,
      ring,
      material,
    });
  }

  const beamGeo = track(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(2.14, 4.1, 1.38),
      new THREE.Vector3(2.14, 7.6, 1.38),
    ]),
  );
  const beamMat = track(
    new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.2,
      gapSize: 0.14,
      transparent: true,
      opacity: 0.55,
    }),
  );
  const beamLine = new THREE.Line(beamGeo, beamMat);
  beamLine.computeLineDistances();
  root.add(beamLine);

  const _pos = new THREE.Vector3();

  function triggerUplinkWave(isAlert: boolean): void {
    const slot = uplinkRings.find((r) => !r.active);
    if (!slot) return;
    slot.active = true;
    slot.progress = 0;
    slot.isAlert = isAlert;
    slot.ring.visible = true;
    slot.ring.position.set(2.14, 4.12, 1.38);
    slot.ring.scale.setScalar(1);
    slot.material.color.setHex(isAlert ? 0xef4444 : 0x10b981);
    slot.material.opacity = 0.92;
  }

  function emitPacket(isAlert: boolean): void {
    const slot = packetPool.find((p) => !p.active);
    if (slot) {
      slot.active = true;
      slot.progress = 0;
      slot.speed = isAlert ? 2.1 : 1.4;
      slot.isAlert = isAlert;
      slot.material.color.setHex(isAlert ? 0xef4444 : 0x22d3ee);
      slot.haloMaterial.color.setHex(isAlert ? 0xfca5a5 : 0x67e8f9);
      slot.mesh.visible = true;
      slot.halo.visible = true;
    }

    const wireSlot = wirePool.find((p) => !p.active);
    if (wireSlot) {
      wireSlot.active = true;
      wireSlot.progress = 0;
      wireSlot.speed = isAlert ? 2.6 : 1.8;
      wireSlot.isAlert = isAlert;
      wireSlot.material.color.setHex(isAlert ? 0xf59e0b : 0x10b981);
      wireSlot.mesh.visible = true;
    }
  }

  function update(
    delta: number,
    elapsed: number,
    isAlert: boolean,
    onGatewayReceive?: (pktAlert: boolean) => void,
  ): void {
    const targetHex = isAlert ? 0xef4444 : 0x38bdf8;
    linkLineMat.color.setHex(targetHex);
    linkLineMat.opacity = isAlert ? 0.85 + Math.sin(elapsed * 10) * 0.15 : 0.65;

    beamMat.color.setHex(isAlert ? 0xef4444 : 0x10b981);
    beamMat.opacity = isAlert ? 0.8 : 0.45;

    for (let i = 0; i < packetPool.length; i++) {
      const p = packetPool[i];
      if (!p.active) continue;
      p.progress += delta * p.speed;
      if (p.progress >= 1) {
        p.active = false;
        p.mesh.visible = false;
        p.halo.visible = false;
        triggerUplinkWave(p.isAlert);
        onGatewayReceive?.(p.isAlert);
        continue;
      }

      linkCurve.getPointAt(p.progress, _pos);
      p.mesh.position.copy(_pos);
      p.halo.position.copy(_pos);
      p.halo.rotation.y = elapsed * 4;
      p.halo.rotation.x = elapsed * 2.5;
      p.halo.scale.setScalar(1 + Math.sin(elapsed * 14) * 0.22);
    }

    for (let i = 0; i < wirePool.length; i++) {
      const w = wirePool[i];
      if (!w.active) continue;
      w.progress += delta * w.speed;
      if (w.progress >= 1) {
        w.active = false;
        w.mesh.visible = false;
        continue;
      }
      doorCurve.getPointAt(w.progress, _pos);
      w.mesh.position.copy(_pos);
    }

    for (let i = 0; i < uplinkRings.length; i++) {
      const u = uplinkRings[i];
      if (!u.active) continue;
      u.progress += delta * (u.isAlert ? 1.45 : 0.95);
      if (u.progress >= 1) {
        u.active = false;
        u.ring.visible = false;
        continue;
      }
      u.ring.position.y = 4.12 + u.progress * 3.2;
      u.ring.scale.setScalar(1 + u.progress * 5.0);
      u.material.opacity = (1 - u.progress) * 0.85;
    }
  }

  function dispose(): void {
    disposables.forEach((d) => d.dispose());
  }

  return { root, emitPacket, update, dispose };
}
