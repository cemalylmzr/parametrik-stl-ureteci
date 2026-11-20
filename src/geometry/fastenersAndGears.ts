import { FastenerParams, GeometryResult } from './types';
import {
  ManifoldMeshBuilder,
  Point2D,
  createCircleRing,
  createDShaftRing,
  createKnurledRing,
  createRegularPolygonRing,
  createRoundedRectRing,
  ensureCCW,
  ensureCW,
  isRingStrictlyInside,
} from './manifoldBuilder';

/**
 * Bir cıvata veya somunun dış profilini oluşturur (hex / square / round / knurled).
 */
function makeNutOuterRing(
  cx: number,
  cy: number,
  shape: 'hex' | 'square' | 'round',
  outerSize: number,
  ccw = true
): Point2D[] {
  if (shape === 'hex') {
    const circumR = outerSize / Math.sqrt(3);
    return createRegularPolygonRing(cx, cy, circumR, 6, 0, ccw);
  }
  if (shape === 'square') {
    return createRoundedRectRing(
      cx,
      cy,
      outerSize,
      outerSize,
      Math.min(1.5, outerSize * 0.08),
      4,
      ccw
    );
  }
  return createCircleRing(cx, cy, outerSize * 0.5, 48, ccw);
}

/**
 * Tek parça watertight somun / cıvata deliği bloğu ekler.
 */
function addNutBody(
  builder: ManifoldMeshBuilder,
  cx: number,
  cy: number,
  shape: 'hex' | 'square' | 'round',
  outerSize: number,
  height: number,
  threadDiameter: number,
  threadPitch: number,
  threadTolerance: number,
  warnings: string[]
): void {
  const safePitch = Math.max(0.8, threadPitch);
  const safeHeight = Math.max(safePitch * 1.5, height);
  const minOuter = threadDiameter + threadTolerance * 2 + 2.8;
  const safeOuter = Math.max(minOuter, outerSize);

  if (outerSize < minOuter - 0.05) {
    warnings.push(
      `Somun/blok dış ölçüsü diş duvar kalınlığını korumak için ${minOuter.toFixed(1)} mm olarak genişletildi.`
    );
  }

  const radialSegs = threadDiameter >= 16 ? 44 : 36;
  const thread = builder.addHelicalThreadWall({
    cx,
    cy,
    zBottom: 0,
    zTop: safeHeight,
    nominalDiameter: threadDiameter,
    pitch: safePitch,
    internal: true,
    tolerance: threadTolerance,
    radialSegments: radialSegs,
    stepsPerPitch: 8,
    taperRatio: 0.35,
  });

  const outerCCW = makeNutOuterRing(cx, cy, shape, safeOuter, true);
  const wallGap = safeOuter * 0.5 - thread.rMajor;
  const chamfer =
    shape !== 'square' && wallGap > 1.2
      ? Math.min(0.6, wallGap * 0.3, safeHeight * 0.15)
      : 0;

  if (chamfer > 0.08) {
    const chamferCCW = makeNutOuterRing(
      cx,
      cy,
      shape,
      safeOuter - 2 * chamfer,
      true
    );
    builder.addPlanarFace(chamferCCW, [thread.bottomRing], 0, false);
    builder.addLoftStrip(chamferCCW, 0, outerCCW, chamfer);
    builder.addWallStrip(outerCCW, chamfer, safeHeight - chamfer);
    builder.addLoftStrip(outerCCW, safeHeight - chamfer, chamferCCW, safeHeight);
    builder.addPlanarFace(chamferCCW, [thread.topRing], safeHeight, true);
  } else {
    builder.addPlanarFace(outerCCW, [thread.bottomRing], 0, false);
    builder.addWallStrip(outerCCW, 0, safeHeight);
    builder.addPlanarFace(outerCCW, [thread.topRing], safeHeight, true);
  }
}

/**
 * 1. CIVATA (BOLT) + Opsiyonel Uyumlu Somun
 */
