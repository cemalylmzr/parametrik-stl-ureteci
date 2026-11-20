import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MeshBVH, HitPointInfo } from 'three-mesh-bvh';
import {
  AxisKey,
  AutoFixMode,
  CollisionReport,
  EMPTY_COLLISION_REPORT,
  LoadedSTLPart,
  PartRole,
  Vec3Tuple,
} from './types';
import {
  ManifoldMeshBuilder,
  createCircleRing,
  createRoundedRectRing,
  ensureCW,
} from '../geometry/manifoldBuilder';
import { generateFastenerOrGear } from '../geometry/fastenersAndGears';
import { DEFAULT_FASTENER_PARAMS } from '../geometry/types';

const COLOR_COLLISION = new THREE.Color('#ef4444'); // Kırmızı: çakışma / gömülme
const COLOR_TIGHT = new THREE.Color('#facc15');     // Sarı: dar tolerans bölgesi (0..tol)

// Eksenlere paralel kenar sıyırmalarını önlemek için irrasyonel ışın yönü
const INSIDE_TEST_RAY_DIR = new THREE.Vector3(0.57731, 0.61942, 0.53219).normalize();

const stlLoader = new STLLoader();

/**
 * Bir BufferGeometry'yi simülatör için hazırlar:
 * - Non-indexed yapar (yüzey bazlı keskin kırmızı/sarı renklendirme için)
 * - Normalleri ve Bounding Box'ı hesaplar
 * - Vertex color özniteliği ekler
 * - three-mesh-bvh ağacını (indirect: true) inşa eder
 */
export function prepareSimulatorGeometry(
  rawGeometry: THREE.BufferGeometry,
  baseColorHex: string
): {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  bboxSize: Vec3Tuple;
  triangleCount: number;
  originalPositions: Float32Array;
} {
  const geom = rawGeometry.index
    ? rawGeometry.toNonIndexed()
    : rawGeometry.clone();

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  const vertexCount = posAttr.count;
  const triangleCount = Math.floor(vertexCount / 3);
  const originalPositions = new Float32Array(posAttr.array as Float32Array);

  // Vertex color buffer ekle
  const baseColor = new THREE.Color(baseColorHex);
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = baseColor.r;
    colors[i * 3 + 1] = baseColor.g;
    colors[i * 3 + 2] = baseColor.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const bb = geom.boundingBox ?? new THREE.Box3();
  const bboxSize: Vec3Tuple = {
    x: bb.max.x - bb.min.x,
    y: bb.max.y - bb.min.y,
    z: bb.max.z - bb.min.z,
  };

  // indirect: true -> position dizisinin sırasını bozmaz, üçgen indeksleri 1:1 kalır
  const bvh = new MeshBVH(geom, { indirect: true });
  geom.boundsTree = bvh;

  return {
    geometry: geom,
    bvh,
    bboxSize,
    triangleCount,
    originalPositions,
  };
}

/**
 * Yüklenen bir STL dosyasını (Binary veya ASCII) okur ve LoadedSTLPart nesnesine dönüştürür.
 * Parçayı varsayılan olarak XY merkezine ve Z = 0 tabanına oturtur (orijinal ofset korunabilir).
 */
export async function loadSTLFile(
  file: File,
  role: PartRole,
  centerOnBed = true
): Promise<LoadedSTLPart> {
  const buffer = await file.arrayBuffer();
  const parsed = stlLoader.parse(buffer);
  parsed.computeBoundingBox();

  let initialPos: Vec3Tuple = { x: 0, y: 0, z: 0 };
  if (centerOnBed && parsed.boundingBox) {
    const center = new THREE.Vector3();
    parsed.boundingBox.getCenter(center);
    const minZ = parsed.boundingBox.min.z;
    parsed.translate(-center.x, -center.y, -minZ);
    initialPos = { x: 0, y: 0, z: 0 };
  }

  const baseColor = role === 'static' ? '#38bdf8' : '#10b981';
  const prepared = prepareSimulatorGeometry(parsed, baseColor);
  parsed.dispose();

  return {
    id: `part_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    role,
    visible: true,
    opacity: role === 'static' ? 0.72 : 0.96,
    baseColor,
    geometry: prepared.geometry,
    bvh: prepared.bvh,
    originalPositions: prepared.originalPositions,
    position: initialPos,
    rotationDeg: { x: 0, y: 0, z: 0 },
    bboxSize: prepared.bboxSize,
    triangleCount: prepared.triangleCount,
  };
}

/**
 * Mevcut bir BufferGeometry'den doğrudan simülatör parçası oluşturur (örnek çiftler veya
 * aktif CAD tasarımını simülatöre aktarmak için).
 */
export function createPartFromGeometry(
  name: string,
  rawGeometry: THREE.BufferGeometry,
  role: PartRole,
  position: Vec3Tuple = { x: 0, y: 0, z: 0 },
  rotationDeg: Vec3Tuple = { x: 0, y: 0, z: 0 }
): LoadedSTLPart {
  const baseColor = role === 'static' ? '#38bdf8' : '#10b981';
  const prepared = prepareSimulatorGeometry(rawGeometry, baseColor);
  return {
    id: `part_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    role,
    visible: true,
    opacity: role === 'static' ? 0.72 : 0.96,
    baseColor,
    geometry: prepared.geometry,
    bvh: prepared.bvh,
    originalPositions: prepared.originalPositions,
    position: { ...position },
    rotationDeg: { ...rotationDeg },
    bboxSize: prepared.bboxSize,
    triangleCount: prepared.triangleCount,
  };
}

