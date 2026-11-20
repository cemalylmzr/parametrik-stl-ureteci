import { MountingPlateParams, GeometryResult } from './types';
import {
  ManifoldMeshBuilder,
  Point2D,
  createCircleRing,
  createRegularPolygonRing,
  createRoundedRectRing,
  ensureCCW,
  ensureCW,
  isRingStrictlyInside,
  minDistPointToRing,
  pointInRing,
} from './manifoldBuilder';

function ringsOverlapOrTooClose(
  a: Point2D[],
  b: Point2D[],
  minGap = 0.4
): boolean {
  for (const p of a) {
    if (pointInRing(p, b) || minDistPointToRing(p, b) < minGap) return true;
  }
  for (const p of b) {
    if (pointInRing(p, a) || minDistPointToRing(p, a) < minGap) return true;
  }
  return false;
}

function generateSpacer(params: MountingPlateParams): GeometryResult {
  const warnings: string[] = [];

  const outerD = Math.max(5, params.outerDiameter);
  const useThread = params.spacerThreaded && params.spacerHeight >= 3.0;
  const threadTol = useThread ? Math.max(0.1, params.threadTolerance) : 0;
  const maxInnerD = Math.max(
    1.5,
    outerD - 1.6 - (useThread ? threadTol * 2 + 0.6 : 0)
  );
  const innerD = Math.max(1.5, Math.min(params.innerDiameter, maxInnerD));
  const height = Math.max(2, params.spacerHeight);

  if (params.innerDiameter > maxInnerD) {
    warnings.push(
      `İç delik çapı minimum duvar kalınlığı için ${maxInnerD.toFixed(1)} mm ile sınırlandı.`
    );
  }

  const effectiveBoreOuterD = useThread ? innerD + threadTol * 2 : innerD;
  const wallThickness = (outerD - effectiveBoreOuterD) * 0.5;
  const flangeEnabled =
    params.flangeEnabled &&
    params.flangeDiameter > outerD + 1.2 &&
    params.flangeHeight >= 0.8 &&
    params.flangeHeight < height - 0.8;

  const flangeD = flangeEnabled ? params.flangeDiameter : outerD;
  const flangeH = flangeEnabled ? params.flangeHeight : 0;

  // Pah (elephant-foot telafisi ve montaj kolaylığı)
  const maxChamfer = Math.min(
    Math.max(0, wallThickness * 0.4),
    (height - flangeH) * 0.3,
    flangeEnabled ? flangeH * 0.35 : height * 0.3
  );
  const chamfer = Math.max(0, Math.min(params.chamfer, maxChamfer));

  const makeOuterProfile = (diameter: number, ccw: boolean): Point2D[] => {
    if (params.spacerShape === 'hexagon') {
      // Metrik anahtar ağzı ölçüsü (across-flats = diameter)
      const circumR = diameter / Math.sqrt(3);
      return createRegularPolygonRing(0, 0, circumR, 6, 0, ccw);
    }
    return createCircleRing(0, 0, diameter * 0.5, 64, ccw);
  };

  const builder = new ManifoldMeshBuilder();

  let boreBottomCW: Point2D[];
  let boreTopCW: Point2D[];
  if (useThread) {
    const pitch = Math.max(0.8, Math.min(params.threadPitch, innerD * 0.35));
    const thread = builder.addHelicalThreadWall({
      cx: 0,
      cy: 0,
      zBottom: 0,
      zTop: height,
      nominalDiameter: innerD,
      pitch,
      internal: true,
      tolerance: threadTol,
      radialSegments: innerD >= 14 ? 40 : 32,
      stepsPerPitch: 8,
      taperRatio: 0.35,
    });
    boreBottomCW = thread.bottomRing;
    boreTopCW = thread.topRing;
  } else {
    const plainBoreCW = createCircleRing(0, 0, innerD * 0.5, 48, false);
    boreBottomCW = plainBoreCW;
    boreTopCW = plainBoreCW;
  }

  const bodyOuterCCW = makeOuterProfile(outerD, true);
  const bodyOuterTopChamferCCW =
    chamfer > 0.05 ? makeOuterProfile(outerD - 2 * chamfer, true) : bodyOuterCCW;

  if (flangeEnabled) {
    const flangeCCW = makeOuterProfile(flangeD, true);
    const flangeBotChamferCCW =
      chamfer > 0.05 ? makeOuterProfile(flangeD - 2 * chamfer, true) : flangeCCW;

    // 1. Alt taban (z = 0)
    builder.addPlanarFace(flangeBotChamferCCW, [boreBottomCW], 0, false);

    // 2. Flanş dış duvarı (alt pah dahil)
    if (chamfer > 0.05) {
      builder.addLoftStrip(flangeBotChamferCCW, 0, flangeCCW, chamfer);
      builder.addWallStrip(flangeCCW, chamfer, flangeH);
    } else {
      builder.addWallStrip(flangeCCW, 0, flangeH);
    }

    // 3. Flanş üst omzu (z = flangeH)
    builder.addPlanarFace(flangeCCW, [ensureCW(bodyOuterCCW)], flangeH, true);

    // 4. Gövde dış duvarı (flangeH .. height, üst pah dahil)
    if (chamfer > 0.05) {
      builder.addWallStrip(bodyOuterCCW, flangeH, height - chamfer);
      builder.addLoftStrip(
        bodyOuterCCW,
        height - chamfer,
        bodyOuterTopChamferCCW,
        height
      );
    } else {
      builder.addWallStrip(bodyOuterCCW, flangeH, height);
    }

    // 5. Üst yüz (z = height)
    builder.addPlanarFace(bodyOuterTopChamferCCW, [boreTopCW], height, true);

    // 6. İç delik duvarı (düz ise ekle; dişli ise helisel duvar zaten eklendi)
    if (!useThread) {
      builder.addWallStrip(boreBottomCW, 0, height);
    }
  } else {
    const bodyBotChamferCCW =
      chamfer > 0.05 ? makeOuterProfile(outerD - 2 * chamfer, true) : bodyOuterCCW;

    // Alt yüz (z = 0)
    builder.addPlanarFace(bodyBotChamferCCW, [boreBottomCW], 0, false);

    // Dış duvar + alt/üst pah
    if (chamfer > 0.05) {
      builder.addLoftStrip(bodyBotChamferCCW, 0, bodyOuterCCW, chamfer);
      builder.addWallStrip(bodyOuterCCW, chamfer, height - chamfer);
      builder.addLoftStrip(
        bodyOuterCCW,
        height - chamfer,
        bodyOuterTopChamferCCW,
        height
      );
    } else {
      builder.addWallStrip(bodyOuterCCW, 0, height);
    }

    // Üst yüz (z = height)
    builder.addPlanarFace(bodyOuterTopChamferCCW, [boreTopCW], height, true);

    // İç delik duvarı (düz ise ekle; dişli ise helisel duvar zaten eklendi)
    if (!useThread) {
      builder.addWallStrip(boreBottomCW, 0, height);
    }
  }

  return {
    geometry: builder.toBufferGeometry(),
    warnings,
    holeCount: 1,
  };
}

