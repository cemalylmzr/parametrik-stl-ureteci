export type PartCategory = 'sieve' | 'box' | 'plate' | 'fastener';

export type MaterialType = 'PLA' | 'PETG' | 'ABS' | 'ASA' | 'TPU';

export interface MaterialSpec {
  id: MaterialType;
  label: string;
  densityGPerCm3: number;
  nozzleTempC: string;
  bedTempC: string;
}

export const MATERIALS: Record<MaterialType, MaterialSpec> = {
  PLA: {
    id: 'PLA',
    label: 'PLA',
    densityGPerCm3: 1.24,
    nozzleTempC: '215°C',
    bedTempC: '55°C',
  },
  PETG: {
    id: 'PETG',
    label: 'PETG',
    densityGPerCm3: 1.27,
    nozzleTempC: '245°C',
    bedTempC: '75°C',
  },
  ABS: {
    id: 'ABS',
    label: 'ABS',
    densityGPerCm3: 1.04,
    nozzleTempC: '255°C',
    bedTempC: '100°C',
  },
  ASA: {
    id: 'ASA',
    label: 'ASA',
    densityGPerCm3: 1.07,
    nozzleTempC: '255°C',
    bedTempC: '100°C',
  },
  TPU: {
    id: 'TPU',
    label: 'TPU',
    densityGPerCm3: 1.21,
    nozzleTempC: '225°C',
    bedTempC: '45°C',
  },
};

export interface HoneycombSieveParams {
  shape: 'circle' | 'rectangle';
  width: number;        // Dış çap (daire) veya X genişliği (dikdörtgen), mm
  depth: number;        // Y derinliği (dikdörtgen), mm
  cornerRadius: number; // Köşe yuvarlama yarıçapı (dikdörtgen), mm
  thickness: number;    // Elek taban kalınlığı, mm
  rimWidth: number;     // Dış çerçeve duvar kalınlığı, mm
  rimHeight: number;    // Toplam çerçeve yüksekliği (>= thickness), mm
  holeType: 'hexagon' | 'square' | 'circle';
  holeSize: number;     // Delik çapı / kenar açıklığı, mm
  wallSpacing: number;  // Delikler arası köprü kalınlığı, mm
  holeRotation: number; // Delik deseni açısı, derece
  curveSegments: number;
}

export interface ParametricBoxParams {
  width: number;          // Dış X genişliği, mm
  depth: number;          // Dış Y derinliği, mm
  height: number;         // Kutu gövde dış yüksekliği, mm
  wallThickness: number;  // Yan duvar kalınlığı, mm
  floorThickness: number; // Taban kalınlığı, mm
  cornerRadius: number;   // Dış köşe radyüsü, mm
  lidMode: 'both' | 'box' | 'lid';
  lidThickness: number;   // Kapak üst plaka kalınlığı, mm
  lipHeight: number;      // Kapak geçme dudağı yüksekliği, mm
  lipTolerance: number;   // FDM geçme toleransı (boşluk), mm
  ventSlots: boolean;     // Kapakta havalandırma delikleri
  ventHoleDiameter: number;
  ventHoleRows: number;
  cableHoleDiameter: number; // Taban merkezinde kablo / cıvata deliği (0 = kapalı)
  cableHoleThreaded: boolean;
  cableHolePitch: number;
  cableHoleTolerance: number;
}

export interface MountingPlateParams {
  mode: 'plate' | 'spacer';
  // Montaj plakası parametreleri
  width: number;
  depth: number;
  thickness: number;
  cornerRadius: number;
  holeCount: '4-corners' | '2-sides' | 'none';
  holeDiameter: number;
  holeInsetX: number;
  holeInsetY: number;
  holeStyle: 'through' | 'counterbore' | 'standoff' | 'threaded';
  counterboreDiameter: number;
  counterboreDepth: number;
  standoffHeight: number;
  standoffOuterDiameter: number;
  threadPitch: number;
  threadTolerance: number;
  centerCutout: 'none' | 'circle' | 'rectangle';
  centerCutoutWidth: number;
  centerCutoutDepth: number;
  // Spacer (burç / yükseltici) parametreleri
  spacerShape: 'circle' | 'hexagon';
  outerDiameter: number;
  innerDiameter: number;
  spacerHeight: number;
  chamfer: number;
  spacerThreaded: boolean;
  flangeEnabled: boolean;
  flangeDiameter: number;
  flangeHeight: number;
}