export function buildPartMatrix(part: Pick<LoadedSTLPart, 'position' | 'rotationDeg'>): THREE.Matrix4 {
  const pos = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(part.rotationDeg.x),
    THREE.MathUtils.degToRad(part.rotationDeg.y),
    THREE.MathUtils.degToRad(part.rotationDeg.z),
    'XYZ'
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(1, 1, 1);
  return new THREE.Matrix4().compose(pos, quat, scale);
}

/**
 * Bir parçanın vertex renklerini sıfırlar (tamamı baseColor).
 */
export function resetPartColors(part: LoadedSTLPart): void {
  const colorAttr = part.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) return;
  const base = new THREE.Color(part.baseColor);
  const arr = colorAttr.array as Float32Array;
  for (let i = 0; i < colorAttr.count; i++) {
    arr[i * 3] = base.r;
    arr[i * 3 + 1] = base.g;
    arr[i * 3 + 2] = base.b;
  }
  colorAttr.needsUpdate = true;
}

function applyTriangleColors(
  part: LoadedSTLPart,
  collidingTris: Set<number>,
  tightTris: Set<number>
): void {
  const colorAttr = part.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) return;
  const base = new THREE.Color(part.baseColor);
  const arr = colorAttr.array as Float32Array;
  const triCount = part.triangleCount;

  for (let t = 0; t < triCount; t++) {
    let c = base;
    if (collidingTris.has(t)) {
      c = COLOR_COLLISION;
    } else if (tightTris.has(t)) {
      c = COLOR_TIGHT;
    }
    const v0 = t * 9;
    arr[v0] = c.r;
    arr[v0 + 1] = c.g;
    arr[v0 + 2] = c.b;
    arr[v0 + 3] = c.r;
    arr[v0 + 4] = c.g;
    arr[v0 + 5] = c.b;
    arr[v0 + 6] = c.r;
    arr[v0 + 7] = c.g;
    arr[v0 + 8] = c.b;
  }
  colorAttr.needsUpdate = true;
}

/**
 * Bir noktanın kapalı manifold bir BVH mesh'inin İÇİNDE olup olmadığını test eder.
 * Irrasyonel ışın yönüyle çift taraflı raycast kesişim sayısı tek ise nokta içeridedir.
 */
function isPointInsideBVH(
  bvh: MeshBVH,
  pointLocal: THREE.Vector3,
  ray: THREE.Ray
): boolean {
  ray.origin.copy(pointLocal);
  ray.direction.copy(INSIDE_TEST_RAY_DIR);
  const hits = bvh.raycast(ray, THREE.DoubleSide);
  if (hits.length === 0) return false;

  // Çok yakın (aynı kenarda çift sayılan) kesişimleri ayıkla
  let uniqueHits = 1;
  hits.sort((a, b) => a.distance - b.distance);
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].distance - hits[i - 1].distance > 1e-4) {
      uniqueHits++;
    }
  }
  return uniqueHits % 2 === 1;
}

/**
 * two-mesh `three-mesh-bvh` Çakışma (Collision), Gömülme Derinliği ve Dar Tolerans Analizi.
 * - Kesişen üçgenleri KIRMIZI, 0..toleranceMm arası dar boşlukları SARI renklendirir.
 * - Maksimum gömülme derinliğini (mm) ve baskın çakışma eksenini hesaplar.
 */
