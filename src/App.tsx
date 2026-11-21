import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Box,
  Check,
  Cog,
  Download,
  Grid,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import {
  DEFAULT_BOX_PARAMS,
  DEFAULT_FASTENER_PARAMS,
  DEFAULT_PLATE_PARAMS,
  DEFAULT_SIEVE_PARAMS,
  FastenerParams,
  HoneycombSieveParams,
  MATERIALS,
  MaterialType,
  MountingPlateParams,
  ParametricBoxParams,
  PartCategory,
  ViewportOptions,
} from './geometry/types';
import { generateHoneycombSieve } from './geometry/honeycombSieve';
import { generateParametricBox } from './geometry/parametricBox';
import { generateMountingPlate } from './geometry/mountingPlate';
import { generateFastenerOrGear } from './geometry/fastenersAndGears';
import { computeMeshStats, downloadBinarySTL } from './geometry/stlExporter';
import { rotateAndSeatGeometryOnBed } from './geometry/printAnalyzer';
import { AICadPatchResult } from './services/geminiCadService';
import { Viewport3D } from './components/Viewport3D';
import { ParameterPanel } from './components/ParameterPanel';
import { MeshStatsBar } from './components/MeshStatsBar';
import { BoxCutoutPanel } from './components/BoxCutoutPanel';
import { AIAssistantPanel } from './components/AIAssistantPanel';
import { SimulatorWorkspace } from './simulator/SimulatorWorkspace';

type AppTab = PartCategory | 'simulator';

