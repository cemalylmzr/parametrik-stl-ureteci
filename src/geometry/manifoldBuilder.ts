import * as THREE from 'three';
import earcut from 'earcut';

export type Point2D = [number, number];

const EPS = 1e-6;

/**
 * 2D çokgenin işaretli alanını hesaplar.
 * Pozitif: Saat yönünün tersi (CCW - dış kontur).
 * Negatif: Saat yönü (CW - iç delik konturu).
 */
export function signedArea(ring: Point2D[]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return area * 0.5;
}

/** Ardışık tekrar eden noktaları ve kapanış kopyasını temizler. */
export function cleanRing(ring: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (out.length === 0) {
      out.push([p[0], p[1]]);
    } else {
      const prev = out[out.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > EPS) {
        out.push([p[0], p[1]]);
      }
    }
  }
  while (
    out.length > 1 &&
    Math.hypot(
      out[0][0] - out[out.length - 1][0],
      out[0][1] - out[out.length - 1][1]
    ) <= EPS
  ) {
    out.pop();
  }
  return out;
}

export function ensureCCW(ring: Point2D[]): Point2D[] {
  const cleaned = cleanRing(ring);
  if (cleaned.length < 3) return cleaned;
  return signedArea(cleaned) < 0 ? [...cleaned].reverse() : cleaned;
}

export function ensureCW(ring: Point2D[]): Point2D[] {
  const cleaned = cleanRing(ring);
  if (cleaned.length < 3) return cleaned;
  return signedArea(cleaned) > 0 ? [...cleaned].reverse() : cleaned;
}

export function createCircleRing(
  cx: number,
  cy: number,
  radius: number,
  segments: number,
  ccw = true,
  rotationRad = 0
): Point2D[] {
  const segs = Math.max(8, Math.round(segments));
  const ring: Point2D[] = [];
  for (let i = 0; i < segs; i++) {
    const angle = rotationRad + (i / segs) * Math.PI * 2;
    ring.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return ccw ? ensureCCW(ring) : ensureCW(ring);
}

export function createRegularPolygonRing(
  cx: number,
  cy: number,
  circumRadius: number,
  sides: number,
  rotationRad = 0,
  ccw = true
): Point2D[] {
  const n = Math.max(3, Math.round(sides));
  const ring: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const angle = rotationRad + (i / n) * Math.PI * 2;
    ring.push([
      cx + Math.cos(angle) * circumRadius,
      cy + Math.sin(angle) * circumRadius,
    ]);
  }
  return ccw ? ensureCCW(ring) : ensureCW(ring);
}

/**
 * Ergonomik tırtıklı (knurled/ribbed) dış tutuş profili oluşturur (el vidası ve dişli kapak için).
 */