export function analyzeCollisionAndClearance(
  staticPart: LoadedSTLPart,
  movingPart: LoadedSTLPart,
  toleranceMm: number
): CollisionReport {
  const t0 = performance.now();
  const tol = Math.max(0.02, toleranceMm);

  const matA = buildPartMatrix(staticPart);
  const matB = buildPartMatrix(movingPart);
  const invMatA = matA.clone().invert();
  const invMatB = matB.clone().invert();

  // B -> A ve A -> B dönüşüm matrisleri
  const matBtoA = new THREE.Matrix4().multiplyMatrices(invMatA, matB);
  const matAtoB = new THREE.Matrix4().multiplyMatrices(invMatB, matA);

  // Dünya AABB hızlı elemesi (tolerans payı dahil)
  const worldBoxA = (staticPart.geometry.boundingBox ?? new THREE.Box3())
    .clone()
    .applyMatrix4(matA);
  const worldBoxB = (movingPart.geometry.boundingBox ?? new THREE.Box3())
    .clone()
    .applyMatrix4(matB);

  const expandedBoxA = worldBoxA.clone().expandByScalar(tol + 0.05);

  const collidingA = new Set<number>();
  const collidingB = new Set<number>();
  const tightA = new Set<number>();
  const tightB = new Set<number>();

  if (!expandedBoxA.intersectsBox(worldBoxB)) {
    // AABB'ler tolerans dahil hiç yaklaşmıyor -> en yakın mesafeyi yine de ölç
    const hit1: HitPointInfo = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
    const hit2: HitPointInfo = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
    const closest = staticPart.bvh.closestPointToGeometry(
      movingPart.geometry,
      matBtoA,
      hit1,
      hit2,
      0,
      20
    );

    resetPartColors(staticPart);
    resetPartColors(movingPart);

    return {
      ...EMPTY_COLLISION_REPORT,
      minClearanceMm: closest ? closest.distance : null,
      computeTimeMs: performance.now() - t0,
    };
  }

  // 1. TAM ÜÇGEN-ÜÇGEN KESİŞİMİ (three-mesh-bvh bvhcast)
  const seg = new THREE.Line3();
  const bvhA = staticPart.bvh;
  const bvhB = movingPart.bvh;

  if (worldBoxA.intersectsBox(worldBoxB)) {
    bvhA.bvhcast(bvhB, matBtoA, {
      intersectsTriangles(triA, triB, iA, iB) {
        if (triA.intersectsTriangle(triB, seg)) {
          const idxA = bvhA.resolveTriangleIndex(iA);
          const idxB = bvhB.resolveTriangleIndex(iB);
          collidingA.add(idxA);
          collidingB.add(idxB);
        }
        return false; // Tüm kesişen üçgenleri topla
      },
    });
  }

  // 2. GÖMÜLME DERİNLİĞİ & DAR TOLERANS BÖLGESİ (0..tol) ANALİZİ
  let maxPenetrationMm = 0;
  let deepestPointWorld: Vec3Tuple | null = null;
  let minClearanceMm: number | null = null;
  const escapeAccumWorld = new THREE.Vector3(0, 0, 0);

  const ray = new THREE.Ray();
  const hitInfo: HitPointInfo = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1,
  };
  const tmpLocal = new THREE.Vector3();
  const tmpWorld = new THREE.Vector3();
  const tmpEscape = new THREE.Vector3();
  const tmpOtherLocal = new THREE.Vector3();
  const aLocalBoxExpanded = (staticPart.geometry.boundingBox ?? new THREE.Box3())
    .clone()
    .expandByScalar(tol + 0.05);
  const bLocalBoxExpanded = (movingPart.geometry.boundingBox ?? new THREE.Box3())
    .clone()
    .expandByScalar(tol + 0.05);

  const normalMatA = new THREE.Matrix3().setFromMatrix4(matA);
  const normalMatB = new THREE.Matrix3().setFromMatrix4(matB);

  const inspectPartVerticesAgainstOther = (
    srcPart: LoadedSTLPart,
    srcToOtherMat: THREE.Matrix4,
    srcToWorldMat: THREE.Matrix4,
    otherBvh: MeshBVH,
    otherBoxExpanded: THREE.Box3,
    otherToWorldRot: THREE.Matrix3,
    srcColliding: Set<number>,
    srcTight: Set<number>,
    isSrcMoving: boolean
  ) => {
    const posAttr = srcPart.geometry.getAttribute('position') as THREE.BufferAttribute;
    const triCount = srcPart.triangleCount;

    // Aday benzersiz köşe + üçgen merkezlerini tekilleştir (hız için 0.01 mm ızgara anahtarı)
    const testedVerts = new Map<
      string,
      { inside: boolean; dist: number; escapeWorld: THREE.Vector3 | null }
    >();
    const MAX_QUERIES = 3500;
    let queryCount = 0;

    const testPoint = (px: number, py: number, pz: number, triIdx: number) => {
      tmpLocal.set(px, py, pz);
      tmpOtherLocal.copy(tmpLocal).applyMatrix4(srcToOtherMat);

      if (!otherBoxExpanded.containsPoint(tmpOtherLocal)) return;

      const key = `${Math.round(tmpOtherLocal.x * 100)},${Math.round(tmpOtherLocal.y * 100)},${Math.round(tmpOtherLocal.z * 100)}`;
      let cached = testedVerts.get(key);

      if (!cached) {
        if (queryCount >= MAX_QUERIES) return;
        queryCount++;

        // Önce tolerans içinde mi kontrol et (çok hızlı)
        const nearHit = otherBvh.closestPointToPoint(
          tmpOtherLocal,
          hitInfo,
          0,
          tol + 0.001
        );

        // İçeride olma testi: ya yakın temas varsa ya da üçgen zaten kesişiyorsa veya AABB içindeyse
        let inside = false;
        let dist = nearHit ? nearHit.distance : Infinity;
        let escapeW: THREE.Vector3 | null = null;

        const strictBox = isSrcMoving
          ? staticPart.geometry.boundingBox
          : movingPart.geometry.boundingBox;

        if (strictBox && strictBox.containsPoint(tmpOtherLocal)) {
          inside = isPointInsideBVH(otherBvh, tmpOtherLocal, ray);
          if (inside) {
            const fullHit = otherBvh.closestPointToPoint(tmpOtherLocal, hitInfo);
            if (fullHit) {
              dist = fullHit.distance;
              // Kaçış vektörü: içerideki noktadan en yakın yüzeye doğru (Moving için dışarı)
              tmpEscape.subVectors(fullHit.point, tmpOtherLocal);
              if (!isSrcMoving) tmpEscape.negate();
              tmpEscape.applyMatrix3(otherToWorldRot);
              escapeW = tmpEscape.clone();
            }
          }
        }

        cached = { inside, dist, escapeWorld: escapeW };
        testedVerts.set(key, cached);
      }

      if (cached.inside && cached.dist > 1e-4) {
        srcColliding.add(triIdx);
        if (cached.dist > maxPenetrationMm) {
          maxPenetrationMm = cached.dist;
          tmpWorld.set(px, py, pz).applyMatrix4(srcToWorldMat);
          deepestPointWorld = {
            x: tmpWorld.x,
            y: tmpWorld.y,
            z: tmpWorld.z,
          };
        }
        if (cached.escapeWorld) {
          escapeAccumWorld.add(cached.escapeWorld);
        }
      } else if (!cached.inside && cached.dist <= tol) {
        if (cached.dist > 1e-4) {
          srcTight.add(triIdx);
          if (minClearanceMm === null || cached.dist < minClearanceMm) {
            minClearanceMm = cached.dist;
          }
        } else {
          // 0.000 mm tam yapışık temas (FDM yazıcıda birbirine kaynar)
          srcTight.add(triIdx);
          if (minClearanceMm === null || 0 < minClearanceMm) {
            minClearanceMm = 0;
          }
        }
      }
    };

    for (let t = 0; t < triCount; t++) {
      const i0 = t * 3;
      const ax = posAttr.getX(i0);
      const ay = posAttr.getY(i0);
      const az = posAttr.getZ(i0);
      const bx = posAttr.getX(i0 + 1);
      const by = posAttr.getY(i0 + 1);
      const bz = posAttr.getZ(i0 + 1);
      const cx = posAttr.getX(i0 + 2);
      const cy = posAttr.getY(i0 + 2);
      const cz = posAttr.getZ(i0 + 2);

      // 3 köşe + ağırlık merkezi
      testPoint(ax, ay, az, t);
      testPoint(bx, by, bz, t);
      testPoint(cx, cy, cz, t);
      testPoint((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, t);
    }
  };

  // Hareketli parçanın köşelerini sabit gövdeye karşı kontrol et
  inspectPartVerticesAgainstOther(
    movingPart,
    matBtoA,
    matB,
    bvhA,
    aLocalBoxExpanded,
    normalMatA,
    collidingB,
    tightB,
    true
  );

  // Sabit parçanın köşelerini hareketli parçaya karşı kontrol et
  inspectPartVerticesAgainstOther(
    staticPart,
    matAtoB,
    matA,
    bvhB,
    bLocalBoxExpanded,
    normalMatB,
    collidingA,
    tightA,
    false
  );

  const hasCollision = collidingA.size > 0 || collidingB.size > 0 || maxPenetrationMm > 1e-4;

  // Eğer üçgenler kesişiyor ama hiçbir köşe tam içeride değilse (kenar-kenar çapraz kesişim)
  // kesişen üçgenlerin örtüşme kutusundan güvenli gömülme tahmini üret
  if (hasCollision && maxPenetrationMm < 1e-4) {
    const overlap = worldBoxA.clone().intersect(worldBoxB);
    if (!overlap.isEmpty()) {
      const ox = overlap.max.x - overlap.min.x;
      const oy = overlap.max.y - overlap.min.y;
      const oz = overlap.max.z - overlap.min.z;
      const minOverlap = Math.min(ox, oy, oz);
      maxPenetrationMm = Math.max(0.01, minOverlap);
      const oc = new THREE.Vector3();
      overlap.getCenter(oc);
      deepestPointWorld = { x: oc.x, y: oc.y, z: oc.z };
    }
  }

  // Çakışma yoksa ve dar bölgede ölçüm yakalanmadıysa yakın mesafeyi BVH ile bul
  if (!hasCollision && minClearanceMm === null) {
    const h1: HitPointInfo = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
    const h2: HitPointInfo = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
    const res = bvhA.closestPointToGeometry(movingPart.geometry, matBtoA, h1, h2, 0, 15);
    if (res) {
      minClearanceMm = res.distance;
    }
  }

  // Baskın çakışma eksenini ve kaçış yönünü belirle
  let dominantAxis: AxisKey = 'y';
  let escapeSign: 1 | -1 = 1;

  if (escapeAccumWorld.lengthSq() > 1e-8) {
    const ax = Math.abs(escapeAccumWorld.x);
    const ay = Math.abs(escapeAccumWorld.y);
    const az = Math.abs(escapeAccumWorld.z);
    if (ax >= ay && ax >= az) {
      dominantAxis = 'x';
      escapeSign = escapeAccumWorld.x >= 0 ? 1 : -1;
    } else if (ay >= ax && ay >= az) {
      dominantAxis = 'y';
      escapeSign = escapeAccumWorld.y >= 0 ? 1 : -1;
    } else {
      dominantAxis = 'z';
      escapeSign = escapeAccumWorld.z >= 0 ? 1 : -1;
    }
  } else {
    const overlap = worldBoxA.clone().intersect(worldBoxB);
    if (!overlap.isEmpty()) {
      const ox = overlap.max.x - overlap.min.x;
      const oy = overlap.max.y - overlap.min.y;
      const oz = overlap.max.z - overlap.min.z;
      const cA = worldBoxA.getCenter(new THREE.Vector3());
      const cB = worldBoxB.getCenter(new THREE.Vector3());
      if (ox <= oy && ox <= oz) {
        dominantAxis = 'x';
        escapeSign = cB.x >= cA.x ? 1 : -1;
      } else if (oy <= ox && oy <= oz) {
        dominantAxis = 'y';
        escapeSign = cB.y >= cA.y ? 1 : -1;
      } else {
        dominantAxis = 'z';
        escapeSign = cB.z >= cA.z ? 1 : -1;
      }
    }
  }

  // 3. RENKLENDİRMEYİ UYGULA (Kırmızı: çakışma, Sarı: dar tolerans)
  applyTriangleColors(staticPart, collidingA, tightA);
  applyTriangleColors(movingPart, collidingB, tightB);

  return {
    hasCollision,
    hasTightClearance: tightA.size > 0 || tightB.size > 0,
    collidingTriangleCountA: collidingA.size,
    collidingTriangleCountB: collidingB.size,
    tightTriangleCountA: tightA.size,
    tightTriangleCountB: tightB.size,
    maxPenetrationMm,
    minClearanceMm: hasCollision ? 0 : minClearanceMm,
    dominantAxis,
    escapeSign,
    deepestPointWorld,
    computeTimeMs: performance.now() - t0,
  };
}

