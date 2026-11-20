import {
  HoneycombSieveParams,
  GeometryResult,
} from './types';
import {
  ManifoldMeshBuilder,
  Point2D,
  createCircleRing,
  createRegularPolygonRing,
  createRoundedRectRing,
  ensureCCW,
  ensureCW,
  isRingStrictlyInside,
} from './manifoldBuilder';

const MAX_HOLES = 1400;

export function generateHoneycombSieve(
  params: HoneycombSieveParams
): GeometryResult {
  const warnings: string[] = [];

  const width = Math.max(20, params.width);
  const depth = params.shape === 'circle' ? width : Math.max(20, params.depth);
  const thickness = Math.max(0.8, params.thickness);
  const rimHeight = Math.max(thickness, params.rimHeight);
  const maxRim = Math.min(width, depth) * 0.42;
  const rimWidth = Math.max(1.2, Math.min(params.rimWidth, maxRim));
  const holeSize = Math.max(1.2, params.holeSize);
  const wallSpacing = Math.max(0.6, params.wallSpacing);
  const curveSegments = Math.max(24, Math.min(96, Math.round(params.curveSegments)));

  if (wallSpacing < 0.8) {
    warnings.push(
      'Delikler arası duvar kalınlığı 0.8 mm altında; 0.4 mm nozzle için en az 0.8–1.2 mm önerilir.'
    );
  }
  if (params.rimWidth > maxRim) {
    warnings.push(
      `Çerçeve genişliği güvenli sınır olan ${maxRim.toFixed(1)} mm değerine kırpıldı.`
    );
  }

  // Dış ve iç çerçeve konturları
  const outerCCW: Point2D[] =
    params.shape === 'circle'
      ? createCircleRing(0, 0, width * 0.5, curveSegments, true)
      : createRoundedRectRing(
          0,
          0,
          width,
          depth,
          params.cornerRadius,
          10,
          true
        );

  const innerW = width - 2 * rimWidth;
  const innerD = depth - 2 * rimWidth;
  const hasInnerArea = innerW >= holeSize + 0.6 && innerD >= holeSize + 0.6;

  const innerRimCCW: Point2D[] =
    params.shape === 'circle'
      ? createCircleRing(0, 0, Math.max(1, innerW * 0.5), curveSegments, true)
      : createRoundedRectRing(
          0,
          0,
          Math.max(2, innerW),
          Math.max(2, innerD),
          Math.max(0, params.cornerRadius - rimWidth),
          10,
          true
        );

  const holeRingsCW: Point2D[][] = [];

  if (hasInnerArea) {
    const rotRad = (params.holeRotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    // Döndürme dahil tüm alanı kapsayacak tarama yarıçapı
    const maxRadius = Math.hypot(innerW * 0.5, innerD * 0.5) + holeSize;
    const pitch = holeSize + wallSpacing;

    const candidates: Array<{ x: number; y: number }> = [];

    if (params.holeType === 'square') {
      const steps = Math.ceil(maxRadius / pitch) + 1;
      for (let iy = -steps; iy <= steps; iy++) {
        for (let ix = -steps; ix <= steps; ix++) {
          const lx = ix * pitch;
          const ly = iy * pitch;
          const rx = lx * cosR - ly * sinR;
          const ry = lx * sinR + ly * cosR;
          candidates.push({ x: rx, y: ry });
        }
      }
    } else {
      // Altıgen (bal peteği) ve daire için sıkı altıgen örgü (eşit duvar kalınlığı)
      const dx = pitch;
      const dy = pitch * (Math.sqrt(3) / 2);
      const stepsX = Math.ceil(maxRadius / dx) + 1;
      const stepsY = Math.ceil(maxRadius / dy) + 1;

      for (let iy = -stepsY; iy <= stepsY; iy++) {
        const xOffset = Math.abs(iy) % 2 === 1 ? dx * 0.5 : 0;
        for (let ix = -stepsX; ix <= stepsX; ix++) {
          const lx = ix * dx + xOffset;
          const ly = iy * dy;
          const rx = lx * cosR - ly * sinR;
          const ry = lx * sinR + ly * cosR;
          candidates.push({ x: rx, y: ry });
        }
      }
    }

    // Merkeze yakın delikleri önceliklendir
    candidates.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));

    const circleHoleSegs = holeSize < 5 ? 16 : holeSize < 12 ? 20 : 24;
    const hexCircumR = holeSize / Math.sqrt(3);
    const squareCircumR = holeSize / Math.SQRT2;
    const borderMargin = Math.max(0.3, Math.min(0.6, wallSpacing * 0.35));

    for (const c of candidates) {
      if (holeRingsCW.length >= MAX_HOLES) {
        warnings.push(
          `Performans için maksimum ${MAX_HOLES} delik sınırına ulaşıldı. Daha büyük delik boyutu seçebilirsiniz.`
        );
        break;
      }

      // Hızlı sınır kutusu elemesi
      if (
        Math.abs(c.x) > innerW * 0.5 ||
        Math.abs(c.y) > innerD * 0.5
      ) {
        continue;
      }

      let hole: Point2D[];
      if (params.holeType === 'hexagon') {
        // Pointy-top (PI/6) -> yatay ve çapraz komşularda tam eşit duvar kalınlığı
        hole = createRegularPolygonRing(
          c.x,
          c.y,
          hexCircumR,
          6,
          Math.PI / 6 + rotRad,
          false
        );
      } else if (params.holeType === 'square') {
        hole = createRegularPolygonRing(
          c.x,
          c.y,
          squareCircumR,
          4,
          Math.PI / 4 + rotRad,
          false
        );
      } else {
        hole = createCircleRing(
          c.x,
          c.y,
          holeSize * 0.5,
          circleHoleSegs,
          false,
          rotRad
        );
      }

      if (isRingStrictlyInside(hole, innerRimCCW, borderMargin)) {
        holeRingsCW.push(ensureCW(hole));
      }
    }
  }

  if (holeRingsCW.length === 0) {
    warnings.push(
      'Mevcut boyutlarda çerçeve içine sığan delik oluşmadı. Delik boyutunu veya çerçeve genişliğini azaltın.'
    );
  }

  const builder = new ManifoldMeshBuilder();
  const hasRaisedRim = rimHeight > thickness + 0.05 && innerW > 2 && innerD > 2;

  if (hasRaisedRim) {
    const innerRimCW = ensureCW(innerRimCCW);
    const outer = ensureCCW(outerCCW);

    // 1. Taban yüzeyi (z = 0, normal -Z)
    builder.addPlanarFace(outer, holeRingsCW, 0, false);

    // 2. Dış silindir/prizma duvarı (0 .. rimHeight)
    builder.addWallStrip(outer, 0, rimHeight);

    // 3. Yükseltilmiş çerçeve üst halkası (z = rimHeight, normal +Z)
    builder.addPlanarFace(outer, [innerRimCW], rimHeight, true);

    // 4. Çerçeve iç duvarı (thickness .. rimHeight)
    builder.addWallStrip(innerRimCW, thickness, rimHeight);

    // 5. Elek iç taban üst yüzeyi (z = thickness, normal +Z)
    builder.addPlanarFace(ensureCCW(innerRimCCW), holeRingsCW, thickness, true);

    // 6. Tüm delik duvarları (0 .. thickness)
    for (const h of holeRingsCW) {
      builder.addWallStrip(h, 0, thickness);
    }
  } else {
    // Düz elek / koruyucu ızgara (tek katman ekstrüzyon)
    builder.addExtrudedRegion(outerCCW, holeRingsCW, 0, thickness);
  }

  return {
    geometry: builder.toBufferGeometry(),
    warnings,
    holeCount: holeRingsCW.length,
  };
}