export function createKnurledRing(
  cx: number,
  cy: number,
  outerRadius: number,
  ribCount: number,
  ribDepth: number,
  ccw = true
): Point2D[] {
  const ribs = Math.max(12, Math.round(ribCount));
  const totalPts = ribs * 4;
  const ring: Point2D[] = [];
  const depth = Math.max(0.15, Math.min(ribDepth, outerRadius * 0.12));

  for (let i = 0; i < totalPts; i++) {
    const angle = (i / totalPts) * Math.PI * 2;
    const phase = i % 4;
    // Yumuşak oluklu profil: tepe -> geçiş -> vadi -> geçiş
    const r =
      phase === 0
        ? outerRadius
        : phase === 2
          ? outerRadius - depth
          : outerRadius - depth * 0.45;
    ring.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return ccw ? ensureCCW(ring) : ensureCW(ring);
}

/**
 * D-mil (tek tarafı düzlenmiş motor mili) deliği konturu oluşturur.
 */
export function createDShaftRing(
  cx: number,
  cy: number,
  diameter: number,
  flatDepthRatio = 0.14,
  segments = 36,
  ccw = false
): Point2D[] {
  const r = diameter * 0.5;
  const flatX = r * (1 - 2 * flatDepthRatio);
  const segs = Math.max(16, Math.round(segments));
  const ring: Point2D[] = [];

  for (let i = 0; i < segs; i++) {
    const angle = (i / segs) * Math.PI * 2;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    ring.push([cx + Math.min(px, flatX), cy + py]);
  }
  return ccw ? ensureCCW(ring) : ensureCW(ring);
}

export function createRoundedRectRing(
  cx: number,
  cy: number,
  width: number,
  depth: number,
  cornerRadius: number,
  cornerSegments = 8,
  ccw = true
): Point2D[] {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const r = Math.max(0, Math.min(cornerRadius, hw - 0.05, hd - 0.05));

  if (r <= 0.02) {
    const rect: Point2D[] = [
      [cx - hw, cy - hd],
      [cx + hw, cy - hd],
      [cx + hw, cy + hd],
      [cx - hw, cy + hd],
    ];
    return ccw ? ensureCCW(rect) : ensureCW(rect);
  }

  const segs = Math.max(2, Math.round(cornerSegments));
  const ring: Point2D[] = [];

  // 4 köşe yayı (CCW sırayla: sağ-alt, sağ-üst, sol-üst, sol-alt)
  const corners: Array<{ x: number; y: number; start: number; end: number }> = [
    { x: cx + hw - r, y: cy - hd + r, start: -Math.PI / 2, end: 0 },
    { x: cx + hw - r, y: cy + hd - r, start: 0, end: Math.PI / 2 },
    { x: cx - hw + r, y: cy + hd - r, start: Math.PI / 2, end: Math.PI },
    {
      x: cx - hw + r,
      y: cy - hd + r,
      start: Math.PI,
      end: (3 * Math.PI) / 2,
    },
  ];

  for (const c of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = c.start + (i / segs) * (c.end - c.start);
      ring.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]);
    }
  }

  return ccw ? ensureCCW(ring) : ensureCW(ring);
}

export function pointInRing(p: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  const [px, py] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq)
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function minDistPointToRing(p: Point2D, ring: Point2D[]): number {
  let minD = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const d = pointToSegmentDist(p, ring[i], ring[(i + 1) % n]);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Bir iç deliğin tüm köşelerinin dış sınırın içinde ve kenarlardan en az `margin`
 * mm içeride olduğunu doğrular. Bu sayede earcut kesinlikle kendiyle kesişmeyen
 * geçerli delikler alır ve mesh %100 watertight kalır.
 */
export function isRingStrictlyInside(
  inner: Point2D[],
  outer: Point2D[],
  margin = 0.2
): boolean {
  for (const pt of inner) {
    if (!pointInRing(pt, outer)) return false;
    if (minDistPointToRing(pt, outer) < margin) return false;
  }
  // Ayrıca kenar orta noktalarını da kontrol et (köşeli dış konturlar için)
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % n];
    const mid: Point2D = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    if (!pointInRing(mid, outer)) return false;
    if (minDistPointToRing(mid, outer) < margin) return false;
  }
  return true;
}

/**
 * Katı, watertight (2-manifold) Z-up (mm) üçgen mesh oluşturucu.
 * Her düzlemsel yüzeyi earcut ile üçgenler, dikey duvarlarla kenar-kenara eşleştirir.
 */
export class ManifoldMeshBuilder {
  private positions: number[] = [];