/**
 * Sahnedeki tüm görünür sabit parçalara karşı aktif hareketli parçayı analiz eder.
 * Birden fazla sabit gövde/ray yüklendiğinde tüm çakışmaları ve dar boşlukları birleştirir.
 */
export function analyzeSceneCollisions(
  parts: LoadedSTLPart[],
  toleranceMm: number
): CollisionReport {
  const visibleStatics = parts.filter((p) => p.visible && p.role === 'static');
  const movingPart = parts.find((p) => p.visible && p.role === 'moving');

  if (!movingPart || visibleStatics.length === 0) {
    for (const p of parts) resetPartColors(p);
    return { ...EMPTY_COLLISION_REPORT };
  }

  if (visibleStatics.length === 1) {
    return analyzeCollisionAndClearance(visibleStatics[0], movingPart, toleranceMm);
  }

  // Çoklu sabit parça desteği: en kritik sonucu birleştir
  let bestReport: CollisionReport = { ...EMPTY_COLLISION_REPORT };
  let totalCompute = 0;

  for (const sp of visibleStatics) {
    const r = analyzeCollisionAndClearance(sp, movingPart, toleranceMm);
    totalCompute += r.computeTimeMs;
    if (r.hasCollision) {
      if (!bestReport.hasCollision || r.maxPenetrationMm > bestReport.maxPenetrationMm) {
        bestReport = { ...r };
      } else {
        bestReport.collidingTriangleCountA += r.collidingTriangleCountA;
      }
    } else if (!bestReport.hasCollision) {
      if (
        r.minClearanceMm !== null &&
        (bestReport.minClearanceMm === null || r.minClearanceMm < bestReport.minClearanceMm)
      ) {
        bestReport = { ...r };
      }
    }
  }

  bestReport.computeTimeMs = totalCompute;
  return bestReport;
}