function generateBolt(params: FastenerParams): GeometryResult {
  const warnings: string[] = [];
  const builder = new ManifoldMeshBuilder();

  const nomD = Math.max(5, params.threadDiameter);
  const pitch = Math.max(0.8, Math.min(params.threadPitch, nomD * 0.35));
  const headH = Math.max(2.5, params.boltHeadHeight);
  const minHeadSize = nomD + 3.0;
  const headSize = Math.max(minHeadSize, params.boltHeadSize);
  const shaftLen = Math.max(pitch * 2.5, params.boltShaftLength);
  const unthreadedLen = Math.max(
    0,
    Math.min(params.boltUnthreadedLength, shaftLen - pitch * 2)
  );

  if (params.boltHeadSize < minHeadSize - 0.05) {
    warnings.push(
      `Cıvata başı ölçüsü gövdeden büyük olması için ${minHeadSize.toFixed(1)} mm olarak ayarlandı.`
    );
  }

  const nutSize = Math.max(nomD + params.threadTolerance * 2 + 2.8, params.nutOuterSize);
  const gap = 10;
  const boltCx = params.boltIncludeNut ? -(headSize * 0.5 + gap * 0.5) : 0;
  const nutCx = params.boltIncludeNut ? +(nutSize * 0.5 + gap * 0.5) : 0;

  const radialSegs = nomD >= 16 ? 44 : 36;

  // Cıvata baş profili (desteksiz baskı için baş z = 0'a oturur)
  const makeHeadProfile = (size: number): Point2D[] => {
    if (params.boltHeadType === 'hex') {
      return createRegularPolygonRing(boltCx, 0, size / Math.sqrt(3), 6, 0, true);
    }
    if (params.boltHeadType === 'knurled') {
      const ribs = Math.max(16, Math.round(size * 1.1));
      return createKnurledRing(boltCx, 0, size * 0.5, ribs, Math.min(0.9, size * 0.045), true);
    }
    return createCircleRing(boltCx, 0, size * 0.5, 48, true);
  };

  const headCCW = makeHeadProfile(headSize);
  const headChamfer =
    params.boltHeadType === 'knurled'
      ? 0
      : Math.min(0.6, (headSize - nomD) * 0.25, headH * 0.18);

  // Alyan (socket) baş tipinde tabanda altıgen alyan yuvası aç
  const socketEnabled = params.boltHeadType === 'socket' && headH >= 4.0;
  const socketAF = Math.max(3.0, Math.min(nomD * 0.65, headSize * 0.52));
  const socketDepth = Math.min(headH * 0.62, headH - 1.4);
  const socketCW = socketEnabled
    ? createRegularPolygonRing(boltCx, 0, socketAF / Math.sqrt(3), 6, 0, false)
    : null;

  // Baş tabanı ve dış duvarı (0 .. headH)
  if (headChamfer > 0.08) {
    const headBotCCW = makeHeadProfile(headSize - 2 * headChamfer);
    builder.addPlanarFace(headBotCCW, socketCW ? [socketCW] : [], 0, false);
    builder.addLoftStrip(headBotCCW, 0, headCCW, headChamfer);
    builder.addWallStrip(headCCW, headChamfer, headH);
  } else {
    builder.addPlanarFace(headCCW, socketCW ? [socketCW] : [], 0, false);
    builder.addWallStrip(headCCW, 0, headH);
  }

  if (socketCW) {
    builder.addWallStrip(socketCW, 0, socketDepth);
    builder.addPlanarFace(ensureCCW(socketCW), [], socketDepth, false);
  }

  // Helisel vida gövdesi (zThreadStart .. zTipStart)
  const tipChamfer = Math.min(0.7, nomD * 0.08, pitch * 0.45);
  const zTipTop = headH + shaftLen;
  const zThreadTop = zTipTop - tipChamfer;
  const zShankEnd = headH + unthreadedLen;

  const thread = builder.addHelicalThreadWall({
    cx: boltCx,
    cy: 0,
    zBottom: zShankEnd,
    zTop: zThreadTop,
    nominalDiameter: nomD,
    pitch,
    internal: false,
    radialSegments: radialSegs,
    stepsPerPitch: 8,
    taperRatio: 0.4,
  });

  if (unthreadedLen > 0.4) {
    // Düz (dişsiz) boyun + baş üst omzu + dişe yumuşak 45° geçiş
    const shankCCW = createCircleRing(boltCx, 0, nomD * 0.5, radialSegs, true, 0);
    const transitionH = Math.min(0.45, unthreadedLen * 0.35);
    const zTransBot = zShankEnd - transitionH;

    builder.addPlanarFace(headCCW, [ensureCW(shankCCW)], headH, true);
    builder.addWallStrip(shankCCW, headH, zTransBot);
    builder.addLoftStrip(shankCCW, zTransBot, thread.bottomRing, zShankEnd);
  } else {
    // Doğrudan baştan başlayan tam dişli cıvata
    builder.addPlanarFace(headCCW, [ensureCW(thread.bottomRing)], headH, true);
  }

  // Cıvata ucu pahı (kolay takma için 45° uç koniği)
  const tipRadius = Math.max(0.6, thread.rMinor - tipChamfer * 0.85);
  const tipRingCCW = createCircleRing(boltCx, 0, tipRadius, radialSegs, true, 0);
  builder.addLoftStrip(thread.topRing, zThreadTop, tipRingCCW, zTipTop);
  builder.addPlanarFace(tipRingCCW, [], zTipTop, true);

  // Opsiyonel: Yanında uyumlu somun üret
  if (params.boltIncludeNut) {
    addNutBody(
      builder,
      nutCx,
      0,
      params.nutShape,
      nutSize,
      params.nutHeight,
      nomD,
      pitch,
      params.threadTolerance,
      warnings
    );
  }

  return {
    geometry: builder.toBufferGeometry(),
    warnings,
    holeCount: params.boltIncludeNut ? 1 : 0,
  };
}

