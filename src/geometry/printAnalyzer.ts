import * as THREE from 'three';
import { FLASHFORGE_AD5X_BED } from './types';

export interface OrientationMetric {
  label: string;
  rotationDeg: { x: number; y: number; z: number };
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  fitsAD5X: boolean;
  overhangAreaMm2: number;
  overhangPercent: number;
  bedContactAreaMm2: number;
  needsSupports: boolean;
}

export interface GeometryPrintMetrics {
  current: OrientationMetric;
  candidates: OrientationMetric[];
  bestLocalCandidate: OrientationMetric;
  triangleCount: number;
}

/**
 * Bir BufferGeometry'yi verilen (rx, ry, rz) derece açılarıyla döndürür
 * ve en alt noktasını tam Z = 0 baskı tablasına oturtur (XY merkezi korunur).
 */
export function rotateAndSeatGeometryOnBed(
  source: THREE.BufferGeometry,
  rxDeg: number,
  ryDeg: number,
  rzDeg: number
): THREE.BufferGeometry {
  const geo = source.clone();
  if (
    Math.abs(rxDeg) < 1e-4 &&
    Math.abs(ryDeg) < 1e-4 &&
    Math.abs(rzDeg) < 1e-4
  ) {
    return geo;
  }

  geo.computeBoundingBox();
  const bb = geo.boundingBox ?? new THREE.Box3();
  const center = bb.getCenter(new THREE.Vector3());

  // Merkez etrafında döndür
  geo.translate(-center.x, -center.y, -center.z);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rxDeg),
    THREE.MathUtils.degToRad(ryDeg),
    THREE.MathUtils.degToRad(rzDeg),
    'XYZ'
  );
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));

  // Tablaya oturt (XY merkezini geri getir, minZ = 0 yap)
  geo.computeBoundingBox();
  const newBB = geo.boundingBox ?? new THREE.Box3();
  const newCenter = newBB.getCenter(new THREE.Vector3());
  geo.translate(center.x - newCenter.x, center.y - newCenter.y, -newBB.min.z);

  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function evaluateOrientation(
  geometry: THREE.BufferGeometry,
  label: string,
  rotationDeg: { x: number; y: number; z: number }
): OrientationMetric {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const triCount = index
    ? Math.floor(index.count / 3)
    : Math.floor(posAttr.count / 3);

  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotationDeg.x),
    THREE.MathUtils.degToRad(rotationDeg.y),
    THREE.MathUtils.degToRad(rotationDeg.z),
    'XYZ'
  );
  const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  // 1. Geçiş: döndürülmüş sınır kutusu (minZ/maxZ)
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < posAttr.count; i++) {
    a.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(rotMat);
    if (a.x < minX) minX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.z < minZ) minZ = a.z;
    if (a.x > maxX) maxX = a.x;
    if (a.y > maxY) maxY = a.y;
    if (a.z > maxZ) maxZ = a.z;
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  // 2. Geçiş: Overhang (> 45° -> normal.z < -cos(45°) = -0.7071) & tabla temas alanı
  const OVERHANG_NZ_THRESHOLD = -Math.SQRT1_2; // -0.7071
  let totalArea = 0;
  let overhangArea = 0;
  let bedContactArea = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    a.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(rotMat);
    b.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(rotMat);
    c.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(rotMat);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    const area = cross.length() * 0.5;
    if (area < 1e-7) continue;

    totalArea += area;
    const nz = cross.z / (area * 2);
    const centroidZ = (a.z + b.z + c.z) / 3;

    if (centroidZ <= minZ + 0.35 && nz < -0.9) {
      bedContactArea += area;
    } else if (centroidZ > minZ + 0.4 && nz < OVERHANG_NZ_THRESHOLD) {
      overhangArea += area;
    }
  }

  const overhangPercent = totalArea > 0 ? (overhangArea / totalArea) * 100 : 0;
  const fitsAD5X =
    sizeX <= FLASHFORGE_AD5X_BED.x + 0.01 &&
    sizeY <= FLASHFORGE_AD5X_BED.y + 0.01 &&
    sizeZ <= FLASHFORGE_AD5X_BED.z + 0.01;

  return {
    label,
    rotationDeg,
    sizeX: Number(sizeX.toFixed(1)),
    sizeY: Number(sizeY.toFixed(1)),
    sizeZ: Number(sizeZ.toFixed(1)),
    fitsAD5X,
    overhangAreaMm2: Number(overhangArea.toFixed(1)),
    overhangPercent: Number(overhangPercent.toFixed(2)),
    bedContactAreaMm2: Number(bedContactArea.toFixed(1)),
    needsSupports: overhangArea > 12, // > 12 mm² ciddi çıkıntı varsa destek uyarısı
  };
}

/**
 * Aktif STL geometrisini mevcut ve 5 aday baskı yöneliminde analiz eder
 * (Overhang > 45°, tabla temas alanı ve AD5X 220x220x220 mm uyumu).
 */
export function analyzeGeometryForAD5X(
  baseGeometry: THREE.BufferGeometry,
  currentRotationDeg: { x: number; y: number; z: number }
): GeometryPrintMetrics {
  const posAttr = baseGeometry.getAttribute('position');
  const idx = baseGeometry.getIndex();
  const triangleCount = idx
    ? Math.floor(idx.count / 3)
    : posAttr
      ? Math.floor(posAttr.count / 3)
      : 0;

  const current = evaluateOrientation(
    baseGeometry,
    `Mevcut (${currentRotationDeg.x}°, ${currentRotationDeg.y}°, ${currentRotationDeg.z}°)`,
    currentRotationDeg
  );

  const candidateSpecs = [
    { label: 'Standart (0°, 0°, 0°)', rot: { x: 0, y: 0, z: 0 } },
    { label: 'X +90° Yatır', rot: { x: 90, y: 0, z: 0 } },
    { label: 'X -90° Yatır', rot: { x: -90, y: 0, z: 0 } },
    { label: 'Y +90° Yatır', rot: { x: 0, y: 90, z: 0 } },
    { label: 'Ters Çevir (X 180°)', rot: { x: 180, y: 0, z: 0 } },
  ];

  const candidates = candidateSpecs.map((s) =>
    evaluateOrientation(baseGeometry, s.label, s.rot)
  );

  // En iyi yerel aday: AD5X'e sığan, en az overhang alanına ve en geniş tabla temasına sahip olan
  const sorted = [...candidates].sort((u, v) => {
    if (u.fitsAD5X !== v.fitsAD5X) return u.fitsAD5X ? -1 : 1;
    const scoreU = u.overhangAreaMm2 * 4 - Math.min(u.bedContactAreaMm2, 1200) * 0.15;
    const scoreV = v.overhangAreaMm2 * 4 - Math.min(v.bedContactAreaMm2, 1200) * 0.15;
    return scoreU - scoreV;
  });

  return {
    current,
    candidates,
    bestLocalCandidate: sorted[0] ?? current,
    triangleCount,
  };
}
