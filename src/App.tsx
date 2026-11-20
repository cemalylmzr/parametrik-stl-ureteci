import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
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
import { Viewport3D } from './components/Viewport3D';
import { ParameterPanel } from './components/ParameterPanel';
import { MeshStatsBar } from './components/MeshStatsBar';
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
    subtitle: 'Gövde & geçmeli kapak',
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

  const [material, setMaterial] = useState<MaterialType>('PLA');
  const [infillPercent, setInfillPercent] = useState<number>(20);
  const [viewportOptions, setViewportOptions] = useState<ViewportOptions>({
    showWireframe: false,
    showBuildPlate: true,
    showGrid: true,
    showAxes: true,
    meshColor: '#0ea5e9',
  });

  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Parametreler değiştikçe watertight BufferGeometry üret
  const generated = useMemo(() => {
    if (category === 'sieve') return generateHoneycombSieve(sieveParams);
    if (category === 'box') return generateParametricBox(boxParams);
    if (category === 'plate') return generateMountingPlate(plateParams);
    return generateFastenerOrGear(fastenerParams);
  }, [category, sieveParams, boxParams, plateParams, fastenerParams]);

  // Eski geometri değiştiğinde GPU belleğini temizle
  useEffect(() => {
    return () => {
      generated.geometry.dispose();
    };
  }, [generated]);

  // Gerçek zamanlı manifold doğrulama, ölçüler ve filament hesabı
  const stats = useMemo(
    () =>
      computeMeshStats(
        generated.geometry,
        material,
        infillPercent,
        generated.warnings
      ),
    [generated, material, infillPercent]
  );

  // Anlamlı, dilimleyici dostu dosya adı üretimi
  const buildFilename = (): string => {
    if (category === 'sieve') {
      const shapeTag =
        sieveParams.shape === 'circle'
          ? `d${Math.round(sieveParams.width)}`
          : `${Math.round(sieveParams.width)}x${Math.round(sieveParams.depth)}`;
      return `elek_${sieveParams.holeType}_${shapeTag}_h${sieveParams.rimHeight.toFixed(1)}mm.stl`;
    }
    if (category === 'box') {
      return `kutu_${boxParams.lidMode}_${Math.round(boxParams.width)}x${Math.round(boxParams.depth)}x${Math.round(boxParams.height)}mm.stl`;
    }
    if (category === 'plate') {
      if (plateParams.mode === 'spacer') {
        const th = plateParams.spacerThreaded ? '_disli' : '';
        return `spacer_${plateParams.spacerShape}${th}_od${plateParams.outerDiameter}_id${plateParams.innerDiameter}_h${plateParams.spacerHeight}mm.stl`;
      }
      return `montaj_plakasi_${plateParams.holeStyle}_${Math.round(plateParams.width)}x${Math.round(plateParams.depth)}x${plateParams.thickness}mm.stl`;
    }
    if (fastenerParams.mode === 'bolt') {
      const nutSuffix = fastenerParams.boltIncludeNut ? '_somunlu' : '';
      return `civata_M${fastenerParams.threadDiameter}_p${fastenerParams.threadPitch}_L${fastenerParams.boltShaftLength}${nutSuffix}.stl`;
    }
    if (fastenerParams.mode === 'nut') {
      return `civata_deligi_${fastenerParams.nutShape}_M${fastenerParams.threadDiameter}_p${fastenerParams.threadPitch}.stl`;
    }
    if (fastenerParams.mode === 'threadedCap') {
      return `disli_kapak_${fastenerParams.capMode}_d${Math.round(fastenerParams.jarDiameter)}_h${Math.round(fastenerParams.jarHeight)}mm.stl`;
    }
    return `disli_cark_m${fastenerParams.gearModule}_z${fastenerParams.gearTeeth}_h${fastenerParams.gearThickness}mm.stl`;
  };

  const handleExportSTL = () => {
    const filename = buildFilename();
    const { byteLength, triangleCount, savePromise } = downloadBinarySTL(
      generated.geometry,
      filename
    );
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
      {/* Üst CAD Başlık & Araç Çubuğu */}
      <header className="h-14 shrink-0 bg-[#0e141c] border-b border-slate-800/90 px-4 flex items-center justify-between gap-4">
        {/* Marka / Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <SlidersHorizontal className="w-4 h-4 text-slate-950 stroke-[2.5]" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold tracking-tight text-slate-100">
              Parametrik 3D STL Üreteci
            </h1>
            <p className="text-[10px] font-mono text-cyan-400/80 uppercase tracking-wider">
              Flashforge AD5X • 220³ mm • Orca Ready
            </p>
          </div>
        </div>

        {/* Parça Kategorisi Sekmeleri */}
        <nav className="flex items-center gap-1 bg-[#090d12] p-1 rounded-lg border border-slate-800/90 overflow-x-auto">
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const isSim = tab.id === 'simulator';
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
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

        {/* Filament Seçimi + Binary STL İndir Butonu (CAD Üreteci Sekmelerinde) */}
        {activeTab !== 'simulator' ? (
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden xl:flex items-center gap-1.5 bg-[#090d12] border border-slate-800 rounded-md px-2 py-1">
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value as MaterialType)}
                aria-label="Filament Malzemesi"
                className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer"
              >
                {(Object.keys(MATERIALS) as MaterialType[]).map((m) => (
                  <option key={m} value={m} className="bg-[#0e141c]">
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-slate-700">|</span>
              <select
                value={infillPercent}
                onChange={(e) => setInfillPercent(Number(e.target.value))}
                aria-label="Doluluk Oranı"
                className="bg-transparent text-xs font-mono text-slate-300 focus:outline-none cursor-pointer"
              >
                {[15, 20, 30, 50, 100].map((p) => (
                  <option key={p} value={p} className="bg-[#0e141c]">
                    %{p} Doluluk
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleExportSTL}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-slate-950 font-semibold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              Binary STL İndir
            </button>
          </div>
        ) : (
          <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-lg shrink-0">
            <Activity className="w-3.5 h-3.5" />
            STL Fit & Collision Simulator
          </div>
        )}
      </header>

      {/* Ana Çalışma Alanı */}
      {activeTab === 'simulator' ? (
        <main className="flex-1 flex min-h-0 overflow-hidden">
          <SimulatorWorkspace />
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
              geometry={generated.geometry}
              options={viewportOptions}
              onOptionsChange={(patch) =>
                setViewportOptions((prev) => ({ ...prev, ...patch }))
              }
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