export function generateMountingPlate(
  params: MountingPlateParams
): GeometryResult {
  if (params.mode === 'spacer') {
    return generateSpacer(params);
  }

  const warnings: string[] = [];

  const width = Math.max(16, params.width);
  const depth = Math.max(16, params.depth);
  const thickness = Math.max(1.2, params.thickness);
  const cornerRadius = Math.max(
    0,
    Math.min(params.cornerRadius, Math.min(width, depth) * 0.48)
  );

  const outerCCW = createRoundedRectRing(
    0,
    0,
    width,
    depth,
    cornerRadius,
    10,
    true
  );

  // Opsiyonel merkez açıklığı (fan / motor / kablo penceresi)
  let centerCutoutCCW: Point2D[] | null = null;
  if (params.centerCutout === 'circle') {
    const maxD = Math.min(width, depth) - 4;
    const d = Math.max(3, Math.min(params.centerCutoutWidth, maxD));
    const candidate = createCircleRing(0, 0, d * 0.5, 48, true);
    if (isRingStrictlyInside(candidate, outerCCW, 1.2)) {
      centerCutoutCCW = candidate;
    } else {
      warnings.push('Merkez dairesel açıklık plaka sınırına çok yakın olduğu için atlandı.');
    }
  } else if (params.centerCutout === 'rectangle') {
    const cw = Math.max(3, Math.min(params.centerCutoutWidth, width - 4));
    const cd = Math.max(3, Math.min(params.centerCutoutDepth, depth - 4));
    const candidate = createRoundedRectRing(
      0,
      0,
      cw,
      cd,
      Math.min(3, Math.min(cw, cd) * 0.2),
      6,
      true
    );
    if (isRingStrictlyInside(candidate, outerCCW, 1.2)) {
      centerCutoutCCW = candidate;
    } else {
      warnings.push('Merkez dikdörtgen açıklık plaka sınırına çok yakın olduğu için atlandı.');
    }
  }

  // Montaj vida delikleri
  const holeDia = Math.max(1.5, params.holeDiameter);
  const dx = Math.max(0, width * 0.5 - params.holeInsetX);
  const dy = Math.max(0, depth * 0.5 - params.holeInsetY);

  const rawCenters: Point2D[] = [];
  if (params.holeCount === '4-corners') {
    rawCenters.push([-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]);
  } else if (params.holeCount === '2-sides') {
    rawCenters.push([-dx, 0], [dx, 0]);
  }

  // Çakışmayan ve dış kenara taşmayan geçerli delik özelliklerini filtrele
  const cbDia = Math.max(holeDia + 0.8, params.counterboreDiameter);
  const cbDepth = Math.max(
    0.4,
    Math.min(params.counterboreDepth, thickness - 0.6)
  );
  const bossDia = Math.max(holeDia + 2.0, params.standoffOuterDiameter);
  const bossHeight = Math.max(1.0, params.standoffHeight);

  const threadTol = Math.max(0.1, params.threadTolerance);
  const effectiveOuterFeatureDia =
    params.holeStyle === 'counterbore'
      ? cbDia
      : params.holeStyle === 'standoff'
        ? bossDia
        : params.holeStyle === 'threaded'
          ? holeDia + threadTol * 2
          : holeDia;

  interface ValidHole {
    cx: number;
    cy: number;
    boltCW: Point2D[];
    featureCCW: Point2D[];
    featureCW: Point2D[];
  }

  const validHoles: ValidHole[] = [];
  const acceptedFeatureRings: Point2D[][] = [];

  for (const [cx, cy] of rawCenters) {
    const featureCCW = createCircleRing(
      cx,
      cy,
      effectiveOuterFeatureDia * 0.5,
      32,
      true
    );
    const boltCW = createCircleRing(cx, cy, holeDia * 0.5, 28, false);

    // Dış plaka konturu içinde mi?
    if (!isRingStrictlyInside(featureCCW, outerCCW, 0.5)) {
      warnings.push(
        'Bazı köşe delikleri/havşaları plaka dış kenarına veya köşe radyüsüne çok yakın olduğu için atlandı.'
      );
      continue;
    }

    // Merkez açıklıkla çakışıyor mu?
    if (
      centerCutoutCCW &&
      ringsOverlapOrTooClose(featureCCW, centerCutoutCCW, 0.6)
    ) {
      warnings.push(
        'Bazı montaj delikleri merkez açıklıkla çakıştığı için atlandı.'
      );
      continue;
    }

    // Diğer deliklerle çakışıyor mu?
    let overlapsSibling = false;
    for (const prev of acceptedFeatureRings) {
      if (ringsOverlapOrTooClose(featureCCW, prev, 0.5)) {
        overlapsSibling = true;
        break;
      }
    }
    if (overlapsSibling) {
      warnings.push('Birbirine çakışan montaj delikleri atlandı.');
      continue;
    }

    acceptedFeatureRings.push(featureCCW);
    validHoles.push({
      cx,
      cy,
      boltCW,
      featureCCW,
      featureCW: ensureCW(featureCCW),
    });
  }

  const uniqueWarnings = Array.from(new Set(warnings));
  const builder = new ManifoldMeshBuilder();

  const centerCW = centerCutoutCCW ? [ensureCW(centerCutoutCCW)] : [];
  const allBoltCW = validHoles.map((h) => h.boltCW);

  if (params.holeStyle === 'counterbore' && validHoles.length > 0 && thickness > 1.2) {
    const cbZ = thickness - cbDepth;
    const allCbCW = validHoles.map((h) => h.featureCW);

    // 1. Alt yüz (z = 0): vida delikleri + merkez açıklık
    builder.addPlanarFace(outerCCW, [...centerCW, ...allBoltCW], 0, false);

    // 2. Üst yüz (z = thickness): havşa delikleri + merkez açıklık
    builder.addPlanarFace(outerCCW, [...centerCW, ...allCbCW], thickness, true);

    // 3. Dış duvar ve merkez açıklık duvarı (0 .. thickness)
    builder.addWallStrip(outerCCW, 0, thickness);
    for (const c of centerCW) {
      builder.addWallStrip(c, 0, thickness);
    }

    // 4. Her vida için alt delik + havşa omzu + üst havşa duvarı
    for (const h of validHoles) {
      builder.addWallStrip(h.boltCW, 0, cbZ);
      builder.addPlanarFace(h.featureCCW, [h.boltCW], cbZ, true);
      builder.addWallStrip(h.featureCW, cbZ, thickness);
    }
  } else if (params.holeStyle === 'standoff' && validHoles.length > 0) {
    const zTop = thickness + bossHeight;
    const allBossCW = validHoles.map((h) => h.featureCW);

    // 1. Alt yüz (z = 0): vida delikleri + merkez açıklık
    builder.addPlanarFace(outerCCW, [...centerCW, ...allBoltCW], 0, false);

    // 2. Dış duvar ve merkez açıklık duvarı (0 .. thickness)
    builder.addWallStrip(outerCCW, 0, thickness);
    for (const c of centerCW) {
      builder.addWallStrip(c, 0, thickness);
    }

    // 3. Plaka üst yüzü (z = thickness): standoff tabanları boşluk bırakılır (sıfır iç yüzey!)
    builder.addPlanarFace(outerCCW, [...centerCW, ...allBossCW], thickness, true);

    // 4. Her standoff yükselticisi (thickness .. zTop) ve boydan boya vida deliği (0 .. zTop)
    for (const h of validHoles) {
      builder.addWallStrip(ensureCCW(h.featureCCW), thickness, zTop);
      builder.addPlanarFace(h.featureCCW, [h.boltCW], zTop, true);
      builder.addWallStrip(h.boltCW, 0, zTop);
    }
  } else if (params.holeStyle === 'threaded' && validHoles.length > 0) {
    // İç dişli cıvata delikleri (her köşe deliğinde helisel iç vida dişi)
    const pitch = Math.max(0.8, Math.min(params.threadPitch, holeDia * 0.35));
    const radialSegs = holeDia >= 10 ? 32 : 28;
    const threadBotCW: Point2D[][] = [];
    const threadTopCW: Point2D[][] = [];

    for (const h of validHoles) {
      const th = builder.addHelicalThreadWall({
        cx: h.cx,
        cy: h.cy,
        zBottom: 0,
        zTop: thickness,
        nominalDiameter: holeDia,
        pitch,
        internal: true,
        tolerance: threadTol,
        radialSegments: radialSegs,
        stepsPerPitch: 8,
        taperRatio: 0.35,
      });
      threadBotCW.push(th.bottomRing);
      threadTopCW.push(th.topRing);
    }

    builder.addPlanarFace(outerCCW, [...centerCW, ...threadBotCW], 0, false);
    builder.addPlanarFace(outerCCW, [...centerCW, ...threadTopCW], thickness, true);
    builder.addWallStrip(outerCCW, 0, thickness);
    for (const c of centerCW) {
      builder.addWallStrip(c, 0, thickness);
    }
  } else {
    // Düz delikli montaj plakası
    builder.addExtrudedRegion(outerCCW, [...centerCW, ...allBoltCW], 0, thickness);
  }

  return {
    geometry: builder.toBufferGeometry(),
    warnings: uniqueWarnings,
    holeCount: validHoles.length + (centerCutoutCCW ? 1 : 0),
  };
}
