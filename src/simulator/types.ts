import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

export type PartRole = 'static' | 'moving';
export type AxisKey = 'x' | 'y' | 'z';
export type AutoFixMode = 'shrink' | 'offset';
export type MotionMode = 'linear' | 'rotate';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface LoadedSTLPart {
  id: string;
  name: string;
  role: PartRole;
  visible: boolean;
  opacity: number;
  baseColor: string;
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  /** Orijinal vertex pozisyonları (otomatik düzeltmeyi geri almak için) */
  originalPositions: Float32Array;
  /** Dünya eksenlerinde konum (mm) */
  position: Vec3Tuple;
  /** Euler açıları (derece) */
  rotationDeg: Vec3Tuple;
  /** Yerel sınır kutusu ölçüleri (mm) */
  bboxSize: Vec3Tuple;
  triangleCount: number;
  /** Uygulanan son düzeltme özeti */
  appliedFixNote?: string;
}

export interface CollisionReport {
  hasCollision: boolean;
  hasTightClearance: boolean;
  collidingTriangleCountA: number;
  collidingTriangleCountB: number;
  tightTriangleCountA: number;
  tightTriangleCountB: number;
  /** Maksimum gömülme derinliği (mm) */
  maxPenetrationMm: number;
  /** Çakışma yokken iki parça arasındaki en dar boşluk (mm) */
  minClearanceMm: number | null;
  /** Baskın çakışma ekseni (otomatik düzeltme için) */
  dominantAxis: AxisKey;
  /** Baskın eksende kaçış yönü (+1 veya -1) */
  escapeSign: 1 | -1;
  /** En derin çakışma noktasının dünya koordinatı (mm) */
  deepestPointWorld: Vec3Tuple | null;
  /** Analiz süresi (ms) */
  computeTimeMs: number;
}

export interface SimulationConfig {
  motionMode: MotionMode;
  startPos: Vec3Tuple;
  endPos: Vec3Tuple;
  rotateAxis: AxisKey;
  startAngleDeg: number;
  endAngleDeg: number;
  speed: number;           // 0.25 .. 3.0
  pingPong: boolean;
  stopOnCollision: boolean;
  progress: number;        // 0 .. 1
  isPlaying: boolean;
}

export interface SimulationCollisionStop {
  position: Vec3Tuple;
  rotationDeg: Vec3Tuple;
  progress: number;
  maxPenetrationMm: number;
  dominantAxis: AxisKey;
}

export const EMPTY_COLLISION_REPORT: CollisionReport = {
  hasCollision: false,
  hasTightClearance: false,
  collidingTriangleCountA: 0,
  collidingTriangleCountB: 0,
  tightTriangleCountA: 0,
  tightTriangleCountB: 0,
  maxPenetrationMm: 0,
  minClearanceMm: null,
  dominantAxis: 'y',
  escapeSign: 1,
  deepestPointWorld: null,
  computeTimeMs: 0,
};