/**
 * Otomatik Düzeltme (Auto-Fix):
 * - 'shrink': Hareketli parçayı seçilen eksende kendi merkezine doğru toplam `2 * (penetration + clearanceMargin)`
 *   kadar ölçekleyerek (watertight afin dönüşüm) her iki kenardan boşluk payı açar ve BVH'yi yeniden inşa eder.
 * - 'offset': Hareketli parçayı kaçış yönünde `penetration + clearanceMargin` kadar kaydırır.
 */
export function applyAutoFixToPart(
  part: LoadedSTLPart,
  axis: AxisKey,
  mode: AutoFixMode,
  penetrationMm: number,
  clearanceMarginMm: number,
  escapeSign: 1 | -1
): LoadedSTLPart {
  const delta = Math.max(0.05, penetrationMm + clearanceMarginMm);

  if (mode === 'offset') {
    const nextPos: Vec3Tuple = { ...part.position };
    nextPos[axis] = Number((nextPos[axis] + escapeSign * delta).toFixed(3));
    return {
      ...part,
      position: nextPos,
      appliedFixNote: `${axis.toUpperCase()} ekseninde ${escapeSign > 0 ? '+' : '-'}${delta.toFixed(2)} mm kaydırıldı`,
    };
  }

  // 'shrink': Seçilen yerel eksende her iki kenardan `delta` kadar (toplam 2*delta) daralt
  const geom = part.geometry.clone();
  geom.computeBoundingBox();
  const bb = geom.boundingBox ?? new THREE.Box3();
  const center = bb.getCenter(new THREE.Vector3());
  const currentSpan = bb.max[axis] - bb.min[axis];

  // Çift taraflı geçme boşluğu: mevcut genişlikten 2*delta düş (parçanın %35'inden fazla küçültme)
  const targetSpan = Math.max(currentSpan * 0.35, currentSpan - 2 * delta);
  const scaleFactor = currentSpan > 1e-4 ? targetSpan / currentSpan : 1;

  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const cVal = center[axis];

  for (let i = 0; i < posAttr.count; i++) {
    const idx = i * 3 + axisIdx;
    arr[idx] = cVal + (arr[idx] - cVal) * scaleFactor;
  }
  posAttr.needsUpdate = true;

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const newBvh = new MeshBVH(geom, { indirect: true });
  geom.boundsTree = newBvh;

  const newBB = geom.boundingBox ?? new THREE.Box3();
  const newSize: Vec3Tuple = {
    x: newBB.max.x - newBB.min.x,
    y: newBB.max.y - newBB.min.y,
    z: newBB.max.z - newBB.min.z,
  };

  return {
    ...part,
    geometry: geom,
    bvh: newBvh,
    bboxSize: newSize,
    appliedFixNote: `${axis.toUpperCase()} ekseninde -${(currentSpan - targetSpan).toFixed(2)} mm daraltıldı (+${clearanceMarginMm.toFixed(2)} mm boşluk)`,
  };
}