const CATEGORY_TABS: Array<{
  id: AppTab;
  label: string;
  subtitle: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'sieve',
    label: 'Elek / Izgara',
    subtitle: 'Bal peteği, kare, daire',
    icon: Grid,
  },
  {
    id: 'box',
    label: 'Elektronik Kutu',
    subtitle: 'Gövde, kapak & CSG delik',
    icon: Box,
  },
  {
    id: 'plate',
    label: 'Montaj & Spacer',
    subtitle: 'Plaka, havşa, dişli delik',
    icon: Wrench,
  },
  {
    id: 'fastener',
    label: 'Cıvata & Dişli',
    subtitle: 'Cıvata, somun, dişli kapak, çark',
    icon: Cog,
  },
  {
    id: 'simulator',
    label: 'Geçme & Simülasyon',
    subtitle: 'BVH çakışma, tolerans & hareket testi',
    icon: Activity,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('sieve');
  const category: PartCategory =
    activeTab === 'simulator' ? 'sieve' : activeTab;

  const [sieveParams, setSieveParams] =
    useState<HoneycombSieveParams>(DEFAULT_SIEVE_PARAMS);
  const [boxParams, setBoxParams] =
    useState<ParametricBoxParams>(DEFAULT_BOX_PARAMS);
  const [plateParams, setPlateParams] =
    useState<MountingPlateParams>(DEFAULT_PLATE_PARAMS);
  const [fastenerParams, setFastenerParams] =
    useState<FastenerParams>(DEFAULT_FASTENER_PARAMS);
  const [selectedBoxHoleId, setSelectedBoxHoleId] = useState<string | null>(null);

  const [material, setMaterial] = useState<MaterialType>('PLA');
  const [infillPercent, setInfillPercent] = useState<number>(20);
  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(false);
  const [printRotationDeg, setPrintRotationDeg] = useState<{
    x: number;
    y: number;
    z: number;
  }>({ x: 0, y: 0, z: 0 });

  const [viewportOptions, setViewportOptions] = useState<ViewportOptions>({
    showWireframe: false,
    showBuildPlate: true,
    showGrid: true,
    showAxes: true,
    meshColor: '#0ea5e9',
  });

  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Kategori değişince baskı döndürme açısını sıfırla
  const handleTabChange = (nextTab: AppTab) => {
    setActiveTab(nextTab);
    setPrintRotationDeg({ x: 0, y: 0, z: 0 });
  };

  // Parametreler değiştikçe watertight BufferGeometry üret
  const generated = useMemo(() => {
    if (category === 'sieve') return generateHoneycombSieve(sieveParams);
    if (category === 'box') return generateParametricBox(boxParams);
    if (category === 'plate') return generateMountingPlate(plateParams);
    return generateFastenerOrGear(fastenerParams);
  }, [category, sieveParams, boxParams, plateParams, fastenerParams]);

  // Baskı yönü döndürmesi (AD5X Baskı Analizi önerisi veya manuel döndürme)
  const isRotated =
    Math.abs(printRotationDeg.x) > 1e-3 ||
    Math.abs(printRotationDeg.y) > 1e-3 ||
    Math.abs(printRotationDeg.z) > 1e-3;

  const orientedGeometry = useMemo(() => {
    if (!isRotated) return generated.geometry;
    return rotateAndSeatGeometryOnBed(
      generated.geometry,
      printRotationDeg.x,
      printRotationDeg.y,
      printRotationDeg.z
    );
  }, [generated.geometry, isRotated, printRotationDeg]);

  // Eski geometri ve hayalet kesim mesh'leri değiştiğinde GPU belleğini temizle
  useEffect(() => {
    return () => {
      generated.geometry.dispose();
      if (generated.ghostMeshes) {
        for (const g of generated.ghostMeshes) {
          g.geometry.dispose();
        }
      }
    };
  }, [generated]);

  useEffect(() => {
    return () => {
      if (orientedGeometry !== generated.geometry) {
        orientedGeometry.dispose();
      }
    };
  }, [orientedGeometry, generated.geometry]);

  // Gerçek zamanlı manifold doğrulama, ölçüler ve filament hesabı
  const stats = useMemo(
    () =>
      computeMeshStats(
        orientedGeometry,
        material,
        infillPercent,
        generated.warnings
      ),
    [orientedGeometry, generated.warnings, material, infillPercent]
  );

  // AI Asistan JSON çıktısını sahnedeki aktif modele uygula
  const handleApplyAICadPatch = (patch: AICadPatchResult) => {
    setActiveTab(patch.targetCategory);
    setPrintRotationDeg({ x: 0, y: 0, z: 0 });

    if (patch.targetCategory === 'box') {
      setBoxParams((prev) => {
        const nextCutouts = patch.boxCutouts
          ? patch.replaceExistingCutouts
            ? patch.boxCutouts
            : [...prev.cutouts, ...patch.boxCutouts]
          : prev.cutouts;
        return {
          ...prev,
          ...(patch.boxPatch ?? {}),
          cutouts: nextCutouts,
        };
      });
      if (patch.boxCutouts && patch.boxCutouts.length > 0) {
        setSelectedBoxHoleId(patch.boxCutouts[0].id);
      }
    } else if (patch.targetCategory === 'sieve' && patch.sievePatch) {
      setSieveParams((prev) => ({ ...prev, ...patch.sievePatch }));
    } else if (patch.targetCategory === 'plate' && patch.platePatch) {
      setPlateParams((prev) => ({ ...prev, ...patch.platePatch }));
    } else if (patch.targetCategory === 'fastener' && patch.fastenerPatch) {
      setFastenerParams((prev) => ({ ...prev, ...patch.fastenerPatch }));
    }
  };

  // Dilimleyici dostu, Türkçe karaktersiz `AD5X_parca_adi.stl` dosya adı
  const buildFilename = (): string => {
    if (category === 'sieve') {
      const shapeTag =
        sieveParams.shape === 'circle'
          ? `d${Math.round(sieveParams.width)}`
          : `${Math.round(sieveParams.width)}x${Math.round(sieveParams.depth)}`;
      return `AD5X_elek_${sieveParams.holeType}_${shapeTag}_h${sieveParams.rimHeight.toFixed(1)}mm.stl`;
    }
    if (category === 'box') {
      const csgTag = boxParams.cutouts.length > 0 ? `_csg${boxParams.cutouts.length}` : '';
      return `AD5X_kutu_${boxParams.lidMode}${csgTag}_${Math.round(boxParams.width)}x${Math.round(boxParams.depth)}x${Math.round(boxParams.height)}mm.stl`;
    }
    if (category === 'plate') {
      if (plateParams.mode === 'spacer') {
        const th = plateParams.spacerThreaded ? '_disli' : '';
        return `AD5X_spacer_${plateParams.spacerShape}${th}_od${plateParams.outerDiameter}_id${plateParams.innerDiameter}_h${plateParams.spacerHeight}mm.stl`;
      }
      return `AD5X_montaj_plakasi_${plateParams.holeStyle}_${Math.round(plateParams.width)}x${Math.round(plateParams.depth)}x${plateParams.thickness}mm.stl`;
    }
    if (fastenerParams.mode === 'bolt') {
      const nutSuffix = fastenerParams.boltIncludeNut ? '_somunlu' : '';
      return `AD5X_civata_M${fastenerParams.threadDiameter}_p${fastenerParams.threadPitch}_L${fastenerParams.boltShaftLength}${nutSuffix}.stl`;
    }
    if (fastenerParams.mode === 'nut') {
      return `AD5X_civata_deligi_${fastenerParams.nutShape}_M${fastenerParams.threadDiameter}_p${fastenerParams.threadPitch}.stl`;
    }
    if (fastenerParams.mode === 'threadedCap') {
      return `AD5X_disli_kapak_${fastenerParams.capMode}_d${Math.round(fastenerParams.jarDiameter)}_h${Math.round(fastenerParams.jarHeight)}mm.stl`;
    }
    return `AD5X_disli_cark_m${fastenerParams.gearModule}_z${fastenerParams.gearTeeth}_h${fastenerParams.gearThickness}mm.stl`;
  };

  const handleExportSTL = () => {
    const rawFilename = buildFilename();
    const { filename, byteLength, triangleCount, savePromise } =
      downloadBinarySTL(orientedGeometry, rawFilename);
    const kb = (byteLength / 1024).toFixed(1);
    const baseMsg = `${filename} indirildi (${kb} KB • ${triangleCount.toLocaleString('tr-TR')} üçgen)`;
    setExportNotice(baseMsg);

    void savePromise.then((savedPath) => {
      if (savedPath) {
        setExportNotice(`${filename} → exports/ klasörüne kaydedildi (${kb} KB)`);
      }
    });

    window.setTimeout(() => {
      setExportNotice((prev) =>
        prev && prev.startsWith(filename) ? null : prev
      );
    }, 5000);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0f14] text-slate-100 overflow-hidden">
      {/* Üst CAD Başlık & Flashforge AD5X Profil Çubuğu */}
      <header className="h-14 shrink-0 bg-[#0e141c] border-b border-slate-800/90 px-3 flex items-center justify-between gap-3">
        {/* Marka / Flashforge AD5X Profili */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <SlidersHorizontal className="w-4 h-4 text-slate-950 stroke-[2.5]" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold tracking-tight text-slate-100">
              Parametrik 3D STL Üreteci
            </h1>
            <p className="text-[10px] font-mono text-cyan-400/90 tracking-wide">
              Flashforge AD5X (220×220×220 mm • CoreXY)
            </p>
          </div>
        </div>

        {/* Parça Kategorisi Sekmeleri */}
        <nav className="flex items-center gap-0.5 bg-[#090d12] p-1 rounded-lg border border-slate-800/90 min-w-0 overflow-x-auto">
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const isSim = tab.id === 'simulator';
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all shrink-0 cursor-pointer ${
                  active
                    ? isSim
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sağ Araçlar: Malzeme (Tolerans) + AI Asistan + STL İndir */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Malzeme & Kalibre Tolerans Seçici (Simülatör + AI ile Dinamik Senkron) */}
          <div className="flex items-center gap-1.5 bg-[#090d12] border border-slate-800 rounded-md px-2 py-1">
            <select
              value={material}
              onChange={(e) => setMaterial(e.target.value as MaterialType)}
              aria-label="Filament Malzemesi ve AD5X Toleransı"
              title="Malzeme seçimi Simülatör tolerans eşiğini ve AI önerilerini otomatik günceller"
              className="bg-transparent text-xs font-mono text-cyan-200 focus:outline-none cursor-pointer"
            >
              {(Object.keys(MATERIALS) as MaterialType[]).map((m) => (
                <option key={m} value={m} className="bg-[#0e141c] text-slate-100">
                  {m} ({MATERIALS[m].toleranceMm.toFixed(2)}mm)
                </option>
              ))}
            </select>
            {activeTab !== 'simulator' && (
              <>
                <span className="text-slate-700 hidden 2xl:inline">|</span>
                <select
                  value={infillPercent}
                  onChange={(e) => setInfillPercent(Number(e.target.value))}
                  aria-label="Doluluk Oranı"
                  className="bg-transparent text-xs font-mono text-slate-300 focus:outline-none cursor-pointer hidden 2xl:inline"
                >
                  {[15, 20, 30, 50, 100].map((p) => (
                    <option key={p} value={p} className="bg-[#0e141c]">
                      %{p} Doluluk
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* AI Tasarım & Analiz Asistanı Butonu */}
          {activeTab !== 'simulator' && (
            <button
              type="button"
              onClick={() => setAiPanelOpen((v) => !v)}
              title="Gemini AI Tasarım, Görsel Analiz ve AD5X Baskı Yönü Asistanı"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                aiPanelOpen
                  ? 'bg-violet-500/25 text-violet-200 border-violet-400/60 shadow-lg shadow-violet-500/15'
                  : 'bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border-violet-500/40'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>AI Asistan</span>
            </button>
          )}

          {/* Binary STL İndir Butonu */}
          {activeTab !== 'simulator' && (
            <button
              onClick={handleExportSTL}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>STL İndir</span>
            </button>
          )}
        </div>
      </header>

      {/* Ana Çalışma Alanı */}
      {activeTab === 'simulator' ? (
        <main className="flex-1 flex min-h-0 overflow-hidden">
          <SimulatorWorkspace material={material} />
        </main>
      ) : (
        <>
          <main className="flex-1 flex min-h-0 overflow-hidden relative">
            <ParameterPanel
              category={category}
              sieveParams={sieveParams}
              boxParams={boxParams}
              plateParams={plateParams}
              fastenerParams={fastenerParams}
              onSieveChange={setSieveParams}
              onBoxChange={setBoxParams}
              onPlateChange={setPlateParams}
              onFastenerChange={setFastenerParams}
              warnings={stats.warnings}
              holeCount={generated.holeCount}
            />

            <Viewport3D
              geometry={orientedGeometry}
              options={viewportOptions}
              onOptionsChange={(patch) =>
                setViewportOptions((prev) => ({ ...prev, ...patch }))
              }
              fitsPrinter={stats.fitsPrinter}
              ghostMeshes={
                category === 'box' && !isRotated
                  ? generated.ghostMeshes
                  : undefined
              }
              selectedGhostId={category === 'box' ? selectedBoxHoleId : null}
              onSelectGhost={
                category === 'box'
                  ? (id) => setSelectedBoxHoleId(id)
                  : undefined
              }
            />

            {/* Kutu CSG Sağ Paneli (AI paneli kapalıyken gösterilir) */}
            {category === 'box' && !aiPanelOpen && (
              <BoxCutoutPanel
                boxParams={boxParams}
                selectedHoleId={selectedBoxHoleId}
                onSelectHole={setSelectedBoxHoleId}
                onBoxChange={setBoxParams}
              />
            )}

            {/* Gemini AI Tasarım & AD5X Baskı Analizi Paneli */}
            <AIAssistantPanel
              isOpen={aiPanelOpen}
              onClose={() => setAiPanelOpen(false)}
              activeCategory={category}
              material={material}
              boxParams={boxParams}
              sieveParams={sieveParams}
              plateParams={plateParams}
              fastenerParams={fastenerParams}
              baseGeometry={generated.geometry}
              printRotationDeg={printRotationDeg}
              onApplyPrintRotation={setPrintRotationDeg}
              onApplyAICadPatch={handleApplyAICadPatch}
            />

            {/* İndirme Bildirimi (Toast) */}
            {exportNotice && (
              <div className="absolute bottom-12 right-3 z-30 flex items-center gap-2 bg-emerald-950/95 border border-emerald-500/50 text-emerald-200 px-3.5 py-2 rounded-lg shadow-2xl text-xs font-medium backdrop-blur-md">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-mono">{exportNotice}</span>
              </div>
            )}
          </main>

          {/* Alt İstatistik & Manifold Doğrulama Çubuğu */}
          <MeshStatsBar
            stats={stats}
            material={material}
            infillPercent={infillPercent}
          />
        </>
      )}
    </div>
  );
}