/**
 * 2. CIVATA DELİĞİ / SOMUN (NUT / THREADED BLOCK)
 */
function generateNut(params: FastenerParams): GeometryResult {
  const warnings: string[] = [];
  const builder = new ManifoldMeshBuilder();

  addNutBody(
    builder,
    0,
    0,
    params.nutShape,
    params.nutOuterSize,
    params.nutHeight,
    Math.max(5, params.threadDiameter),
    Math.max(0.8, params.threadPitch),
    params.threadTolerance,
    warnings
  );

  return {
    geometry: builder.toBufferGeometry(),
    warnings,
    holeCount: 1,
  };
}

/**
 * 3. DİŞLİ KAPAK & KAVANOZ (THREADED JAR & SCREW-ON CAP)
 * Gövde dik, kapak ise desteksiz baskı için ters (tavan z = 0) konumda üretilir.
 */
function generateThreadedCap(params: FastenerParams): GeometryResult {
  const warnings: string[] = [];
  const builder = new ManifoldMeshBuilder();

  const jarD = Math.max(20, params.jarDiameter);
  const wall = Math.max(1.6, Math.min(params.jarWallThickness, jarD * 0.18));
  const pitch = Math.max(1.5, Math.min(params.jarThreadPitch, 5.0));
  const threadH = Math.max(pitch * 2.0, Math.min(params.jarThreadHeight, params.jarHeight - 6));
  const jarH = Math.max(threadH + 6, params.jarHeight);
  const tol = Math.max(0.15, Math.min(0.8, params.jarThreadTolerance));
  const capTopT = Math.max(1.6, params.capTopThickness);

  const threadDepth = Math.min(0.54 * pitch, jarD * 0.22);
  const jarOuterR = jarD * 0.5;
  const jarMinorR = Math.max(4, jarOuterR - threadDepth);
  const jarInnerR = Math.max(3, jarMinorR - wall);

  const capThreadMajorR = jarOuterR + tol;
  const capOuterR = capThreadMajorR + wall;
  const capTotalH = capTopT + threadH + 1.0;

  if (jarInnerR <= 3.5) {
    warnings.push('Kavanoz duvarı çapa göre kalın; iç hacim daraldı.');
  }

  const gap = 12;
  const jarCx = params.capMode === 'both' ? -(jarOuterR + gap * 0.5) : 0;
  const capCx = params.capMode === 'both' ? +(capOuterR + gap * 0.5) : 0;
  const radialSegs = jarD >= 50 ? 48 : 40;

  // === GÖVDE (DIŞ DİŞLİ KAVANOZ / KUTU) ===
  if (params.capMode === 'body' || params.capMode === 'both') {
    const zThreadStart = jarH - threadH;
    const zTransBot = Math.max(wall + 1, zThreadStart - 0.6);

    const bodyOuterCCW = createCircleRing(jarCx, 0, jarOuterR, radialSegs, true, 0);
    const innerCavityCCW = createCircleRing(jarCx, 0, jarInnerR, radialSegs, true, 0);
    const innerCavityCW = ensureCW(innerCavityCCW);

    const thread = builder.addHelicalThreadWall({
      cx: jarCx,
      cy: 0,
      zBottom: zThreadStart,
      zTop: jarH,
      nominalDiameter: jarD,
      pitch,
      internal: false,
      radialSegments: radialSegs,
      stepsPerPitch: 8,
      taperRatio: 0.35,
    });

    // Taban (z = 0) ve alt gövde duvarı
    builder.addPlanarFace(bodyOuterCCW, [], 0, false);
    builder.addWallStrip(bodyOuterCCW, 0, zTransBot);
    // Gövdeden diş tabanına yumuşak geçiş (overhang yok)
    builder.addLoftStrip(bodyOuterCCW, zTransBot, thread.bottomRing, zThreadStart);
    // Üst ağız halkası (z = jarH)
    builder.addPlanarFace(thread.topRing, [innerCavityCW], jarH, true);
    // İç duvar ve iç taban
    builder.addWallStrip(innerCavityCW, wall, jarH);
    builder.addPlanarFace(innerCavityCCW, [], wall, true);
  }

  // === DİŞLİ KAPAK (İÇ DİŞLİ, TERS BASKI KONUMUNDA) ===
  if (params.capMode === 'cap' || params.capMode === 'both') {
    const ribCount = Math.max(24, Math.round(capOuterR * 1.4));
    const capOuterCCW = params.capKnurling
      ? createKnurledRing(capCx, 0, capOuterR + 0.6, ribCount, 0.75, true)
      : createCircleRing(capCx, 0, capOuterR, 64, true, 0);

    const capThread = builder.addHelicalThreadWall({
      cx: capCx,
      cy: 0,
      zBottom: capTopT,
      zTop: capTotalH,
      nominalDiameter: jarD,
      pitch,
      internal: true,
      tolerance: tol,
      radialSegments: radialSegs,
      stepsPerPitch: 8,
      taperRatio: 0.35,
    });

    // Kapak dış alt yüzü (z = 0, baskı tablasına düz oturur)
    builder.addPlanarFace(capOuterCCW, [], 0, false);
    // Kapak dış duvarı (0 .. capTotalH)
    builder.addWallStrip(capOuterCCW, 0, capTotalH);
    // Kapak üst kenar çeperi (z = capTotalH)
    builder.addPlanarFace(capOuterCCW, [capThread.topRing], capTotalH, true);
    // Kapak iç tavanı (z = capTopT)
    builder.addPlanarFace(ensureCCW(capThread.bottomRing), [], capTopT, true);
  }

  return {
    geometry: builder.toBufferGeometry(),
    warnings,
    holeCount: 1,
  };
}

