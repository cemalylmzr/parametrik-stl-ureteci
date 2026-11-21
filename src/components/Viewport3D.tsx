import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AlertOctagon,
  Box,
  Compass,
  Eye,
  Grid3X3,
  Layers,
  Maximize2,
  Printer,
} from 'lucide-react';
import {
  CutoutGhostMesh,
  FLASHFORGE_AD5X_BED,
  ViewportOptions,
} from '../geometry/types';

interface Viewport3DProps {
  geometry: THREE.BufferGeometry;
  options: ViewportOptions;
  onOptionsChange: (next: Partial<ViewportOptions>) => void;
  fitsPrinter?: boolean;
  ghostMeshes?: CutoutGhostMesh[];
  selectedGhostId?: string | null;
  onSelectGhost?: (holeId: string) => void;
}

type CameraPreset = 'iso' | 'top' | 'front' | 'right';

const FILAMENT_COLORS = [
  { name: 'Teknik Turkuaz', hex: '#0ea5e9' },
  { name: 'PLA Turuncu', hex: '#f97316' },
  { name: 'Mat Gri', hex: '#94a3b8' },
  { name: 'Zümrüt Yeşil', hex: '#10b981' },
  { name: 'Karbon Siyah', hex: '#334155' },
  { name: 'Sinyal Sarı', hex: '#eab308' },
];

/**
 * XY düzleminde (Z = 0) 10 mm ince ve 50 mm kalın teknik CAD ızgarası oluşturur.
 */
function buildCadGridGroup(): THREE.Group {
  const group = new THREE.Group();
  const half = 150; // 300 x 300 mm toplam ızgara alanı

  const minorVerts: number[] = [];
  const majorVerts: number[] = [];

  for (let i = -half; i <= half; i += 10) {
    const target = i % 50 === 0 ? majorVerts : minorVerts;
    // X boyunca çizgiler
    target.push(-half, i, -0.02, half, i, -0.02);
    // Y boyunca çizgiler
    target.push(i, -half, -0.02, i, half, -0.02);
  }

  const minorGeo = new THREE.BufferGeometry();
  minorGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(minorVerts, 3)
  );
  const minorMat = new THREE.LineBasicMaterial({
    color: 0x1a2433,
    transparent: true,
    opacity: 0.75,
  });
  group.add(new THREE.LineSegments(minorGeo, minorMat));

  const majorGeo = new THREE.BufferGeometry();
  majorGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(majorVerts, 3)
  );
  const majorMat = new THREE.LineBasicMaterial({
    color: 0x2c3f58,
    transparent: true,
    opacity: 0.95,
  });
  group.add(new THREE.LineSegments(majorGeo, majorMat));

  return group;
}

/**
 * Flashforge AD5X (220 × 220 × 220 mm) CoreXY baskı tablası referans çerçevesi.
 */
function buildPrinterBedGroup(): THREE.Group {
  const group = new THREE.Group();
  const hx = FLASHFORGE_AD5X_BED.x * 0.5;
  const hy = FLASHFORGE_AD5X_BED.y * 0.5;

  // Yarı saydam tabla yüzeyi
  const bedGeo = new THREE.PlaneGeometry(
    FLASHFORGE_AD5X_BED.x,
    FLASHFORGE_AD5X_BED.y
  );
  const bedMat = new THREE.MeshBasicMaterial({
    color: 0x0f1722,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const bedPlane = new THREE.Mesh(bedGeo, bedMat);
  bedPlane.position.z = -0.06;
  group.add(bedPlane);

  // Dış çerçeve çizgisi (220 x 220 mm)
  const borderPts = [
    new THREE.Vector3(-hx, -hy, 0.01),
    new THREE.Vector3(hx, -hy, 0.01),
    new THREE.Vector3(hx, hy, 0.01),
    new THREE.Vector3(-hx, hy, 0.01),
    new THREE.Vector3(-hx, -hy, 0.01),
  ];
  const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
  const borderMat = new THREE.LineBasicMaterial({
    color: 0x06b6d4,
    transparent: true,
    opacity: 0.55,
  });
  const borderLine = new THREE.Line(borderGeo, borderMat);
  borderLine.name = 'bedBorderLine';
  group.add(borderLine);

  // Ön taraf (Y-) ok işareti — yazıcının ön yönünü gösterir
  const frontPts = [
    new THREE.Vector3(-12, -hy - 3, 0.02),
    new THREE.Vector3(0, -hy - 11, 0.02),
    new THREE.Vector3(12, -hy - 3, 0.02),
    new THREE.Vector3(-12, -hy - 3, 0.02),
  ];
  const frontGeo = new THREE.BufferGeometry().setFromPoints(frontPts);
  const frontMat = new THREE.LineBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.7,
  });
  const frontLine = new THREE.Line(frontGeo, frontMat);
  frontLine.name = 'bedFrontLine';
  group.add(frontLine);

  return group;
}