/**
 * Parçayı orijinal yüklenen geometrisine geri döndürür.
 */
export function restoreOriginalPartGeometry(part: LoadedSTLPart): LoadedSTLPart {
  const geom = part.geometry.clone();
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  (posAttr.array as Float32Array).set(part.originalPositions);
  posAttr.needsUpdate = true;

  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const newBvh = new MeshBVH(geom, { indirect: true });
  geom.boundsTree = newBvh;

  const bb = geom.boundingBox ?? new THREE.Box3();
  return {
    ...part,
    geometry: geom,
    bvh: newBvh,
    bboxSize: {
      x: bb.max.x - bb.min.x,
      y: bb.max.y - bb.min.y,
      z: bb.max.z - bb.min.z,
    },
    appliedFixNote: undefined,
  };
}

/**
 * Düzeltilmiş parçayı baskıya hazır (Z=0 tabanına oturan veya dünya dönüşümlü)
 * temiz bir BufferGeometry olarak dışa aktarıma hazırlar.
 */
export function buildExportableGeometry(
  part: LoadedSTLPart,
  bakeWorldTransform = false
): THREE.BufferGeometry {
  const out = part.geometry.clone();
  if (bakeWorldTransform) {
    out.applyMatrix4(buildPartMatrix(part));
  }
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}