/**
 * Gerçek evolvent (involute) profilli düz dişli çark (spur gear) dış konturu üretir.
 */
function createInvoluteGearRing(
  teeth: number,
  moduleMm: number,
  pressureAngleDeg: number,
  backlashMm: number
): Point2D[] {
  const z = Math.max(6, Math.round(teeth));
  const m = Math.max(0.8, moduleMm);
  const alpha = (Math.max(14, Math.min(28, pressureAngleDeg)) * Math.PI) / 180;

  const rp = (m * z) * 0.5;
  const rb = rp * Math.cos(alpha);
  const ra = rp + m;
  const rf = Math.max(1.5, rp - 1.25 * m);

  const inv = (r: number): number => {
    if (r <= rb) return 0;
    const phi = Math.acos(Math.max(-1, Math.min(1, rb / r)));
    return Math.tan(phi) - phi;
  };

  const halfToothPitchAngle = Math.max(
    0.02,
    Math.PI / (2 * z) - backlashMm / (2 * rp)
  );
  const halfToothBaseAngle = halfToothPitchAngle + inv(rp);
  const invStartR = Math.max(rb, rf);
  const flankSteps = 5;

  const ring: Point2D[] = [];

  for (let i = 0; i < z; i++) {
    const centerAngle = (i / z) * Math.PI * 2;
    const halfPitchSlot = Math.PI / z;

    // 1. Kök başlangıcı (sol vadi ortası -> diş tabanı)
    const rootAngleLeft = centerAngle - halfPitchSlot * 0.72;
    ring.push([Math.cos(rootAngleLeft) * rf, Math.sin(rootAngleLeft) * rf]);

    // 2. Kök çemberinden taban çemberine dik/radyal geçiş
    if (rf < rb) {
      const baseLeftAngle = centerAngle - halfToothBaseAngle;
      if (baseLeftAngle > rootAngleLeft + 1e-4) {
        ring.push([Math.cos(baseLeftAngle) * rf, Math.sin(baseLeftAngle) * rf]);
      }
    }

    // 3. Sol evolvent profil (invStartR -> ra)
    for (let s = 0; s <= flankSteps; s++) {
      const r = invStartR + (s / flankSteps) * (ra - invStartR);
      const a = centerAngle - (halfToothBaseAngle - inv(r));
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }

    // 4. Diş ucu yayı (orta nokta)
    ring.push([Math.cos(centerAngle) * ra, Math.sin(centerAngle) * ra]);

    // 5. Sağ evolvent profil (ra -> invStartR)
    for (let s = flankSteps; s >= 0; s--) {
      const r = invStartR + (s / flankSteps) * (ra - invStartR);
      const a = centerAngle + (halfToothBaseAngle - inv(r));
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }

    // 6. Taban çemberinden kök çemberine geçiş
    const rootAngleRight = centerAngle + halfPitchSlot * 0.72;
    if (rf < rb) {
      const baseRightAngle = centerAngle + halfToothBaseAngle;
      if (rootAngleRight > baseRightAngle + 1e-4) {
        ring.push([Math.cos(baseRightAngle) * rf, Math.sin(baseRightAngle) * rf]);
      }
    }

    ring.push([Math.cos(rootAngleRight) * rf, Math.sin(rootAngleRight) * rf]);
  }

  return ensureCCW(ring);
}

