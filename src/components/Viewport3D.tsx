import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Box,
  Compass,
  Grid3X3,
  Layers,
  Maximize2,
  Printer,
} from 'lucide-react';
import { ENDER3_V2_BED, ViewportOptions } from '../geometry/types';

interface Viewport3DProps {
  geometry: THREE.BufferGeometry;
  options: ViewportOptions;
  onOptionsChange: (next: Partial<ViewportOptions>) => void;
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
 * Ender 3 V2 (220 x 220 mm) baskı tablası referans çerçevesi.
 */
function buildEnder3BedGroup(): THREE.Group {
  const group = new THREE.Group();
  const hx = ENDER3_V2_BED.x * 0.5;
  const hy = ENDER3_V2_BED.y * 0.5;

  // Yarı saydam tabla yüzeyi
  const bedGeo = new THREE.PlaneGeometry(ENDER3_V2_BED.x, ENDER3_V2_BED.y);
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
  group.add(new THREE.Line(borderGeo, borderMat));

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
  group.add(new THREE.Line(frontGeo, frontMat));

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
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const edgeLinesRef = useRef<THREE.LineSegments | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const bedGroupRef = useRef<THREE.Group | null>(null);
  const axesGroupRef = useRef<THREE.Group | null>(null);

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

    // 10mm / 50mm CAD ızgarası, Ender 3 V2 tablası, eksenler
    const gridGroup = buildCadGridGroup();
    gridGroupRef.current = gridGroup;
    scene.add(gridGroup);

    const bedGroup = buildEnder3BedGroup();
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
    }
    if (axesGroupRef.current) {
      axesGroupRef.current.visible = options.showAxes;
    }
  }, [options]);

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
    <div className="relative flex-1 h-full w-full bg-[#0b0f14] overflow-hidden select-none">
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
              title="Ender 3 V2 Baskı Tablası (220×220 mm)"
              className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1 transition-colors ${
                options.showBuildPlate
                  ? 'bg-cyan-500/15 text-cyan-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              Ender 3
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
