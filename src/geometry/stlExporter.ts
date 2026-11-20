import * as THREE from 'three';
import { ENDER3_V2_BED, MATERIALS, MaterialType, MeshStats } from './types';
import { validateManifold } from './manifoldBuilder';

/**
 * Three.js BufferGeometry'den IEEE-754 Little-Endian Binary STL DataView üretir.
 * Format:
 *  - 80 byte ASCII başlık
 *  - 4 byte uint32 üçgen sayısı
 *  - Her üçgen için 50 byte:
 *      - 12 byte normal (nx, ny, nz float32)
 *      - 36 byte 3 köşe (v1, v2, v3 float32)
 *      - 2 byte attribute byte count (0)
 */
export function geometryToBinarySTL(
  geometry: THREE.BufferGeometry,
  headerLabel = 'Parametric 3D STL Generator - Watertight Binary STL (mm, Z-up)'
): ArrayBuffer {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('Geometri position özniteliği içermiyor.');
  }

  const index = geometry.getIndex();
  const triCount = index
    ? Math.floor(index.count / 3)
    : Math.floor(posAttr.count / 3);

  const bufferLength = 84 + triCount * 50;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // 80-byte başlık yaz (Binary STL'in "solid " ile başlamaması en güvenli pratiktir)
  const safeHeader = headerLabel.startsWith('solid ')
    ? `BIN_${headerLabel}`
    : headerLabel;
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < safeHeader.length ? safeHeader.charCodeAt(i) & 0x7f : 32);
  }

  // Üçgen sayısı (Little-Endian)
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    const ax = posAttr.getX(i0);
    const ay = posAttr.getY(i0);
    const az = posAttr.getZ(i0);

    const bx = posAttr.getX(i1);
    const by = posAttr.getY(i1);
    const bz = posAttr.getZ(i1);

    const cx = posAttr.getX(i2);
    const cy = posAttr.getY(i2);
    const cz = posAttr.getZ(i2);

    // Gerçek yüzey normali: normalize((B - A) x (C - A))
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }

    // Normal
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    // Vertex 1
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);

    // Vertex 2
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);

    // Vertex 3
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);

    // Attribute byte count
    view.setUint16(offset + 48, 0, true);

    offset += 50;
  }

  return arrayBuffer;
}

/**
 * BufferGeometry'yi Binary STL dosyası olarak tarayıcıdan indirir.
 */
export function downloadBinarySTL(
  geometry: THREE.BufferGeometry,
  filename: string
): { byteLength: number; triangleCount: number } {
  const safeName = filename.toLowerCase().endsWith('.stl')
    ? filename
    : `${filename}.stl`;

  const buffer = geometryToBinarySTL(geometry);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    byteLength: buffer.byteLength,
    triangleCount: (buffer.byteLength - 84) / 50,
  };
}

/**
 * Mesh boyutları, manifold doğrulaması ve tahmini filament/hacim istatistiklerini hesaplar.
 */
export function computeMeshStats(
  geometry: THREE.BufferGeometry,
  material: MaterialType,
  infillPercent: number,
  extraWarnings: string[] = []
): MeshStats {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const sizeX = bb ? bb.max.x - bb.min.x : 0;
  const sizeY = bb ? bb.max.y - bb.min.y : 0;
  const sizeZ = bb ? bb.max.z - bb.min.z : 0;

  const manifold = validateManifold(geometry);
  const volumeCm3 = manifold.volumeMm3 / 1000;

  // FDM doluluk tahmini: ince duvarlı parçalarda kabuk hacmi baskındır.
  // Kabuk (perimeters + top/bottom) ortalama %60-100 arası, kalan hacim infillPercent ile doldurulur.
  const infillFactor = Math.max(0.1, Math.min(1.0, infillPercent / 100));
  const shellThicknessMm = 1.6; // ~4 duvar / 0.4mm nozzle
  const estimatedShellMm3 = Math.min(
    manifold.volumeMm3,
    manifold.surfaceAreaMm2 * (shellThicknessMm * 0.5)
  );
  const interiorMm3 = Math.max(0, manifold.volumeMm3 - estimatedShellMm3);
  const effectivePrintedMm3 = estimatedShellMm3 + interiorMm3 * infillFactor;
  const effectivePrintedCm3 = effectivePrintedMm3 / 1000;

  const density = MATERIALS[material].densityGPerCm3;
  const estimatedWeightG = effectivePrintedCm3 * density;

  // 1.75 mm filament kesit alanı = pi * (0.875)^2 ≈ 2.40528 mm²
  const filamentCrossSectionMm2 = Math.PI * 0.875 * 0.875;
  const estimatedFilamentM = effectivePrintedMm3 / filamentCrossSectionMm2 / 1000;

  const fitsEnder3V2 =
    sizeX <= ENDER3_V2_BED.x + 0.01 &&
    sizeY <= ENDER3_V2_BED.y + 0.01 &&
    sizeZ <= ENDER3_V2_BED.z + 0.01;

  const warnings = [...extraWarnings];
  if (!fitsEnder3V2) {
    warnings.push(
      `Parça Ender 3 V2 baskı alanını (${ENDER3_V2_BED.x}×${ENDER3_V2_BED.y}×${ENDER3_V2_BED.z} mm) aşıyor!`
    );
  }
  if (!manifold.isWatertight) {
    warnings.push(
      `Mesh manifold uyarısı: ${manifold.openEdges} açık kenar, ${manifold.nonManifoldEdges} non-manifold kenar.`
    );
  }

  return {
    sizeX,
    sizeY,
    sizeZ,
    triangleCount: manifold.triangleCount,
    vertexCount: manifold.vertexCount,
    volumeMm3: manifold.volumeMm3,
    volumeCm3,
    surfaceAreaMm2: manifold.surfaceAreaMm2,
    estimatedWeightG,
    estimatedFilamentM,
    isWatertight: manifold.isWatertight,
    openEdges: manifold.openEdges,
    nonManifoldEdges: manifold.nonManifoldEdges,
    fitsEnder3V2,
    warnings,
  };
}