/**
 * 4. DİŞLİ ÇARK (INVOLUTE SPUR GEAR)
 */
function generateSpurGear(params: FastenerParams): GeometryResult {
  const warnings: string[] = [];
  const builder = new ManifoldMeshBuilder();

  const z = Math.max(8, Math.min(64, Math.round(params.gearTeeth)));
  const m = Math.max(1.0, Math.min(5.0, params.gearModule));
  const thickness = Math.max(2.0, params.gearThickness);
  const rootRadius = Math.max(2.0, (m * z) * 0.5 - 1.25 * m);

  const gearCCW = createInvoluteGearRing(
    z,
    m,
    params.gearPressureAngle,
    Math.max(0, Math.min(0.6, params.gearBacklash))
  );

  // Merkez mil deliği
  let boreCW: Point2D[] | null = null;
  if (params.gearBoreDiameter >= 2.0) {
    const maxBoreD = Math.max(2.0, rootRadius * 1.45);
    const boreD = Math.min(params.gearBoreDiameter, maxBoreD);
    if (params.gearBoreDiameter > maxBoreD + 0.1) {
      warnings.push(
        `Mil deliği diş kökünü korumak için ${maxBoreD.toFixed(1)} mm ile sınırlandı.`
      );
    }

    let candidate: Point2D[];
    if (params.gearBoreShape === 'hex') {
      candidate = createRegularPolygonRing(0, 0, boreD / Math.sqrt(3), 6, 0, false);
    } else if (params.gearBoreShape === 'd-shaft') {
      candidate = createDShaftRing(0, 0, boreD, 0.14, 36, false);
    } else {
      candidate = createCircleRing(0, 0, boreD * 0.5, 40, false);
    }

    if (isRingStrictlyInside(candidate, gearCCW, 0.8)) {
      boreCW = ensureCW(candidate);
    } else {
      warnings.push('Mil deliği dişli kök dairesine çok yakın olduğu için eklenmedi.');
    }
  }

  // Opsiyonel yükseltilmiş merkez göbek (hub)
  const hubHeight = Math.max(0, params.gearHubHeight);
  const maxHubD = rootRadius * 1.85;
  const minHubD = boreCW ? params.gearBoreDiameter + 2.8 : 6;
  const hubD = Math.min(maxHubD, Math.max(minHubD, params.gearHubDiameter));
  const hubCandidate =
    params.gearHubEnabled && hubHeight >= 0.6 && hubD <= maxHubD
      ? createCircleRing(0, 0, hubD * 0.5, 48, true)
      : null;

  const validHubCCW =
    hubCandidate &&
    isRingStrictlyInside(hubCandidate, gearCCW, 0.6) &&
    (!boreCW || isRingStrictlyInside(boreCW, hubCandidate, 0.8))
      ? hubCandidate
      : null;

  if (params.gearHubEnabled && !validHubCCW && hubHeight >= 0.6) {
    warnings.push(
      'Göbek çapı diş kökünden büyük veya mil deliğine çok yakın olduğu için göbek atlandı.'
    );
  }

  const holes = boreCW ? [boreCW] : [];

  if (validHubCCW) {
    const zHubTop = thickness + hubHeight;
    const hubCW = ensureCW(validHubCCW);

    // 1. Alt yüz (z = 0)
    builder.addPlanarFace(gearCCW, holes, 0, false);
    // 2. Dişli dış duvarı (0 .. thickness)
    builder.addWallStrip(gearCCW, 0, thickness);
    // 3. Dişli üst yüzü (göbek tabanı boşluklu, sıfır iç yüzey)
    builder.addPlanarFace(gearCCW, [hubCW], thickness, true);
    // 4. Göbek dış duvarı (thickness .. zHubTop)
    builder.addWallStrip(validHubCCW, thickness, zHubTop);
    // 5. Göbek üst yüzü (z = zHubTop)
    builder.addPlanarFace(validHubCCW, holes, zHubTop, true);
    // 6. Merkez mil deliği (0 .. zHubTop)
    if (boreCW) {
      builder.addWallStrip(boreCW, 0, zHubTop);
    }
  } else {
    builder.addExtrudedRegion(gearCCW, holes, 0, thickness);
  }

  return {
    geometry: builder.toBufferGeometry(),
    warnings,
    holeCount: boreCW ? 1 : 0,
  };
}

export function generateFastenerOrGear(params: FastenerParams): GeometryResult {
  if (params.mode === 'bolt') return generateBolt(params);
  if (params.mode === 'nut') return generateNut(params);
  if (params.mode === 'threadedCap') return generateThreadedCap(params);
  return generateSpurGear(params);
}
