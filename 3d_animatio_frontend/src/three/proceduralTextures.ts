import * as THREE from 'three';

export function createAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle mineral aggregate grain
  for (let i = 0; i < 6500; i++) {
    const x = (i * 73) % 512;
    const y = (i * 197 + Math.floor(i / 7) * 13) % 512;
    const v = 42 + (i % 28);
    ctx.fillStyle = `rgb(${v}, ${v + 8}, ${v + 18})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle highway concrete expansion joints
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(28, 12);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 64, 16, 128, 64, 118);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.58)');
  grad.addColorStop(0.65, 'rgba(15, 23, 42, 0.25)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createPharmaCrateTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 256, 22);
  ctx.fillRect(0, 234, 256, 22);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(18, 42, 220, 44);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(36, 52, 8, 24);
  ctx.fillRect(28, 60, 24, 8);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('PHARMA COLD', 66, 63);
  ctx.font = '12px monospace';
  ctx.fillText('BIOLOGICS · 2-8°C', 66, 79);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 102, 216, 112);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('LOT #HYD-8842', 32, 130);
  ctx.fillStyle = '#475569';
  ctx.font = '12px sans-serif';
  ctx.fillText('KEEP REFRIGERATED', 32, 152);
  ctx.fillText('DO NOT FREEZE', 32, 170);

  ctx.fillStyle = '#0f172a';
  for (let i = 0; i < 36; i++) {
    const w = i % 3 === 0 ? 3 : 1.5;
    ctx.fillRect(32 + i * 5, 184, w, 20);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createContainerWallTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 154, 512, 10);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 166, 512, 3);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('COLD CHAIN', 36, 118);
  ctx.fillStyle = '#0284c7';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('HYDERABAD PHARMA · REEFER UNIT', 38, 142);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createBuildingFacadeTexture(
  maxAnisotropy: number,
  variant: 'glass' | 'commercial' | 'hospital'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const bg =
    variant === 'glass'
      ? '#1e3a5f'
      : variant === 'hospital'
      ? '#f1f5f9'
      : '#cbd5e1';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 512);

  // Architectural floor bands
  const rows = 16;
  const cols = 6;
  const padX = 12;
  const padY = 12;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (512 - padY * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = (r * 7 + c * 11) % 5 !== 0;
      if (variant === 'glass') {
        ctx.fillStyle = lit ? '#7dd3fc' : '#0f2942';
      } else if (variant === 'hospital') {
        ctx.fillStyle = lit ? '#93c5fd' : '#475569';
      } else {
        ctx.fillStyle = lit ? '#bae6fd' : '#334155';
      }
      ctx.fillRect(
        padX + c * cellW + 4,
        padY + r * cellH + 5,
        cellW - 8,
        cellH - 10
      );
    }

    // Spandrel horizontal divider
    ctx.fillStyle = variant === 'glass' ? '#0f172a' : '#94a3b8';
    ctx.fillRect(0, padY + r * cellH, 256, 3);
  }

  if (variant === 'hospital') {
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(114, 18, 28, 8);
    ctx.fillRect(124, 8, 8, 28);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createHighwayGantryTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#065f46';
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 112);

  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('PVNR EXPY · HYDERABAD', 28, 42);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('HITEC CITY  |  JUBILEE HILLS  |  ORR', 28, 88);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createGatewayScreenTexture(): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  draw: (
    tempC: number,
    critical: boolean,
    doorTampered: boolean,
    callsign?: string
  ) => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const draw = (
    tempC: number,
    critical: boolean,
    doorTampered: boolean,
    callsign = 'GW-01'
  ) => {
    ctx.fillStyle = critical ? '#450a0a' : '#091526';
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = critical ? '#ef4444' : '#0ea5e9';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);

    ctx.fillStyle = critical ? '#fca5a5' : '#7dd3fc';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(callsign, 18, 28);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px monospace';
    ctx.fillText(`${tempC.toFixed(1)}°C`, 18, 76);

    ctx.fillStyle = doorTampered ? '#ef4444' : critical ? '#fbbf24' : '#34d399';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(
      doorTampered ? 'DOOR TAMPER!' : critical ? 'TEMP ALERT!' : 'LINK OK · SEALED',
      18,
      108
    );

    texture.needsUpdate = true;
  };

  draw(4.5, false, false);
  return { canvas, texture, draw };
}