// ============================================================================
// ÖRNEK TEST ÇİFTLERİ (Kullanıcı kendi STL'ini yüklemeden hemen deneyebilsin)
// ============================================================================

/**
 * Örnek 1: U-Kanallı Ray (Sabit) + Ortada Daralan Engel + Kızak (Hareketli)
 * Kızak X = -32 -> +32 mm kayarken ortadaki daralmada çakışır!
 */
export function createDemoRailSliderPair(): {
  staticPart: LoadedSTLPart;
  movingPart: LoadedSTLPart;
  startPos: Vec3Tuple;
  endPos: Vec3Tuple;
} {
  // 1. Sabit U-Ray (96 x 34 x 16 mm), iç kanal Y genişliği = 20 mm,
  // ancak sağ tarafta (x: +6..+24 mm) kanal içine 0.8 mm çıkıntı (test engeli) var!
  const railBuilder = new ManifoldMeshBuilder();
  const outer = createRoundedRectRing(0, 0, 96, 34, 2, 4, true);
  // Taban 0..4 mm
  railBuilder.addExtrudedRegion(outer, [], 0, 4);

  // Sol yan duvar (y: +10..+17, x: -48..+48, z: 4..16)
  const wallPosY = createRoundedRectRing(0, 13.5, 96, 7, 1, 2, true);
  railBuilder.addExtrudedRegion(wallPosY, [], 4, 16);

  // Sağ yan duvar (y: -17..-10, x: -48..+48, z: 4..16)
  const wallNegY = createRoundedRectRing(0, -13.5, 96, 7, 1, 2, true);
  railBuilder.addExtrudedRegion(wallNegY, [], 4, 16);

  // Sağ duvarda küçük daralma çıkıntısı (x: +8..+24, y: -10..-9.2 -> 0.8mm daralma!)
  const pinch = createRoundedRectRing(16, -9.6, 16, 0.8, 0, 1, true);
  railBuilder.addExtrudedRegion(pinch, [], 4.2, 15.5);

  const railGeom = railBuilder.toBufferGeometry();

  // 2. Hareketli Kızak (24 x 19.6 x 14 mm -> 20mm kanalda 0.2mm boşlukla kayar,
  // ancak 0.8mm daralma çıkıntısında ~0.6mm çakışır!)
  const sliderBuilder = new ManifoldMeshBuilder();
  const sliderOuter = createRoundedRectRing(0, 0, 24, 19.6, 1.5, 4, true);
  const centerHole = createCircleRing(0, 0, 3.2, 24, false);
  sliderBuilder.addExtrudedRegion(sliderOuter, [centerHole], 0, 14);
  const sliderGeom = sliderBuilder.toBufferGeometry();

  const staticPart = createPartFromGeometry(
    'ornek_ray_govde.stl',
    railGeom,
    'static',
    { x: 0, y: 0, z: 0 }
  );
  const movingPart = createPartFromGeometry(
    'ornek_hareketli_kizak.stl',
    sliderGeom,
    'moving',
    { x: -30, y: 0, z: 4.25 }
  );

  railGeom.dispose();
  sliderGeom.dispose();

  return {
    staticPart,
    movingPart,
    startPos: { x: -30, y: 0, z: 4.25 },
    endPos: { x: 30, y: 0, z: 4.25 },
  };
}

/**
 * Örnek 2: Kutu + Geçmeli Kapak (Z ekseninde dikey kapanma ve 0.15 mm sıkı geçme testi)
 */