  addTriangle(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number
  ): void {
    // Sıfır alanlı dejenere üçgenleri atla
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz < 1e-18) return;

    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }

  /**
   * Belirli bir Z düzleminde dış kontur (CCW) ve deliklerden (CW) oluşan yüzeyi ekler.
   * facingUp = true  -> normal +Z
   * facingUp = false -> normal -Z
   */
  addPlanarFace(
    outerInput: Point2D[],
    holesInput: Point2D[][],
    z: number,
    facingUp: boolean
  ): void {
    const outer = ensureCCW(outerInput);
    if (outer.length < 3) return;

    const coords: number[] = [];
    const holeIndices: number[] = [];

    for (const [x, y] of outer) {
      coords.push(x, y);
    }

    for (const hRaw of holesInput) {
      const hole = ensureCW(hRaw);
      if (hole.length < 3) continue;
      holeIndices.push(coords.length / 2);
      for (const [x, y] of hole) {
        coords.push(x, y);
      }
    }

    // earcut üçgenlemesi al
    const rawIndices = earcut(
      coords,
      holeIndices.length > 0 ? holeIndices : undefined,
      2
    );

    // Üçgen listesini oluştur
    type Tri = [number, number, number];
    const tris: Tri[] = [];
    for (let i = 0; i < rawIndices.length; i += 3) {
      tris.push([rawIndices[i], rawIndices[i + 1], rawIndices[i + 2]]);
    }

    const triCross = (a: number, b: number, c: number): number => {
      const ax = coords[a * 2];
      const ay = coords[a * 2 + 1];
      const bx = coords[b * 2];
      const by = coords[b * 2 + 1];
      const cx = coords[c * 2];
      const cy = coords[c * 2 + 1];
      return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    };

    const distSq = (a: number, b: number): number => {
      const dx = coords[b * 2] - coords[a * 2];
      const dy = coords[b * 2 + 1] - coords[a * 2 + 1];
      return dx * dx + dy * dy;
    };

    // Eşdoğrusal (sıfır alanlı) earcut köprü üçgenlerini T-birleşimi oluşturmadan
    // uzun kenara komşu olan POZİTİF ALANLI üçgeni orta noktadan bölerek (edge split) temizle.
    // Birden fazla eşdoğrusal üçgen zincir halinde ise en uzun kenarlı (dış) olandan başlamak
    // tüm zinciri kesin olarak sonlandırır.
    const AREA_EPS = 1e-5;
    const maxPasses = tris.length * 2 + 32;
    for (let pass = 0; pass < maxPasses; pass++) {
      // Tüm eşdoğrusal üçgenleri topla ve en uzun kenara göre büyükten küçüğe sırala
      const degList: Array<{ idx: number; p: number; q: number; m: number; lenSq: number }> = [];
      for (let t = 0; t < tris.length; t++) {
        const [a, b, c] = tris[t];
        if (Math.abs(triCross(a, b, c)) < AREA_EPS) {
          const d01 = distSq(a, b);
          const d12 = distSq(b, c);
          const d20 = distSq(c, a);
          if (d01 >= d12 && d01 >= d20) {
            degList.push({ idx: t, p: a, q: b, m: c, lenSq: d01 });
          } else if (d12 >= d01 && d12 >= d20) {
            degList.push({ idx: t, p: b, q: c, m: a, lenSq: d12 });
          } else {
            degList.push({ idx: t, p: c, q: a, m: b, lenSq: d20 });
          }
        }
      }
      if (degList.length === 0) break;

      degList.sort((x, y) => y.lenSq - x.lenSq);

      let resolved = false;
      for (const deg of degList) {
        let nbrIdx = -1;
        let u = -1;
        let v = -1;
        let d = -1;

        for (let t = 0; t < tris.length; t++) {
          if (t === deg.idx) continue;
          const [a, b, c] = tris[t];
          // Sadece pozitif alanlı (eşdoğrusal olmayan) komşu üçgeni böl
          if (Math.abs(triCross(a, b, c)) < AREA_EPS) continue;

          const pairs: [number, number, number][] = [
            [a, b, c],
            [b, c, a],
            [c, a, b],
          ];
          for (const [e0, e1, opp] of pairs) {
            if ((e0 === deg.p && e1 === deg.q) || (e0 === deg.q && e1 === deg.p)) {
              nbrIdx = t;
              u = e0;
              v = e1;
              d = opp;
              break;
            }
          }
          if (nbrIdx !== -1) break;
        }

        if (nbrIdx !== -1) {
          // Komşu üçgeni (u, v, d) -> (u, m, d) ve (m, v, d) olarak ikiye böl!
          tris[nbrIdx] = [u, deg.m, d];
          tris[deg.idx] = [deg.m, v, d];
          resolved = true;
          break;
        }
      }

      if (!resolved) break;
    }

    // 2. Konformal T-birleşimi (T-junction) onarımı:
    // earcut'un eşdoğrusal delik kenarlarında atladığı köşeleri yakalayıp
    // o kenarı taşıyan üçgeni köşe noktasından bölerek %100 watertight kenar eşleşmesi sağlar.
    const vertexCount = coords.length / 2;
    const expectedBoundary = new Set<string>();
    const addRingBoundary = (startIdx: number, len: number) => {
      for (let i = 0; i < len; i++) {
        const u = startIdx + i;
        const v = startIdx + ((i + 1) % len);
        expectedBoundary.add(`${u},${v}`);
      }
    };
    addRingBoundary(0, outer.length);
    let hOffset = outer.length;
    for (const hRaw of holesInput) {
      const hole = ensureCW(hRaw);
      if (hole.length < 3) continue;
      addRingBoundary(hOffset, hole.length);
      hOffset += hole.length;
    }

    // Yalnızca eşleşmeyen beklenmedik kenar varsa T-junction bölmesi çalıştır (genel durumda O(T))
    for (let tjPass = 0; tjPass < 8; tjPass++) {
      // Tüm üçgenleri geçici olarak CCW normalize et (topoloji kontrolü için)
      const edgeCounts = new Map<string, number>();
      for (let t = 0; t < tris.length; t++) {
        let [a, b, c] = tris[t];
        if (triCross(a, b, c) < 0) {
          tris[t] = [a, c, b];
          [a, b, c] = tris[t];
        }
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a],
        ]) {
          const k = `${u},${v}`;
          edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
        }
      }

      // Beklenen sınırda olmayan ve ters kenarı bulunmayan açık kenarları bul
      let didSplit = false;
      const nextTris: Tri[] = [];

      for (let t = 0; t < tris.length; t++) {
        const [a, b, c] = tris[t];
        const triEdges: [number, number, number][] = [
          [a, b, c],
          [b, c, a],
          [c, a, b],
        ];

        let splitHandled = false;
        for (const [u, v, opp] of triEdges) {
          const fwd = `${u},${v}`;
          const rev = `${v},${u}`;
          if (edgeCounts.has(rev) || expectedBoundary.has(fwd)) continue;

          // Bu kenar (u -> v) üzerinde tam segment içinde kalan ara köşeleri bul
          const ux = coords[u * 2];
          const uy = coords[u * 2 + 1];
          const vx = coords[v * 2];
          const vy = coords[v * 2 + 1];
          const dx = vx - ux;
          const dy = vy - uy;
          const lenSq = dx * dx + dy * dy;
          if (lenSq < 1e-10) continue;
          const len = Math.sqrt(lenSq);

          const onSegment: Array<{ w: number; param: number }> = [];
          for (let w = 0; w < vertexCount; w++) {
            if (w === u || w === v || w === opp) continue;
            const wx = coords[w * 2];
            const wy = coords[w * 2 + 1];
            const cross = Math.abs((wx - ux) * dy - (wy - uy) * dx);
            if (cross / len > 1e-3) continue; // Segment doğrusundan > 0.001 mm uzak
            const param = ((wx - ux) * dx + (wy - uy) * dy) / lenSq;
            if (param > 1e-5 && param < 1 - 1e-5) {
              onSegment.push({ w, param });
            }
          }

          if (onSegment.length > 0) {
            onSegment.sort((p1, p2) => p1.param - p2.param);
            let prev = u;
            for (const item of onSegment) {
              nextTris.push([prev, item.w, opp]);
              prev = item.w;
            }
            nextTris.push([prev, v, opp]);
            splitHandled = true;
            didSplit = true;
            break;
          }
        }

        if (!splitHandled) {
          nextTris.push([a, b, c]);
        }
      }

      if (!didSplit) break;
      tris.length = 0;
      for (const nt of nextTris) tris.push(nt);
    }

    for (const [a, b, c] of tris) {
      const ax = coords[a * 2];
      const ay = coords[a * 2 + 1];
      const bx = coords[b * 2];
      const by = coords[b * 2 + 1];
      const cx = coords[c * 2];
      const cy = coords[c * 2 + 1];

      // 2D işaretli alan (>0 ise CCW -> normal +Z)
      const crossZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(crossZ) < 1e-10) continue;

      const isCCW = crossZ > 0;
      if (facingUp === isCCW) {
        this.addTriangle(ax, ay, z, bx, by, z, cx, cy, z);
      } else {
        this.addTriangle(ax, ay, z, cx, cy, z, bx, by, z);
      }
    }
  }

  /**
   * Dikey ekstrüzyon yan duvarı ekler (zBottom < zTop).
   * - Dış kontur (CCW): normaller dışa bakar.
   * - İç delik konturu (CW): normaller deliğin içine (katıdan dışarı) bakar.
   */
  addWallStrip(ring: Point2D[], zBottom: number, zTop: number): void {
    const n = ring.length;
    if (n < 3 || zTop <= zBottom + EPS) return;

    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      this.addTriangle(x0, y0, zBottom, x1, y1, zBottom, x1, y1, zTop);
      this.addTriangle(x0, y0, zBottom, x1, y1, zTop, x0, y0, zTop);
    }
  }

  /**
   * Aynı köşe sayısına sahip iki kontur arasında eğimli/pahlı geçiş duvarı (loft) ekler.
   * Hem dış pahlar (CCW) hem iç pahlar (CW) için tutarlı dış normal üretir.
   */
  addLoftStrip(
    ringBottom: Point2D[],
    zBottom: number,
    ringTop: Point2D[],
    zTop: number
  ): void {
    const n = ringBottom.length;
    if (n < 3 || ringTop.length !== n) return;

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const [bx0, by0] = ringBottom[i];
      const [bx1, by1] = ringBottom[next];
      const [tx0, ty0] = ringTop[i];
      const [tx1, ty1] = ringTop[next];

      this.addTriangle(bx0, by0, zBottom, bx1, by1, zBottom, tx1, ty1, zTop);
      this.addTriangle(bx0, by0, zBottom, tx1, ty1, zTop, tx0, ty0, zTop);
    }
  }

  /**
   * Basit prizma ekstrüzyonu (zBottom..zTop). Tek parça watertight kabuk.
   */
  addExtrudedRegion(
    outerInput: Point2D[],
    holesInput: Point2D[][],
    zBottom: number,
    zTop: number
  ): void {
    const outer = ensureCCW(outerInput);
    const holes = holesInput.map(ensureCW).filter((h) => h.length >= 3);

    this.addPlanarFace(outer, holes, zBottom, false);
    this.addPlanarFace(outer, holes, zTop, true);
    this.addWallStrip(outer, zBottom, zTop);
    for (const h of holes) {
      this.addWallStrip(h, zBottom, zTop);
    }
  }

  /**
   * %100 watertight (2-manifold) helisel ISO/FDM vida dişi duvarı üretir.
   * - internal = false: Dış diş (cıvata, dişli kavanoz boynu), CCW halkalar, dışa bakan normaller.
   * - internal = true : İç diş (somun, cıvata deliği, dişli kapak), CW halkalar, delik içine bakan normaller.
   * Alt ve üst bitiş halkaları tam daireseldir ve çağırıcıya döndürülür; böylece addPlanarFace ile
   * sıfır açık kenarla birleşir.
   */
  addHelicalThreadWall(opts: {
    cx: number;
    cy: number;
    zBottom: number;
    zTop: number;
    nominalDiameter: number;
    pitch: number;
    internal: boolean;
    tolerance?: number;
    radialSegments?: number;
    stepsPerPitch?: number;
    taperRatio?: number;
  }): {
    bottomRing: Point2D[];
    topRing: Point2D[];
    rMinor: number;
    rMajor: number;
  } {
    const {
      cx,
      cy,
      zBottom,
      zTop,
      nominalDiameter,
      pitch,
      internal,
      tolerance = 0.35,
      radialSegments = 36,
      stepsPerPitch = 8,
      taperRatio = 0.4,
    } = opts;

    const length = Math.max(0.4, zTop - zBottom);
    const safePitch = Math.max(0.6, pitch);
    const segs = Math.max(20, Math.round(radialSegments));
    const totalSlices = Math.max(
      6,
      Math.ceil((length / safePitch) * Math.max(6, stepsPerPitch))
    );

    // ISO-60° / FDM baskı dostu kesik tepeli trapez diş derinliği
    const threadDepth = Math.min(0.54 * safePitch, nominalDiameter * 0.22);
    const tol = internal ? Math.max(0, tolerance) : 0;

    const rMajor = nominalDiameter * 0.5 + tol;
    const rMinor = Math.max(0.8, rMajor - threadDepth);

    // Giriş/çıkış konikleşme (lead-in/out) mesafesi
    const taperLen = Math.min(safePitch * taperRatio, length * 0.28);

    // Kesik tepeli (trapezoidal) 60° vida profili: phi in [0, 1) -> [0, 1]
    const threadProfile = (phiRaw: number): number => {
      const phi = ((phiRaw % 1) + 1) % 1;
      if (phi < 0.125) return 0;
      if (phi < 0.4375) return (phi - 0.125) / 0.3125;
      if (phi < 0.5625) return 1;
      if (phi < 0.875) return 1 - (phi - 0.5625) / 0.3125;
      return 0;
    };

    const envelope = (z: number): number => {
      if (taperLen <= 1e-6) return 1;
      const distBot = z - zBottom;
      const distTop = zTop - z;
      const d = Math.min(distBot, distTop);
      if (d <= 0) return 0;
      if (d >= taperLen) return 1;
      // Yumuşak smoothstep geçişi
      const t = d / taperLen;
      return t * t * (3 - 2 * t);
    };

    const rings: Point2D[][] = [];
    const zs: number[] = [];

    for (let k = 0; k <= totalSlices; k++) {
      const z = zBottom + (k / totalSlices) * length;
      zs.push(z);
      const env = k === 0 || k === totalSlices ? 0 : envelope(z);
      const ring: Point2D[] = [];

      for (let j = 0; j < segs; j++) {
        // Dış diş CCW (+theta), iç diş CW (-theta)
        const theta = internal
          ? -(j / segs) * Math.PI * 2
          : (j / segs) * Math.PI * 2;
        const phase = (z - zBottom) / safePitch - theta / (Math.PI * 2);

        let r: number;
        if (internal) {
          // İç dişte env=0 iken rMajor (geniş giriş havşası), env=1 iken rMajor..rMinor arası diş
          const p = threadProfile(phase + 0.5);
          r = rMajor - env * p * (rMajor - rMinor);
        } else {
          // Dış dişte env=0 iken rMinor (temiz pahlı giriş), env=1 iken rMinor..rMajor arası diş
          const p = threadProfile(phase);
          r = rMinor + env * p * (rMajor - rMinor);
        }

        ring.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
      }
      rings.push(ring);
    }

    // Helis sırtı yönüne hizalı diyagonal üçgenleme (j -> +theta ise b0-t1, -theta ise b1-t0)
    for (let k = 0; k < totalSlices; k++) {
      const rBot = rings[k];
      const rTop = rings[k + 1];
      const zb = zs[k];
      const zt = zs[k + 1];

      for (let j = 0; j < segs; j++) {
        const next = (j + 1) % segs;
        const [bx0, by0] = rBot[j];
        const [bx1, by1] = rBot[next];
        const [tx0, ty0] = rTop[j];
        const [tx1, ty1] = rTop[next];

        if (internal) {
          // CW halka: b1 -> t0 diyagonali sağ-el helis sırtıyla tam hizalı
          this.addTriangle(bx0, by0, zb, bx1, by1, zb, tx0, ty0, zt);
          this.addTriangle(bx1, by1, zb, tx1, ty1, zt, tx0, ty0, zt);
        } else {
          // CCW halka: b0 -> t1 diyagonali sağ-el helis sırtıyla tam hizalı
          this.addTriangle(bx0, by0, zb, bx1, by1, zb, tx1, ty1, zt);
          this.addTriangle(bx0, by0, zb, tx1, ty1, zt, tx0, ty0, zt);
        }
      }
    }

    return {
      bottomRing: rings[0],
      topRing: rings[totalSlices],
      rMinor,
      rMajor,
    };
  }

  toBufferGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const posArray = new Float32Array(this.positions);
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export interface ManifoldValidationResult {
  isWatertight: boolean;
  openEdges: number;
  nonManifoldEdges: number;
  triangleCount: number;
  vertexCount: number;
  volumeMm3: number;
  surfaceAreaMm2: number;
}

