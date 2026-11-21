import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import {
  BoxCutoutHole,
  CutoutGhostMesh,
  ParametricBoxParams,
} from './types';
import {
  ManifoldMeshBuilder,
  Point2D,
  createCircleRing,
  createRegularPolygonRing,
  createRoundedRectRing,
  ensureCCW,
} from './manifoldBuilder';

/**
 * Stadium / Oval Slot 2D konturu üretir (toplam uzunluk >= genişlik).
 */
function createStadiumRing(
  width: number,
  length: number,
  arcSegments = 16
): Point2D[] {
  const w = Math.max(1.0, width);
  const r = w * 0.5;
  const totalLen = Math.max(w, length);
  const straightHalf = (totalLen - w) * 0.5;

  if (straightHalf <= 0.05) {
    return createCircleRing(0, 0, r, arcSegments * 2, true);
  }

  const segs = Math.max(8, Math.round(arcSegments));
  const ring: Point2D[] = [];

  // Sağ yarım daire (-PI/2 .. +PI/2)
  for (let i = 0; i <= segs; i++) {
    const a = -Math.PI * 0.5 + (i / segs) * Math.PI;
    ring.push([straightHalf + Math.cos(a) * r, Math.sin(a) * r]);
  }
  // Sol yarım daire (+PI/2 .. 3*PI/2)
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI * 0.5 + (i / segs) * Math.PI;
    ring.push([-straightHalf + Math.cos(a) * r, Math.sin(a) * r]);
  }

  return ensureCCW(ring);
}

/**
 * Kutu ve kapak için dünya merkezleri ve sınırlarını hesaplar.
 */
export function getBoxTargetBounds(
  params: ParametricBoxParams,
  target: 'box' | 'lid'
): {
  cx: number;
  cy: number;
  width: number;
  depth: number;
  height: number;
  useLid: boolean;
} {
  const width = Math.max(20, params.width);
  const depth = Math.max(20, params.depth);
  const height = Math.max(8, params.height);
  const lidTotalH = Math.max(1.0, params.lidThickness) + Math.max(0, params.lipHeight);
  const gap = 12;

  const useLid =
    (target === 'lid' && params.lidMode !== 'box') || params.lidMode === 'lid';
  const boxCx = params.lidMode === 'both' ? -(width * 0.5 + gap * 0.5) : 0;
  const lidCx = params.lidMode === 'both' ? +(width * 0.5 + gap * 0.5) : 0;

  return {
    cx: useLid ? lidCx : boxCx,
    cy: 0,
    width,
    depth,
    height: useLid ? lidTotalH : height,
    useLid,
  };
}

/**
 * Tek bir parametrik delik için dünya koordinatlarında kapalı manifold Brush geometrisi üretir.
 * Hem CSG Subtract işlemi hem de 3D Hayalet Önizleme (Ghost Preview) için birebir aynı geometri kullanılır.
 */