export interface FastenerParams {
  mode: 'bolt' | 'nut' | 'threadedCap' | 'gear';
  // Cıvata & Somun / Cıvata Deliği ortak diş parametreleri
  threadDiameter: number;   // Anma çapı (M6..M30), mm
  threadPitch: number;      // Diş adımı (Pitch), mm
  threadTolerance: number;  // FDM diş boşluğu / toleransı, mm
  // Cıvata (Bolt)
  boltHeadType: 'hex' | 'socket' | 'knurled';
  boltHeadSize: number;     // Anahtar ağzı / baş çapı, mm
  boltHeadHeight: number;   // Baş yüksekliği, mm
  boltShaftLength: number;  // Toplam gövde boyu, mm
  boltUnthreadedLength: number; // Düz (dişsiz) boyun uzunluğu, mm
  boltIncludeNut: boolean;  // Yanında uyumlu somun da üret
  // Cıvata Deliği / Somun (Nut / Threaded Block)
  nutShape: 'hex' | 'square' | 'round';
  nutOuterSize: number;     // Anahtar ağzı / dış ölçü, mm
  nutHeight: number;        // Somun / blok yüksekliği, mm
  // Dişli Kapak & Kavanoz (Threaded Jar & Cap)
  capMode: 'both' | 'body' | 'cap';
  jarDiameter: number;      // Gövde dış çapı, mm
  jarHeight: number;        // Gövde yüksekliği (diş dahil), mm
  jarWallThickness: number; // Duvar kalınlığı, mm
  jarThreadHeight: number;  // Dişli boyun yüksekliği, mm
  jarThreadPitch: number;   // Kapak diş adımı, mm
  jarThreadTolerance: number; // Kapak FDM diş boşluğu, mm
  capTopThickness: number;  // Kapak tavan kalınlığı, mm
  capKnurling: boolean;     // Kapak dış tırtıklı tutuş
  // Dişli Çark (Spur Gear)
  gearModule: number;       // Modül (m), mm
  gearTeeth: number;        // Diş sayısı (z)
  gearThickness: number;    // Dişli kalınlığı, mm
  gearPressureAngle: number;// Kavrama açısı (genelde 20°), derece
  gearBacklash: number;     // FDM diş boşluğu, mm
  gearBoreDiameter: number; // Merkez mil deliği çapı (0 = dolu), mm
  gearBoreShape: 'circle' | 'd-shaft' | 'hex';
  gearHubEnabled: boolean;  // Göbek yükseltisi
  gearHubDiameter: number;
  gearHubHeight: number;
}

export interface MeshStats {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  triangleCount: number;
  vertexCount: number;
  volumeMm3: number;
  volumeCm3: number;
  surfaceAreaMm2: number;
  estimatedWeightG: number;
  estimatedFilamentM: number;
  isWatertight: boolean;
  openEdges: number;
  nonManifoldEdges: number;
  fitsPrinter: boolean;
  warnings: string[];
}

export interface GeometryResult {
  geometry: import('three').BufferGeometry;
  warnings: string[];
  holeCount?: number;
}

export interface ViewportOptions {
  showWireframe: boolean;
  showBuildPlate: boolean;
  showGrid: boolean;
  showAxes: boolean;
  meshColor: string;
}

export const DEFAULT_SIEVE_PARAMS: HoneycombSieveParams = {
  shape: 'circle',
  width: 100,
  depth: 100,
  cornerRadius: 8,
  thickness: 2.4,
  rimWidth: 5,
  rimHeight: 12,
  holeType: 'hexagon',
  holeSize: 8,
  wallSpacing: 1.6,
  holeRotation: 0,
  curveSegments: 64,
};

export const DEFAULT_BOX_PARAMS: ParametricBoxParams = {
  width: 85,
  depth: 58,
  height: 32,
  wallThickness: 2.4,
  floorThickness: 2.0,
  cornerRadius: 5,
  lidMode: 'both',
  lidThickness: 2.4,
  lipHeight: 4.0,
  lipTolerance: 0.2,
  ventSlots: true,
  ventHoleDiameter: 4.0,
  ventHoleRows: 3,
  cableHoleDiameter: 0,
  cableHoleThreaded: false,
  cableHolePitch: 1.75,
  cableHoleTolerance: 0.3,
};

export const DEFAULT_PLATE_PARAMS: MountingPlateParams = {
  mode: 'plate',
  width: 80,
  depth: 80,
  thickness: 6.0,
  cornerRadius: 6,
  holeCount: '4-corners',
  holeDiameter: 6.0,
  holeInsetX: 11,
  holeInsetY: 11,
  holeStyle: 'counterbore',
  counterboreDiameter: 10.5,
  counterboreDepth: 2.6,
  standoffHeight: 6.0,
  standoffOuterDiameter: 11.0,
  threadPitch: 1.5,
  threadTolerance: 0.3,
  centerCutout: 'circle',
  centerCutoutWidth: 40,
  centerCutoutDepth: 40,
  spacerShape: 'hexagon',
  outerDiameter: 16,
  innerDiameter: 8.0,
  spacerHeight: 16,
  chamfer: 0.6,
  spacerThreaded: false,
  flangeEnabled: false,
  flangeDiameter: 22,
  flangeHeight: 2.6,
};

export const DEFAULT_FASTENER_PARAMS: FastenerParams = {
  mode: 'bolt',
  threadDiameter: 10,
  threadPitch: 1.75,
  threadTolerance: 0.3,
  boltHeadType: 'hex',
  boltHeadSize: 17,
  boltHeadHeight: 6.5,
  boltShaftLength: 26,
  boltUnthreadedLength: 4,
  boltIncludeNut: true,
  nutShape: 'hex',
  nutOuterSize: 17,
  nutHeight: 8.5,
  capMode: 'both',
  jarDiameter: 54,
  jarHeight: 46,
  jarWallThickness: 2.6,
  jarThreadHeight: 11,
  jarThreadPitch: 3.0,
  jarThreadTolerance: 0.35,
  capTopThickness: 2.8,
  capKnurling: true,
  gearModule: 2.0,
  gearTeeth: 20,
  gearThickness: 8.0,
  gearPressureAngle: 20,
  gearBacklash: 0.15,
  gearBoreDiameter: 6.0,
  gearBoreShape: 'circle',
  gearHubEnabled: true,
  gearHubDiameter: 16,
  gearHubHeight: 5.0,
};

export const FLASHFORGE_AD5X_BED = {
  name: 'Flashforge AD5X',
  shortName: 'AD5X',
  x: 220,
  y: 220,
  z: 220,
  defaultNozzleMm: 0.4,
  snapToleranceMm: 0.2,
  threadToleranceMm: 0.3,
} as const;