/**
 * Üretilen BufferGeometry üzerinde gerçek zamanlı manifold / watertight doğrulaması
 * ve kesin hacim + yüzey alanı (Divergence Theorem) hesabı yapar.
 */
export function validateManifold(
  geometry: THREE.BufferGeometry
): ManifoldValidationResult {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    return {
      isWatertight: false,
      openEdges: 0,
      nonManifoldEdges: 0,
      triangleCount: 0,
      vertexCount: 0,
      volumeMm3: 0,
      surfaceAreaMm2: 0,
    };
  }

  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(posAttr.count / 3);

  // 1 mikron (0.001 mm) çözünürlükte vertex anahtarı -> Float32 gürültüsüne dayanıklı
  const QUANT = 1000;
  const keyOf = (idx: number): string => {
    const x = Math.round(posAttr.getX(idx) * QUANT);
    const y = Math.round(posAttr.getY(idx) * QUANT);
    const z = Math.round(posAttr.getZ(idx) * QUANT);
    return `${x},${y},${z}`;
  };

  const directedEdges = new Map<string, number>();
  const uniqueVerts = new Set<string>();
  let signedVolume6 = 0;
  let surfaceArea2 = 0;

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

    // Hacim: v0 . (v1 x v2) / 6
    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    signedVolume6 += ax * crossX + ay * crossY + az * crossZ;

    // Yüzey alanı: |(v1 - v0) x (v2 - v0)| / 2
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    surfaceArea2 += Math.hypot(nx, ny, nz);

    const k0 = keyOf(i0);
    const k1 = keyOf(i1);
    const k2 = keyOf(i2);
    uniqueVerts.add(k0);
    uniqueVerts.add(k1);
    uniqueVerts.add(k2);

    const edges: [string, string][] = [
      [k0, k1],
      [k1, k2],
      [k2, k0],
    ];
    for (const [u, v] of edges) {
      if (u === v) continue;
      const ek = `${u}|${v}`;
      directedEdges.set(ek, (directedEdges.get(ek) ?? 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;

  for (const [ek, count] of directedEdges.entries()) {
    const sep = ek.indexOf('|');
    const u = ek.slice(0, sep);
    const v = ek.slice(sep + 1);
    const revCount = directedEdges.get(`${v}|${u}`) ?? 0;

    if (count > 1) {
      nonManifoldEdges += count - 1;
    }
    if (revCount === 0) {
      openEdges += 1;
    } else if (revCount !== count) {
      nonManifoldEdges += Math.abs(count - revCount);
    }
  }

  const volumeMm3 = Math.abs(signedVolume6) / 6;
  const isWatertight =
    triCount >= 4 &&
    openEdges === 0 &&
    nonManifoldEdges === 0 &&
    signedVolume6 > 0;

  return {
    isWatertight,
    openEdges,
    nonManifoldEdges,
    triangleCount: triCount,
    vertexCount: uniqueVerts.size,
    volumeMm3,
    surfaceAreaMm2: surfaceArea2 * 0.5,
  };
}