/**
 * X (Kırmızı), Y (Yeşil), Z (Mavi) CAD eksen göstergesi.
 */
function buildAxesGroup(): THREE.Group {
  const group = new THREE.Group();
  const len = 35;

  const makeAxis = (to: THREE.Vector3, color: number) => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.04),
      to,
    ]);
    const mat = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geo, mat);
  };

  group.add(makeAxis(new THREE.Vector3(len, 0, 0.04), 0xef4444)); // +X
  group.add(makeAxis(new THREE.Vector3(0, len, 0.04), 0x22c55e)); // +Y
  group.add(makeAxis(new THREE.Vector3(0, 0, len), 0x3b82f6));    // +Z

  return group;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  geometry,
  options,
  onOptionsChange,
  fitsPrinter = true,
  ghostMeshes,
  selectedGhostId,
  onSelectGhost,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const edgeLinesRef = useRef<THREE.LineSegments | null>(null);
  const ghostGroupRef = useRef<THREE.Group | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const bedGroupRef = useRef<THREE.Group | null>(null);
  const axesGroupRef = useRef<THREE.Group | null>(null);
  const onSelectGhostRef = useRef(onSelectGhost);
  onSelectGhostRef.current = onSelectGhost;

  const [showGhosts, setShowGhosts] = useState(true);

  // Sahne, kamera (Z-up) ve OrbitControls kurulumu
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    sceneRef.current = scene;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 3D yazıcı / CAD standardı: Z yukarı (+Z up), 1 birim = 1 mm
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 4000);
    camera.up.set(0, 0, 1);
    camera.position.set(130, -145, 115);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 15;
    controls.maxDistance = 900;
    controls.maxPolarAngle = Math.PI * 0.96;
    controls.target.set(0, 0, 10);
    controls.update();
    controlsRef.current = controls;

    // CAD Stüdyo Aydınlatması
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.85);
    hemiLight.position.set(0, 0, 200);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(140, -120, 220);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    fillLight.position.set(-160, 110, 120);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.4);
    rimLight.position.set(0, 180, -60);
    scene.add(rimLight);

    // 10mm / 50mm CAD ızgarası, Flashforge AD5X tablası, eksenler
    const gridGroup = buildCadGridGroup();
    gridGroupRef.current = gridGroup;
    scene.add(gridGroup);

    const bedGroup = buildPrinterBedGroup();
    bedGroupRef.current = bedGroup;
    scene.add(bedGroup);

    const axesGroup = buildAxesGroup();
    axesGroupRef.current = axesGroup;
    scene.add(axesGroup);

    // Ana CAD Mesh
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(options.meshColor),
      roughness: 0.42,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    meshRef.current = mesh;
    scene.add(mesh);

    // Keskin CAD kenar çizgileri (EdgesGeometry)
    const edgeGeo = new THREE.EdgesGeometry(geometry, 24);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x04070b,
      transparent: true,
      opacity: 0.38,
    });
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLinesRef.current = edgeLines;
    scene.add(edgeLines);

    // CSG Delik Hayalet Önizleme Grubu
    const ghostGroup = new THREE.Group();
    ghostGroupRef.current = ghostGroup;
    scene.add(ghostGroup);

    // 3D sahnede delik hayaletine tıklayarak sağ panelde seçme (Raycaster)
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      if (!ghostGroupRef.current || !onSelectGhostRef.current) return;

      const pickables: THREE.Object3D[] = [];
      ghostGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.userData.holeId) {
          pickables.push(obj);
        }
      });
      if (pickables.length === 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.holeId as string | undefined;
        if (hitId) {
          onSelectGhostRef.current(hitId);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ResizeObserver ile akıcı boyutlandırma
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, entry.contentRect.width);
        const h = Math.max(1, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      resizeObserver.disconnect();
      controls.dispose();

      // GPU bellek temizliği
      edgeLines.geometry.dispose();
      (edgeLines.material as THREE.Material).dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geometri güncellendiğinde mesh ve kenar çizgilerini güncelle
  useEffect(() => {
    const mesh = meshRef.current;
    const edgeLines = edgeLinesRef.current;
    if (!mesh || !edgeLines) return;

    mesh.geometry = geometry;

    const prevEdgeGeo = edgeLines.geometry;
    edgeLines.geometry = new THREE.EdgesGeometry(geometry, 24);
    prevEdgeGeo.dispose();
  }, [geometry]);

  // CSG Delik Hayalet Önizleme (Ghost Preview) mesh'lerini güncelle
  useEffect(() => {
    const group = ghostGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        } else if (obj instanceof THREE.Mesh) {
          (obj.material as THREE.Material).dispose();
        }
      });
    }

    if (!showGhosts || !ghostMeshes || ghostMeshes.length === 0) return;

    for (const ghost of ghostMeshes) {
      const isSelected = ghost.id === selectedGhostId;
      const wrapper = new THREE.Group();

      const fillColor = isSelected
        ? 0xef4444
        : ghost.enabled
          ? 0xf97316
          : 0x64748b;
      const fillOpacity = isSelected ? 0.38 : ghost.enabled ? 0.2 : 0.12;

      const mat = new THREE.MeshBasicMaterial({
        color: fillColor,
        transparent: true,
        opacity: fillOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ghost.geometry, mat);
      mesh.userData.holeId = ghost.id;
      mesh.renderOrder = isSelected ? 12 : 10;
      wrapper.add(mesh);

      const outlineGeo = new THREE.EdgesGeometry(ghost.geometry, 22);
      const outlineMat = new THREE.LineBasicMaterial({
        color: isSelected ? 0xff4d4d : ghost.enabled ? 0xfb923c : 0x94a3b8,
        transparent: true,
        opacity: isSelected ? 0.95 : 0.65,
      });
      const outline = new THREE.LineSegments(outlineGeo, outlineMat);
      outline.renderOrder = isSelected ? 13 : 11;
      wrapper.add(outline);

      group.add(wrapper);
    }
  }, [ghostMeshes, selectedGhostId, showGhosts]);

  // Görünüm seçeneklerini güncelle
  useEffect(() => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.wireframe = options.showWireframe;
      mat.color.set(options.meshColor);
    }
    if (edgeLinesRef.current) {
      edgeLinesRef.current.visible = !options.showWireframe;
    }
    if (gridGroupRef.current) {
      gridGroupRef.current.visible = options.showGrid;
    }
    if (bedGroupRef.current) {
      bedGroupRef.current.visible = options.showBuildPlate;
      const border = bedGroupRef.current.getObjectByName('bedBorderLine');
      const front = bedGroupRef.current.getObjectByName('bedFrontLine');
      if (border instanceof THREE.Line) {
        const mat = border.material as THREE.LineBasicMaterial;
        mat.color.setHex(fitsPrinter ? 0x06b6d4 : 0xef4444);
        mat.opacity = fitsPrinter ? 0.55 : 0.95;
      }
      if (front instanceof THREE.Line) {
        const mat = front.material as THREE.LineBasicMaterial;
        mat.color.setHex(fitsPrinter ? 0x22d3ee : 0xef4444);
      }
    }
    if (axesGroupRef.current) {
      axesGroupRef.current.visible = options.showAxes;
    }
  }, [options, fitsPrinter]);

  const setCameraPreset = (preset: CameraPreset) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const center = bb
      ? bb.getCenter(new THREE.Vector3())
      : new THREE.Vector3(0, 0, 10);
    const radius = Math.max(
      28,
      geometry.boundingSphere ? geometry.boundingSphere.radius : 60
    );
    const dist = radius * 2.45;

    controls.target.copy(center);

    switch (preset) {
      case 'iso':
        camera.position.set(
          center.x + dist * 0.7,
          center.y - dist * 0.78,
          center.z + dist * 0.62
        );
        break;
      case 'top':
        camera.position.set(center.x, center.y - 0.01, center.z + dist * 1.15);
        break;
      case 'front':
        camera.position.set(center.x, center.y - dist * 1.15, center.z + dist * 0.08);
        break;
      case 'right':
        camera.position.set(center.x + dist * 1.15, center.y, center.z + dist * 0.08);
        break;
    }
    controls.update();
  };

  return (
    <div className="relative flex-1 min-w-0 h-full bg-[#0b0f14] overflow-hidden select-none">
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Üst HUD Çubuğu: Sol Kamera Açısı + Sağ Görünüm Araçları (dar ekranda çakışmaz) */}
      <div className="absolute top-3 inset-x-3 flex flex-wrap items-start justify-between gap-2 pointer-events-none">
        {/* Sol Üst: Kamera Açısı Hızlı Seçim Çubuğu */}
        <div className="pointer-events-auto flex items-center gap-1 bg-[#111720]/90 backdrop-blur-md border border-slate-800/90 rounded-lg p-1 shadow-lg">
          <button
            onClick={() => setCameraPreset('iso')}
            title="İzometrik Görünüm"
            className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded transition-colors flex items-center gap-1"
          >
            <Box className="w-3.5 h-3.5" />
            İzo
          </button>
          <button
            onClick={() => setCameraPreset('top')}
            title="Üstten Görünüm (Z+)"
            className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded transition-colors"
          >
            Üst
          </button>
          <button
            onClick={() => setCameraPreset('front')}
            title="Önden Görünüm (Y-)"
            className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded transition-colors"
          >
            Ön
          </button>
          <button
            onClick={() => setCameraPreset('right')}
            title="Sağdan Görünüm (X+)"
            className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800/80 rounded transition-colors"
          >
            Sağ
          </button>
          <div className="w-px h-4 bg-slate-700/80 mx-0.5" />
          <button
            onClick={() => setCameraPreset('iso')}
            title="Parçaya Odaklan"
            className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Orta Üst: Flashforge AD5X 220x220x220 mm Taşma Kırmızı Uyarısı */}
        {!fitsPrinter && (
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/95 border border-rose-500/70 text-rose-100 text-xs font-semibold shadow-xl backdrop-blur-md">
            <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              BASKI ALANI AŞILDI! Flashforge AD5X (220×220×220 mm) sınırını aşıyor
            </span>
          </div>
        )}

        {/* Sağ Üst: Görünüm Araçları (Wireframe, Izgara, Tabla, Eksenler, Renk) */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 ml-auto">
          <div className="flex items-center gap-1 bg-[#111720]/90 backdrop-blur-md border border-slate-800/90 rounded-lg p-1 shadow-lg">
            <button
              onClick={() =>
                onOptionsChange({ showWireframe: !options.showWireframe })
              }
              title="Tel Kafes (Wireframe) Önizleme"
              className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
                options.showWireframe
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Tel Kafes
            </button>

            <button
              onClick={() => onOptionsChange({ showGrid: !options.showGrid })}
              title="10mm / 50mm CAD Izgarası"
              className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
                options.showGrid
                  ? 'bg-slate-800 text-slate-200'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              10/50mm
            </button>

            <button
              onClick={() =>
                onOptionsChange({ showBuildPlate: !options.showBuildPlate })
              }
              title="Flashforge AD5X Baskı Tablası (220×220×220 mm)"
              className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
                options.showBuildPlate
                  ? 'bg-cyan-500/15 text-cyan-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              AD5X
            </button>

            <button
              onClick={() => onOptionsChange({ showAxes: !options.showAxes })}
              title="XYZ Eksen Göstergesi"
              className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
                options.showAxes
                  ? 'bg-slate-800 text-slate-200'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              XYZ
            </button>

            {ghostMeshes && ghostMeshes.length > 0 && (
              <button
                onClick={() => setShowGhosts((v) => !v)}
                title="CSG Delik Hayalet Önizlemesini Göster/Gizle (Tıklayarak seçebilirsiniz)"
                className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
                  showGhosts
                    ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Hayalet
              </button>
            )}
          </div>

          {/* Filament Önizleme Rengi */}
          <div className="flex items-center gap-1.5 bg-[#111720]/85 backdrop-blur-md border border-slate-800/80 rounded-lg px-2 py-1.5 shadow">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-0.5">
              Renk
            </span>
            {FILAMENT_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => onOptionsChange({ meshColor: c.hex })}
                title={c.name}
                className={`w-4 h-4 rounded-sm transition-transform ${
                  options.meshColor === c.hex
                    ? 'ring-2 ring-white scale-110'
                    : 'opacity-75 hover:opacity-100'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Sol Alt: Eksen Lejantı & Kontrol İpucu */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-[#111720]/80 backdrop-blur-sm border border-slate-800/80 rounded-md px-2.5 py-1 text-[11px] text-slate-400 pointer-events-none">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-red-400 font-semibold">X</span>
          <span className="text-green-400 font-semibold">Y</span>
          <span className="text-blue-400 font-semibold">Z↑</span>
        </div>
        <span className="text-slate-600">|</span>
        <span>Sol Tık: Döndür</span>
        <span>Sağ Tık: Kaydır</span>
        <span>Tekerlek: Yakınlaş</span>
        <span className="text-slate-600 hidden sm:inline">|</span>
        <span className="text-cyan-400/80 hidden sm:inline font-mono">
          Izgara: 10mm / 50mm
        </span>
      </div>
    </div>
  );
};
