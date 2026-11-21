import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AlertOctagon,
  AlertTriangle,
  Box,
  CheckCircle2,
  Eye,
  Layers,
  Maximize2,
  Printer,
  Upload,
} from 'lucide-react';
import { FLASHFORGE_AD5X_BED } from '../geometry/types';
import { CollisionReport, LoadedSTLPart, SimulationConfig } from './types';

interface SimulatorViewportProps {
  parts: LoadedSTLPart[];
  report: CollisionReport;
  toleranceMm: number;
  simConfig: SimulationConfig;
  selectedPartId: string | null;
  onDropFiles: (files: FileList) => void;
}

type CameraPreset = 'iso' | 'top' | 'front' | 'right';

function buildCadGrid(): THREE.Group {
  const group = new THREE.Group();
  const half = 150;
  const minorVerts: number[] = [];
  const majorVerts: number[] = [];

  for (let i = -half; i <= half; i += 10) {
    const target = i % 50 === 0 ? majorVerts : minorVerts;
    target.push(-half, i, -0.02, half, i, -0.02);
    target.push(i, -half, -0.02, i, half, -0.02);
  }

  const minorGeo = new THREE.BufferGeometry();
  minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorVerts, 3));
  group.add(
    new THREE.LineSegments(
      minorGeo,
      new THREE.LineBasicMaterial({ color: 0x1a2433, transparent: true, opacity: 0.75 })
    )
  );

  const majorGeo = new THREE.BufferGeometry();
  majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3));
  group.add(
    new THREE.LineSegments(
      majorGeo,
      new THREE.LineBasicMaterial({ color: 0x2c3f58, transparent: true, opacity: 0.95 })
    )
  );
  return group;
}

function buildAd5xBed(): THREE.Group {
  const group = new THREE.Group();
  const hx = FLASHFORGE_AD5X_BED.x * 0.5;
  const hy = FLASHFORGE_AD5X_BED.y * 0.5;

  const bedPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(FLASHFORGE_AD5X_BED.x, FLASHFORGE_AD5X_BED.y),
    new THREE.MeshBasicMaterial({
      color: 0x0f1722,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  bedPlane.position.z = -0.06;
  group.add(bedPlane);

  const borderPts = [
    new THREE.Vector3(-hx, -hy, 0.01),
    new THREE.Vector3(hx, -hy, 0.01),
    new THREE.Vector3(hx, hy, 0.01),
    new THREE.Vector3(-hx, hy, 0.01),
    new THREE.Vector3(-hx, -hy, 0.01),
  ];
  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(borderPts),
      new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.5 })
    )
  );
  return group;
}

function buildAxes(): THREE.Group {
  const group = new THREE.Group();
  const len = 35;
  const make = (to: THREE.Vector3, color: number) =>
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.04), to]),
      new THREE.LineBasicMaterial({ color })
    );
  group.add(make(new THREE.Vector3(len, 0, 0.04), 0xef4444));
  group.add(make(new THREE.Vector3(0, len, 0.04), 0x22c55e));
  group.add(make(new THREE.Vector3(0, 0, len), 0x3b82f6));
  return group;
}

