import * as THREE from 'three';
import { INDUSTRY_PROFILES, IndustryId } from '../../types/cargoguard';

export function createRoadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base dark asphalt
  ctx.fillStyle = '#1d2430';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt aggregate grain
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const shade = 24 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 10})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Sidewalks / curb concrete edges (along V edges)
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 512, 34);
  ctx.fillRect(0, 478, 512, 34);

  // Crisp white edge lines
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 38, 512, 8);
  ctx.fillRect(0, 466, 512, 8);

  // Dashed yellow/amber centerline along U
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(32, 250, 188, 12);
  ctx.fillRect(292, 250, 188, 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(24, 1);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createLiveryTexture(
  maxAnisotropy: number,
  industry: IndustryId,
): THREE.CanvasTexture {
  const profile = INDUSTRY_PROFILES[industry];
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 1024, 384);

  // Panel seams
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 2;
  for (let x = 64; x < 1024; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 384);
    ctx.stroke();
  }

  ctx.fillStyle = profile.liveryColor;
  ctx.fillRect(0, 294, 1024, 52);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 284, 1024, 10);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(profile.label.toUpperCase(), 64, 128);

  ctx.fillStyle = '#475569';
  ctx.font = '600 24px monospace';
  ctx.fillText(
    `SAFE RANGE: ${profile.minSafeTemp.toFixed(1)}°C TO ${profile.maxSafeTemp.toFixed(1)}°C  ·  ${profile.cargoDescription.toUpperCase()}`,
    64,
    176,
  );

  // Geometric emblem
  ctx.strokeStyle = profile.liveryColor;
  ctx.lineWidth = 6;
  const cx = 920;
  const cy = 140;
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(angle) * 42, cy - Math.sin(angle) * 42);
    ctx.lineTo(cx + Math.cos(angle) * 42, cy + Math.sin(angle) * 42);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createCrateLabelTexture(
  maxAnisotropy: number,
  industry: IndustryId,
): THREE.CanvasTexture {
  const profile = INDUSTRY_PROFILES[industry];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = profile.liveryColor;
  ctx.fillRect(0, 0, 256, 34);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(profile.shortLabel.toUpperCase(), 12, 23);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 20px monospace';
  ctx.fillText(
    `${profile.minSafeTemp.toFixed(1)}°C .. ${profile.maxSafeTemp.toFixed(1)}°C`,
    12,
    72,
  );

  ctx.fillStyle = '#475569';
  ctx.font = '12px monospace';
  ctx.fillText('IOT MONITORED COLD CARGO', 12, 104);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createZoneSignTexture(
  maxAnisotropy: number,
  title: string,
  subtitle: string,
  accentHex: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 512, 128);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 512, 16);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(title, 22, 66);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px monospace';
  ctx.fillText(subtitle, 22, 102);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createDotStripingTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;

  for (let x = 0; x < 256; x += 64) {
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(x, 0, 32, 32);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x + 32, 0, 32, 32);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 126);
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.78)');
  grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.42)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
