import { ParametricBoxParams, GeometryResult } from './types';
import {
  ManifoldMeshBuilder,
  Point2D,
  createCircleRing,
  createRoundedRectRing,
  ensureCCW,
  ensureCW,
  isRingStrictlyInside,
} from './manifoldBuilder';
import { applyBoxCutoutsCSG } from './boxCutouts';

export function generateParametricBox(
  params: ParametricBoxParams
): GeometryResult {
  const warnings: string[] = [];

  const width = Math.max(20, params.width);
  const depth = Math.max(20, params.depth);
  const height = Math.max(8, params.height);
  const wall = Math.max(1.2, Math.min(params.wallThickness, Math.min(width, depth) * 0.25));
  const floor = Math.max(1.0, Math.min(params.floorThickness, height - 2));
  const cornerRadius = Math.max(
    0,
    Math.min(params.cornerRadius, Math.min(width, depth) * 0.45)
  );
  const lidThickness = Math.max(1.0, params.lidThickness);
  const lipTolerance = Math.max(0.05, Math.min(1.0, params.lipTolerance));
  const maxLipHeight = Math.max(0, height - floor - 1.0);
  const lipHeight = Math.max(0, Math.min(params.lipHeight, maxLipHeight));

  if (params.lipHeight > maxLipHeight && params.lidMode !== 'box') {
    warnings.push(
      `Kapak dudağı yüksekliği kutu iç derinliğine sığacak şekilde ${maxLipHeight.toFixed(1)} mm ile sınırlandı.`
    );
  }

  const innerW = width - 2 * wall;
  const innerD = depth - 2 * wall;
  const innerR = Math.max(0, cornerRadius - wall);

  const builder = new ManifoldMeshBuilder();

  // Baskı tablasında yan yana yerleşim (desteksiz baskı için kapak ters çevrilmiş durur)
  const gap = 12;
  const boxCenterX = params.lidMode === 'both' ? -(width * 0.5 + gap * 0.5) : 0;
  const lidCenterX = params.lidMode === 'both' ? +(width * 0.5 + gap * 0.5) : 0;

  let totalHoles = 0;

  // =========================
  // 1. KUTU GÖVDESİ (BOX)
  // =========================
  if (params.lidMode === 'box' || params.lidMode === 'both') {
    const outerCCW = createRoundedRectRing(
      boxCenterX,
      0,
      width,
      depth,
      cornerRadius,
      10,
      true
    );
    const innerCCW = createRoundedRectRing(
      boxCenterX,
      0,
      innerW,
      innerD,
      innerR,
      10,
      true
    );
    const innerCW = ensureCW(innerCCW);

    const floorHolesBotCW: Point2D[][] = [];
    const floorHolesTopCW: Point2D[][] = [];
    const plainFloorHolesCW: Point2D[][] = [];

    if (params.cableHoleDiameter >= 2) {
      const useThread =
        params.cableHoleThreaded &&
        params.cableHoleDiameter >= 4 &&
        floor >= 2.0;
      const checkDia = useThread
        ? params.cableHoleDiameter + params.cableHoleTolerance * 2
        : params.cableHoleDiameter;
      const cableCheckRing = createCircleRing(
        boxCenterX,
        0,
        checkDia * 0.5,
        32,
        false
      );

      if (isRingStrictlyInside(cableCheckRing, innerCCW, 1.5)) {
        if (useThread) {
          const pitch = Math.max(
            0.8,
            Math.min(params.cableHolePitch, params.cableHoleDiameter * 0.35)
          );
          const th = builder.addHelicalThreadWall({
            cx: boxCenterX,
            cy: 0,
            zBottom: 0,
            zTop: floor,
            nominalDiameter: params.cableHoleDiameter,
            pitch,
            internal: true,
            tolerance: params.cableHoleTolerance,
            radialSegments: 32,
            stepsPerPitch: 8,
            taperRatio: 0.35,
          });
          floorHolesBotCW.push(th.bottomRing);
          floorHolesTopCW.push(th.topRing);
        } else {
          floorHolesBotCW.push(cableCheckRing);
          floorHolesTopCW.push(cableCheckRing);
          plainFloorHolesCW.push(cableCheckRing);
        }
        totalHoles += 1;
      } else {
        warnings.push(
          'Kablo/cıvata deliği kutu iç tabanına sığmadığı için eklenmedi.'
        );
      }
    }

    // Taban dış yüzü (z = 0, normal -Z)
    builder.addPlanarFace(outerCCW, floorHolesBotCW, 0, false);
    // Dış yan duvarlar (0 .. height)
    builder.addWallStrip(outerCCW, 0, height);
    // Üst kenar çeperi (z = height, normal +Z)
    builder.addPlanarFace(outerCCW, [innerCW], height, true);
    // İç yan duvarlar (floor .. height)
    builder.addWallStrip(innerCW, floor, height);
    // İç taban yüzeyi (z = floor, normal +Z)
    builder.addPlanarFace(innerCCW, floorHolesTopCW, floor, true);
    // Düz taban delik duvarları (0 .. floor; dişli ise helisel duvar zaten eklendi)
    for (const h of plainFloorHolesCW) {
      builder.addWallStrip(h, 0, floor);
    }
  }

  // =========================
  // 2. KAPAK (LID - TERS BASIM)
  // =========================
  if (params.lidMode === 'lid' || params.lidMode === 'both') {
    const lidOuterCCW = createRoundedRectRing(
      lidCenterX,
      0,
      width,
      depth,
      cornerRadius,
      10,
      true
    );

    const lipOuterW = innerW - 2 * lipTolerance;
    const lipOuterD = innerD - 2 * lipTolerance;
    const lipOuterR = Math.max(0, innerR - lipTolerance);

    const lipWall = Math.max(1.2, Math.min(wall, 2.2));
    const lipInnerW = lipOuterW - 2 * lipWall;
    const lipInnerD = lipOuterD - 2 * lipWall;
    const lipInnerR = Math.max(0, lipOuterR - lipWall);

    const hasLip = lipHeight > 0.25 && lipOuterW >= 6 && lipOuterD >= 6;
    const hasHollowLip = hasLip && lipInnerW >= 4 && lipInnerD >= 4;

    const lipOuterCCW = hasLip
      ? createRoundedRectRing(
          lidCenterX,
          0,
          lipOuterW,
          lipOuterD,
          lipOuterR,
          10,
          true
        )
      : [];

    const lipInnerCCW = hasHollowLip
      ? createRoundedRectRing(
          lidCenterX,
          0,
          lipInnerW,
          lipInnerD,
          lipInnerR,
          10,
          true
        )
      : [];

    // Havalandırma delikleri: dudak varsa dudak iç alanına, yoksa kapak iç alanına yerleştirilir
    const ventBoundsCCW = hasHollowLip
      ? lipInnerCCW
      : hasLip
        ? []
        : createRoundedRectRing(
            lidCenterX,
            0,
            Math.max(4, innerW - 2),
            Math.max(4, innerD - 2),
            Math.max(0, innerR - 1),
            8,
            true
          );

    const lidHolesCW: Point2D[][] = [];
    if (params.ventSlots && ventBoundsCCW.length >= 3) {
      const ventD = Math.max(1.6, params.ventHoleDiameter);
      const spacing = ventD + Math.max(1.6, ventD * 0.55);
      const rows = Math.max(1, Math.min(12, Math.round(params.ventHoleRows)));
      const availW = hasHollowLip ? lipInnerW : innerW - 2;
      const cols = Math.max(1, Math.floor((availW - 4) / spacing));

      for (let r = 0; r < rows; r++) {
        const y = (r - (rows - 1) * 0.5) * spacing;
        for (let c = 0; c < cols; c++) {
          const x = lidCenterX + (c - (cols - 1) * 0.5) * spacing;
          const hRing = createCircleRing(x, y, ventD * 0.5, 18, false);
          if (isRingStrictlyInside(hRing, ventBoundsCCW, 1.2)) {
            lidHolesCW.push(hRing);
            totalHoles += 1;
          }
        }
      }
    }

    if (hasHollowLip) {
      const lipOuterCW = ensureCW(lipOuterCCW);
      const lipInnerCW = ensureCW(lipInnerCCW);
      const zLipTop = lidThickness + lipHeight;

      // Kapak dış alt yüzeyi (z = 0, baskı tablasına oturur)
      builder.addPlanarFace(lidOuterCCW, lidHolesCW, 0, false);
      // Kapak dış yan duvarı (0 .. lidThickness)
      builder.addWallStrip(lidOuterCCW, 0, lidThickness);
      // Kapak iç omuz yüzeyi (z = lidThickness, lip dışına kadar)
      builder.addPlanarFace(lidOuterCCW, [lipOuterCW], lidThickness, true);
      // Geçme dudağı dış duvarı (lidThickness .. zLipTop)
      builder.addWallStrip(ensureCCW(lipOuterCCW), lidThickness, zLipTop);
      // Geçme dudağı üst tepesi (z = zLipTop)
      builder.addPlanarFace(lipOuterCCW, [lipInnerCW], zLipTop, true);
      // Geçme dudağı iç duvarı (lidThickness .. zLipTop)
      builder.addWallStrip(lipInnerCW, lidThickness, zLipTop);
      // Kapak iç merkezi tavanı (z = lidThickness)
      builder.addPlanarFace(lipInnerCCW, lidHolesCW, lidThickness, true);
      // Havalandırma delik duvarları (0 .. lidThickness)
      for (const h of lidHolesCW) {
        builder.addWallStrip(h, 0, lidThickness);
      }
    } else if (hasLip) {
      // Çok dar kutularda dolu geçme bloğu
      const lipOuterCW = ensureCW(lipOuterCCW);
      const zLipTop = lidThickness + lipHeight;

      builder.addPlanarFace(lidOuterCCW, [], 0, false);
      builder.addWallStrip(lidOuterCCW, 0, lidThickness);
      builder.addPlanarFace(lidOuterCCW, [lipOuterCW], lidThickness, true);
      builder.addWallStrip(ensureCCW(lipOuterCCW), lidThickness, zLipTop);
      builder.addPlanarFace(lipOuterCCW, [], zLipTop, true);
    } else {
      // Düz kapak
      builder.addExtrudedRegion(lidOuterCCW, lidHolesCW, 0, lidThickness);
    }
  }

  const baseGeometry = builder.toBufferGeometry();
  const csgResult = applyBoxCutoutsCSG(baseGeometry, params, warnings);

  return {
    geometry: csgResult.geometry,
    warnings,
    holeCount: totalHoles + csgResult.appliedCount,
    ghostMeshes: csgResult.ghostMeshes,
  };
}