export const SimulatorViewport: React.FC<SimulatorViewportProps> = ({
  parts,
  report,
  toleranceMm,
  simConfig,
  selectedPartId,
  onDropFiles,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const partsGroupRef = useRef<THREE.Group | null>(null);
  const meshCacheRef = useRef<
    Map<
      string,
      {
        wrapper: THREE.Group;
        geometry: THREE.BufferGeometry;
        wireframe: boolean;
        xrayStatic: boolean;
        role: LoadedSTLPart['role'];
        isSelected: boolean;
      }
    >
  >(new Map());
  const pathGroupRef = useRef<THREE.Group | null>(null);
  const markerRef = useRef<THREE.Mesh | null>(null);
  const bedGroupRef = useRef<THREE.Group | null>(null);

  const [wireframe, setWireframe] = useState(false);
  const [xrayStatic, setXrayStatic] = useState(true);
  const [showBed, setShowBed] = useState(true);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Sahne kurulumu (Z-up)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    sceneRef.current = scene;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 4000);
    camera.up.set(0, 0, 1);
    camera.position.set(110, -135, 95);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 12;
    controls.maxDistance = 900;
    controls.target.set(0, 0, 12);
    controls.update();
    controlsRef.current = controls;

    // Aydınlatma
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.9);
    hemi.position.set(0, 0, 200);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(130, -110, 210);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x93c5fd, 0.65);
    fill.position.set(-150, 110, 110);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x38bdf8, 0.35);
    rim.position.set(0, 160, -50);
    scene.add(rim);

    scene.add(buildCadGrid());
    const bed = buildAd5xBed();
    bedGroupRef.current = bed;
    scene.add(bed);
    scene.add(buildAxes());

    const partsGroup = new THREE.Group();
    partsGroupRef.current = partsGroup;
    scene.add(partsGroup);

    const pathGroup = new THREE.Group();
    pathGroupRef.current = pathGroup;
    scene.add(pathGroup);

    // En derin çakışma noktası işaretçisi (parlak kırmızı küre)
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 20, 20),
      new THREE.MeshBasicMaterial({
        color: 0xff2a2a,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
      })
    );
    marker.visible = false;
    marker.renderOrder = 999;
    markerRef.current = marker;
    scene.add(marker);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, entry.contentRect.width);
        const h = Math.max(1, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    ro.observe(container);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Parça mesh'lerini akıllı önbellek ile güncelle:
  // Yalnızca konum/döndürme değiştiğinde EdgesGeometry yeniden oluşturulmaz (60 FPS akıcı animasyon)
  useEffect(() => {
    const group = partsGroupRef.current;
    if (!group) return;

    const cache = meshCacheRef.current;
    const activeIds = new Set(parts.map((p) => p.id));

    // Silinen parçaların GPU kaynaklarını temizle
    for (const [id, entry] of cache.entries()) {
      if (!activeIds.has(id)) {
        group.remove(entry.wrapper);
        entry.wrapper.traverse((obj) => {
          if (obj instanceof THREE.LineSegments) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          } else if (obj instanceof THREE.Mesh) {
            (obj.material as THREE.Material).dispose();
          }
        });
        cache.delete(id);
      }
    }

    for (const part of parts) {
      const isSelected = part.id === selectedPartId;
      const existing = cache.get(part.id);

      const needsRebuild =
        !existing ||
        existing.geometry !== part.geometry ||
        existing.wireframe !== wireframe ||
        existing.xrayStatic !== xrayStatic ||
        existing.role !== part.role ||
        existing.isSelected !== isSelected;

      let wrapper: THREE.Group;
      if (needsRebuild) {
        if (existing) {
          group.remove(existing.wrapper);
          existing.wrapper.traverse((obj) => {
            if (obj instanceof THREE.LineSegments) {
              obj.geometry.dispose();
              (obj.material as THREE.Material).dispose();
            } else if (obj instanceof THREE.Mesh) {
              (obj.material as THREE.Material).dispose();
            }
          });
        }

        wrapper = new THREE.Group();
        const isStaticXray = xrayStatic && part.role === 'static';
        const opacity = isStaticXray ? 0.58 : part.opacity;
        const transparent = opacity < 0.99;

        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.44,
          metalness: 0.1,
          wireframe,
          transparent,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: !transparent,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });

        const mesh = new THREE.Mesh(part.geometry, mat);
        if (part.role === 'moving') {
          mesh.renderOrder = 2;
        }
        wrapper.add(mesh);

        if (!wireframe) {
          const edgeGeo = new THREE.EdgesGeometry(part.geometry, 26);
          const edgeMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x22d3ee : 0x05080d,
            transparent: true,
            opacity: isSelected ? 0.55 : 0.28,
          });
          wrapper.add(new THREE.LineSegments(edgeGeo, edgeMat));
        }

        group.add(wrapper);
        cache.set(part.id, {
          wrapper,
          geometry: part.geometry,
          wireframe,
          xrayStatic,
          role: part.role,
          isSelected,
        });
      } else {
        wrapper = existing.wrapper;
      }

      wrapper.visible = part.visible;
      wrapper.position.set(part.position.x, part.position.y, part.position.z);
      wrapper.rotation.set(
        THREE.MathUtils.degToRad(part.rotationDeg.x),
        THREE.MathUtils.degToRad(part.rotationDeg.y),
        THREE.MathUtils.degToRad(part.rotationDeg.z),
        'XYZ'
      );
    }
  }, [parts, wireframe, xrayStatic, selectedPartId]);

  // Çakışma noktası işaretçisi ve hareket yolu çizgisi
  useEffect(() => {
    const marker = markerRef.current;
    if (marker) {
      if (report.hasCollision && report.deepestPointWorld) {
        marker.position.set(
          report.deepestPointWorld.x,
          report.deepestPointWorld.y,
          report.deepestPointWorld.z
        );
        marker.visible = true;
      } else {
        marker.visible = false;
      }
    }

    const pathGroup = pathGroupRef.current;
    if (!pathGroup) return;
    while (pathGroup.children.length > 0) {
      const c = pathGroup.children[0];
      pathGroup.remove(c);
      if (c instanceof THREE.Line || c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }

    if (simConfig.motionMode === 'linear') {
      const pStart = new THREE.Vector3(
        simConfig.startPos.x,
        simConfig.startPos.y,
        simConfig.startPos.z
      );
      const pEnd = new THREE.Vector3(
        simConfig.endPos.x,
        simConfig.endPos.y,
        simConfig.endPos.z
      );
      if (pStart.distanceTo(pEnd) > 0.2) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([pStart, pEnd]);
        const lineMat = new THREE.LineDashedMaterial({
          color: 0x22d3ee,
          dashSize: 2.5,
          gapSize: 1.5,
          transparent: true,
          opacity: 0.75,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        line.computeLineDistances();
        pathGroup.add(line);

        const sDot = new THREE.Mesh(
          new THREE.SphereGeometry(1.1, 14, 14),
          new THREE.MeshBasicMaterial({ color: 0x10b981 })
        );
        sDot.position.copy(pStart);
        pathGroup.add(sDot);

        const eDot = new THREE.Mesh(
          new THREE.SphereGeometry(1.1, 14, 14),
          new THREE.MeshBasicMaterial({ color: 0xf59e0b })
        );
        eDot.position.copy(pEnd);
        pathGroup.add(eDot);
      }
    }
  }, [report, simConfig]);

  useEffect(() => {
    if (bedGroupRef.current) {
      bedGroupRef.current.visible = showBed;
    }
  }, [showBed]);

  const setCameraPreset = (preset: CameraPreset) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const totalBox = new THREE.Box3();
    for (const part of parts) {
      if (!part.visible || !part.geometry.boundingBox) continue;
      const b = part.geometry.boundingBox.clone();
      const pos = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
      b.translate(pos);
      totalBox.union(b);
    }

    const center = totalBox.isEmpty()
      ? new THREE.Vector3(0, 0, 10)
      : totalBox.getCenter(new THREE.Vector3());
    const size = totalBox.isEmpty()
      ? new THREE.Vector3(80, 80, 40)
      : totalBox.getSize(new THREE.Vector3());
    const dist = Math.max(55, size.length() * 1.45);

    controls.target.copy(center);
    if (preset === 'iso') {
      camera.position.set(
        center.x + dist * 0.68,
        center.y - dist * 0.78,
        center.z + dist * 0.58
      );
    } else if (preset === 'top') {
      camera.position.set(center.x, center.y - 0.01, center.z + dist * 1.15);
    } else if (preset === 'front') {
      camera.position.set(center.x, center.y - dist * 1.15, center.z + dist * 0.06);
    } else {
      camera.position.set(center.x + dist * 1.15, center.y, center.z + dist * 0.06);
    }
    controls.update();
  };

  return (
    <div
      className="relative flex-1 min-w-0 h-full bg-[#0b0f14] overflow-hidden select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={() => setIsDraggingFile(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
    >
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Sürükle-Bırak Katmanı */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-40 bg-cyan-950/75 backdrop-blur-sm border-2 border-dashed border-cyan-400 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-10 h-10 text-cyan-300" />
          <p className="text-sm font-semibold text-cyan-100">
            STL Dosyalarını Buraya Bırakın (Çoklu Seçim Desteklenir)
          </p>
        </div>
      )}

      {/* Üst HUD Çubuğu */}
      <div className="absolute top-3 inset-x-3 flex flex-wrap items-start justify-between gap-2 pointer-events-none">
        {/* Sol: Kamera Presetleri */}
        <div className="pointer-events-auto flex items-center gap-1 bg-[#111720]/90 backdrop-blur-md border border-slate-800/90 rounded-lg p-1 shadow-lg">
          <button
            onClick={() => setCameraPreset('iso')}
            className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded flex items-center gap-1"
          >
            <Box className="w-3.5 h-3.5" /> İzo
          </button>
          <button
            onClick={() => setCameraPreset('top')}
            className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded"
          >
            Üst
          </button>
          <button
            onClick={() => setCameraPreset('front')}
            className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded"
          >
            Ön
          </button>
          <button
            onClick={() => setCameraPreset('right')}
            className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded"
          >
            Sağ
          </button>
          <div className="w-px h-4 bg-slate-700/80 mx-0.5" />
          <button
            onClick={() => setCameraPreset('iso')}
            title="Parçalara Odaklan"
            className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Orta: Canlı Çakışma / Tolerans Durum Rozeti */}
        {parts.length >= 2 && (
          <div className="pointer-events-auto">
            {report.hasCollision ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/90 border border-rose-500/60 text-rose-200 text-xs font-semibold shadow-lg backdrop-blur-md">
                <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  ÇAKIŞMA! Maks. Gömülme:{' '}
                  <strong className="font-mono text-rose-100">
                    {report.maxPenetrationMm.toFixed(2)} mm
                  </strong>{' '}
                  ({report.dominantAxis.toUpperCase()} ekseni)
                </span>
              </div>
            ) : report.hasTightClearance ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/90 border border-amber-500/60 text-amber-200 text-xs font-semibold shadow-lg backdrop-blur-md">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  DAR TOLERANS UYARISI • En Dar Boşluk:{' '}
                  <strong className="font-mono text-amber-100">
                    {(report.minClearanceMm ?? 0).toFixed(2)} mm
                  </strong>{' '}
                  (&lt; {toleranceMm.toFixed(2)} mm)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 text-xs font-semibold shadow-lg backdrop-blur-md">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  GEÇME UYUMLU
                  {report.minClearanceMm !== null && (
                    <>
                      {' '}
                      • En Dar Boşluk:{' '}
                      <strong className="font-mono text-emerald-100">
                        {report.minClearanceMm.toFixed(2)} mm
                      </strong>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Sağ: Görünüm Araçları */}
        <div className="pointer-events-auto flex items-center gap-1 bg-[#111720]/90 backdrop-blur-md border border-slate-800/90 rounded-lg p-1 shadow-lg">
          <button
            onClick={() => setXrayStatic((v) => !v)}
            title="Sabit parçayı yarı saydam yap (iç çakışmaları net gör)"
            className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
              xrayStatic
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            X-Ray
          </button>
          <button
            onClick={() => setWireframe((v) => !v)}
            className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
              wireframe
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Tel Kafes
          </button>
          <button
            onClick={() => setShowBed((v) => !v)}
            title="Flashforge AD5X Baskı Tablası (220×220×220 mm)"
            className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
              showBed
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            AD5X
          </button>
        </div>
      </div>

      {/* Alt Sol: Renk Lejantı */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 bg-[#111720]/85 backdrop-blur-sm border border-slate-800/80 rounded-md px-3 py-1.5 text-[11px] text-slate-300 pointer-events-none">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
          Çakışma (Gömülme)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />
          Dar Tolerans (0–{toleranceMm.toFixed(2)}mm)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
          Sabit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
          Hareketli
        </span>
      </div>
    </div>
  );
};