export function buildHoleBrushGeometry(
  hole: BoxCutoutHole,
  params: ParametricBoxParams
): THREE.BufferGeometry {
  const bounds = getBoxTargetBounds(params, hole.target);

  // Boydan boya (Through) modunda hedef kutu ölçüsünü +4 mm aş (alt ve üstten >2 mm taşar, eşdüzlem hatası olmaz)
  let cutLength: number;
  if (hole.depthMode === 'through') {
    if (hole.orientation === 'z') cutLength = bounds.height + 4.0;
    else if (hole.orientation === 'x') cutLength = bounds.width + 4.0;
    else cutLength = bounds.depth + 4.0;
  } else {
    cutLength = Math.max(0.4, hole.depth);
  }

  // 2D profil konturu
  let profileCCW: Point2D[];
  if (hole.shape === 'cylinder') {
    const r = Math.max(0.5, hole.diameter * 0.5);
    const segs = hole.diameter >= 16 ? 40 : 32;
    // Küçük faz açısı (0.013 rad) dairesel kenarların düz kutu duvar diyagonallerini tam sıyırmasını önler
    profileCCW = createCircleRing(0, 0, r, segs, true, 0.013);
  } else if (hole.shape === 'box') {
    const rw = Math.max(0.8, hole.rectWidth);
    const rl = Math.max(0.8, hole.rectLength);
    profileCCW = createRoundedRectRing(0, 0, rw, rl, 0, 2, true);
  } else if (hole.shape === 'hexagon') {
    // Anahtar ağzı (Flat-to-Flat) -> çevre çember yarıçapı = s / sqrt(3)
    const af = Math.max(1.5, hole.hexFlatToFlat);
    const circumR = af / Math.sqrt(3);
    profileCCW = createRegularPolygonRing(0, 0, circumR, 6, 0, true);
  } else {
    profileCCW = createStadiumRing(hole.slotWidth, hole.slotLength, 14);
  }

  // Z ekseni boyunca [-cutLength/2, +cutLength/2] ekstrüde et (sıfır dejenere kutup köşesi)
  const builder = new ManifoldMeshBuilder();
  builder.addExtrudedRegion(profileCCW, [], -cutLength * 0.5, cutLength * 0.5);
  const geom = builder.toBufferGeometry();

  // Delik kendi ekseni etrafında 2D dönüş
  if (Math.abs(hole.rotationDeg) > 1e-3) {
    geom.rotateZ(THREE.MathUtils.degToRad(hole.rotationDeg));
  }

  // Yönlendirme (Z: üst-alt, X: sağ-sol, Y: ön-arka)
  if (hole.orientation === 'x') {
    geom.rotateY(Math.PI * 0.5);
  } else if (hole.orientation === 'y') {
    geom.rotateX(-Math.PI * 0.5);
  }

  // Referans noktasına göre dünya koordinatı (Merkez veya Sol-Alt Köşe)
  let wx: number;
  let wy: number;
  let wz: number;

  if (hole.coordOrigin === 'center') {
    wx = bounds.cx + hole.x;
    wy = bounds.cy + hole.y;
    wz = bounds.height * 0.5 + hole.z;
  } else {
    wx = bounds.cx - bounds.width * 0.5 + hole.x;
    wy = bounds.cy - bounds.depth * 0.5 + hole.y;
    wz = hole.z;
  }

  // Boydan boya modunda kesim eksenini otomatik ortala
  if (hole.depthMode === 'through') {
    if (hole.orientation === 'z') wz = bounds.height * 0.5;
    else if (hole.orientation === 'x') wx = bounds.cx;
    else wy = bounds.cy;
  }

  geom.translate(wx, wy, wz);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  return geom;
}

/**
 * CSG için yalnızca position ve normal özniteliklerine sahip,
 * çakışan köşeleri birleştirilmiş (indexed) temiz geometri hazırlar.
 */
function normalizeForCSG(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = source.clone();
  for (const attrName of Object.keys(geo.attributes)) {
    if (attrName !== 'position') {
      geo.deleteAttribute(attrName);
    }
  }
  const merged = mergeVertices(geo, 1e-4);
  geo.dispose();
  merged.computeVertexNormals();
  return merged;
}

/**
 * 3D Konformal T-Birleşimi (T-Junction) Onarıcı:
 * three-bvh-csg kesim sınırında bir üçgeni böldüğünde komşu üçgenin kenarı üzerinde
 * kalan serbest köşeleri (T-junction) algılar ve komşu üçgeni o köşeden bölerek
 * %100 watertight (0 açık kenar) manifold mesh üretir.
 */