export function createDemoBoxLidPair(): {
  staticPart: LoadedSTLPart;
  movingPart: LoadedSTLPart;
  startPos: Vec3Tuple;
  endPos: Vec3Tuple;
} {
  // Kutu (60 x 46 x 24 mm, duvar 2.4 mm -> iç boşluk 55.2 x 41.2 mm)
  const boxB = new ManifoldMeshBuilder();
  const oBox = createRoundedRectRing(0, 0, 60, 46, 4, 8, true);
  const iBox = createRoundedRectRing(0, 0, 55.2, 41.2, 1.6, 8, true);
  boxB.addPlanarFace(oBox, [], 0, false);
  boxB.addWallStrip(oBox, 0, 24);
  boxB.addPlanarFace(oBox, [ensureCW(iBox)], 24, true);
  boxB.addWallStrip(ensureCW(iBox), 2.4, 24);
  boxB.addPlanarFace(iBox, [], 2.4, true);
  const boxGeom = boxB.toBufferGeometry();

  // Kapak (dudak 55.6 x 41.6 mm -> 0.2mm/kenar sıkı geçme çakışması!)
  const lidB = new ManifoldMeshBuilder();
  const oLid = createRoundedRectRing(0, 0, 60, 46, 4, 8, true);
  const lipOut = createRoundedRectRing(0, 0, 55.6, 41.6, 1.6, 8, true);
  const lipIn = createRoundedRectRing(0, 0, 51.6, 37.6, 1.0, 8, true);
  // Dudak aşağıya bakacak şekilde (z: 0..4 dudak, z: 4..6.4 kapak üstü)
  lidB.addPlanarFace(lipOut, [ensureCW(lipIn)], 0, false);
  lidB.addWallStrip(lipOut, 0, 4);
  lidB.addWallStrip(ensureCW(lipIn), 0, 4);
  lidB.addPlanarFace(lipIn, [], 4, false);
  lidB.addPlanarFace(oLid, [ensureCW(lipOut)], 4, false);
  lidB.addWallStrip(oLid, 4, 6.4);
  lidB.addPlanarFace(oLid, [], 6.4, true);
  const lidGeom = lidB.toBufferGeometry();

  const staticPart = createPartFromGeometry(
    'ornek_kutu_govde.stl',
    boxGeom,
    'static',
    { x: 0, y: 0, z: 0 }
  );
  const movingPart = createPartFromGeometry(
    'ornek_siki_kapak.stl',
    lidGeom,
    'moving',
    { x: 0, y: 0, z: 32 }
  );

  boxGeom.dispose();
  lidGeom.dispose();

  return {
    staticPart,
    movingPart,
    startPos: { x: 0, y: 0, z: 32 },
    endPos: { x: 0, y: 0, z: 20.1 },
  };
}

/**
 * Örnek 3: İki Evolvent Dişli Çark (Dönme ve diş geçme boşluğu testi)
 */
export function createDemoGearPair(): {
  staticPart: LoadedSTLPart;
  movingPart: LoadedSTLPart;
  startPos: Vec3Tuple;
  endPos: Vec3Tuple;
} {
  const g1 = generateFastenerOrGear({
    ...DEFAULT_FASTENER_PARAMS,
    mode: 'gear',
    gearModule: 2.0,
    gearTeeth: 18,
    gearThickness: 8,
    gearBacklash: 0.15,
    gearBoreDiameter: 6,
    gearHubEnabled: false,
  });
  const g2 = generateFastenerOrGear({
    ...DEFAULT_FASTENER_PARAMS,
    mode: 'gear',
    gearModule: 2.0,
    gearTeeth: 14,
    gearThickness: 8,
    gearBacklash: 0.15,
    gearBoreDiameter: 6,
    gearHubEnabled: false,
  });

  // Teorik merkez mesafesi = m * (z1 + z2) / 2 = 2 * (18 + 14) / 2 = 32.0 mm
  const staticPart = createPartFromGeometry(
    'ornek_disli_18T.stl',
    g1.geometry,
    'static',
    { x: -16, y: 0, z: 0 }
  );
  const movingPart = createPartFromGeometry(
    'ornek_disli_14T.stl',
    g2.geometry,
    'moving',
    { x: 16.0, y: 0, z: 0 },
    { x: 0, y: 0, z: 12.85 }
  );

  g1.geometry.dispose();
  g2.geometry.dispose();

  return {
    staticPart,
    movingPart,
    startPos: { x: 16.0, y: 0, z: 0 },
    endPos: { x: 16.0, y: 0, z: 0 },
  };
}