function stitch3DTJunctions(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const posAttr = nonIndexed.getAttribute('position') as THREE.BufferAttribute;
  const rawTriCount = Math.floor(posAttr.count / 3);
  if (rawTriCount < 4) return nonIndexed;

  const QUANT = 1000; // 0.001 mm (1 mikron)
  const vertCoords: number[] = []; // [x, y, z, ...]
  const keyToVid = new Map<string, number>();

  const getVid = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`;
    let id = keyToVid.get(key);
    if (id === undefined) {
      id = vertCoords.length / 3;
      keyToVid.set(key, id);
      vertCoords.push(x, y, z);
    }
    return id;
  };

  type Tri = [number, number, number];
  const tris: Tri[] = [];
  for (let t = 0; t < rawTriCount; t++) {
    const i0 = t * 3;
    const a = getVid(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
    const b = getVid(posAttr.getX(i0 + 1), posAttr.getY(i0 + 1), posAttr.getZ(i0 + 1));
    const c = getVid(posAttr.getX(i0 + 2), posAttr.getY(i0 + 2), posAttr.getZ(i0 + 2));
    if (a === b || b === c || c === a) continue;
    tris.push([a, b, c]);
  }

  for (let pass = 0; pass < 8; pass++) {
    const edgeCounts = new Map<string, number>();
    for (const [a, b, c] of tris) {
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const k = `${u},${v}`;
        edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
      }
    }

    // Yalnızca açık kenarlara ait benzersiz köşeleri topla (çok hızlı tarama)
    const openVertSet = new Set<number>();
    let openEdgeCount = 0;
    for (const [k] of edgeCounts) {
      const sep = k.indexOf(',');
      const u = Number(k.slice(0, sep));
      const v = Number(k.slice(sep + 1));
      if (!edgeCounts.has(`${v},${u}`)) {
        openEdgeCount++;
        openVertSet.add(u);
        openVertSet.add(v);
      }
    }
    if (openEdgeCount === 0) break;

    const openVerts = Array.from(openVertSet);
    const nextTris: Tri[] = [];
    let didSplit = false;

    for (const [a, b, c] of tris) {
      const triEdges: [number, number, number][] = [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ];

      let splitDone = false;
      for (const [u, v, opp] of triEdges) {
        if (edgeCounts.has(`${v},${u}`)) continue;

        const ux = vertCoords[u * 3];
        const uy = vertCoords[u * 3 + 1];
        const uz = vertCoords[u * 3 + 2];
        const vx = vertCoords[v * 3];
        const vy = vertCoords[v * 3 + 1];
        const vz = vertCoords[v * 3 + 2];

        const dx = vx - ux;
        const dy = vy - uy;
        const dz = vz - uz;
        const lenSq = dx * dx + dy * dy + dz * dz;
        if (lenSq < 1e-10) continue;

        const onSeg: Array<{ w: number; t: number }> = [];
        for (const w of openVerts) {
          if (w === u || w === v || w === opp) continue;
          const wx = vertCoords[w * 3];
          const wy = vertCoords[w * 3 + 1];
          const wz = vertCoords[w * 3 + 2];

          const px = wx - ux;
          const py = wy - uy;
          const pz = wz - uz;
          const t = (px * dx + py * dy + pz * dz) / lenSq;
          if (t <= 1e-5 || t >= 1 - 1e-5) continue;

          // 3D dik uzaklık kontrolü (< 0.0006 mm -> eğri silindir/slot köşelerini yanlış yakalamaz)
          const ex = px - t * dx;
          const ey = py - t * dy;
          const ez = pz - t * dz;
          if (ex * ex + ey * ey + ez * ez <= 4e-7) {
            onSeg.push({ w, t });
          }
        }

        if (onSeg.length > 0) {
          onSeg.sort((p1, p2) => p1.t - p2.t);
          let prev = u;
          for (const item of onSeg) {
            nextTris.push([prev, item.w, opp]);
            prev = item.w;
          }
          nextTris.push([prev, v, opp]);
          splitDone = true;
          didSplit = true;
          break;
        }
      }

      if (!splitDone) {
        nextTris.push([a, b, c]);
      }
    }

    if (!didSplit) break;
    tris.length = 0;
    for (const nt of nextTris) tris.push(nt);
  }

  // Pozisyon dizisini oluştur (sıfır alanlı dejenere üçgenleri atla)
  const outPos: number[] = [];
  for (const [a, b, c] of tris) {
    const ax = vertCoords[a * 3];
    const ay = vertCoords[a * 3 + 1];
    const az = vertCoords[a * 3 + 2];
    const bx = vertCoords[b * 3];
    const by = vertCoords[b * 3 + 1];
    const bz = vertCoords[b * 3 + 2];
    const cx = vertCoords[c * 3];
    const cy = vertCoords[c * 3 + 1];
    const cz = vertCoords[c * 3 + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) continue;

    outPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  if (nonIndexed !== geometry) {
    nonIndexed.dispose();
  }

  const cleanGeo = new THREE.BufferGeometry();
  cleanGeo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  cleanGeo.computeVertexNormals();
  cleanGeo.computeBoundingBox();
  cleanGeo.computeBoundingSphere();
  return cleanGeo;
}

/**
 * Ana kutu katısından (Base Box Brush) kullanıcının tanımladığı tüm aktif delik hacimlerini
 * three-bvh-csg (SUBTRACTION) ile sırayla çıkarır ve hayalet önizleme geometrilerini döndürür.
 */
export function applyBoxCutoutsCSG(
  baseGeometry: THREE.BufferGeometry,
  params: ParametricBoxParams,
  warnings: string[]
): {
  geometry: THREE.BufferGeometry;
  ghostMeshes: CutoutGhostMesh[];
  appliedCount: number;
} {
  const cutouts = params.cutouts ?? [];
  if (cutouts.length === 0) {
    return {
      geometry: baseGeometry,
      ghostMeshes: [],
      appliedCount: 0,
    };
  }

  const ghostMeshes: CutoutGhostMesh[] = [];
  const activeBrushes: Array<{ hole: BoxCutoutHole; geom: THREE.BufferGeometry }> = [];

  for (const hole of cutouts) {
    const holeGeo = buildHoleBrushGeometry(hole, params);
    ghostMeshes.push({
      id: hole.id,
      name: hole.name,
      geometry: holeGeo,
      enabled: hole.enabled,
    });
    if (hole.enabled) {
      activeBrushes.push({ hole, geom: holeGeo });
    }
  }

  if (activeBrushes.length === 0) {
    return {
      geometry: baseGeometry,
      ghostMeshes,
      appliedCount: 0,
    };
  }

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  evaluator.attributes = ['position', 'normal'];

  let currentBrush = new Brush(normalizeForCSG(baseGeometry));
  currentBrush.updateMatrixWorld(true);
  let appliedCount = 0;

  for (const item of activeBrushes) {
    const holeBrush = new Brush(normalizeForCSG(item.geom));
    holeBrush.updateMatrixWorld(true);

    try {
      const resultBrush = evaluator.evaluate(
        currentBrush,
        holeBrush,
        SUBTRACTION
      );

      // Ara kaynakları temizle
      currentBrush.geometry.dispose();
      currentBrush.disposeCacheData();
      holeBrush.geometry.dispose();
      holeBrush.disposeCacheData();

      currentBrush = resultBrush;
      currentBrush.updateMatrixWorld(true);
      appliedCount++;
    } catch (err) {
      holeBrush.geometry.dispose();
      holeBrush.disposeCacheData();
      warnings.push(
        `"${item.hole.name}" deliği CSG çıkarma sırasında atlandı: ${String(err)}`
      );
    }
  }

  // Sonuç geometrisini 3D T-junction onarımı + keskin düz normallerle STL'e hazırla
  const rawOut = currentBrush.geometry;
  const finalGeo = stitch3DTJunctions(rawOut);
  rawOut.dispose();
  currentBrush.disposeCacheData();
  baseGeometry.dispose();

  return {
    geometry: finalGeo,
    ghostMeshes,
    appliedCount,
  };
}
