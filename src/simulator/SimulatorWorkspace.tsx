import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Check,
  Download,
  Eye,
  EyeOff,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { downloadBinarySTL } from '../geometry/stlExporter';
import { MATERIALS, MaterialType } from '../geometry/types';
import {
  AxisKey,
  AutoFixMode,
  CollisionReport,
  EMPTY_COLLISION_REPORT,
  LoadedSTLPart,
  SimulationCollisionStop,
  SimulationConfig,
} from './types';
import {
  analyzeSceneCollisions,
  applyAutoFixToPart,
  buildExportableGeometry,
  createDemoBoxLidPair,
  createDemoGearPair,
  createDemoRailSliderPair,
  loadSTLFile,
  restoreOriginalPartGeometry,
} from './collisionEngine';
import { SimulatorViewport } from './SimulatorViewport';

interface PrecisionSliderProps {
  label: string;
  colorClass?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (val: number) => void;
  nudgeStep?: number;
}

const PrecisionSlider: React.FC<PrecisionSliderProps> = ({
  label,
  colorClass = 'text-slate-300',
  value,
  min,
  max,
  step,
  unit,
  onChange,
  nudgeStep,
}) => {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1.5">
        <span className={`text-xs font-mono font-semibold ${colorClass}`}>
          {label}
        </span>
        <div className="flex items-center gap-1">
          {nudgeStep && (
            <button
              type="button"
              onClick={() => onChange(round(value - nudgeStep))}
              title={`-${nudgeStep} ${unit}`}
              className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
            >
              -{nudgeStep}
            </button>
          )}
          <div className="flex items-center bg-[#0b0f14] border border-slate-700/80 focus-within:border-cyan-500 rounded px-1.5 py-0.5">
            <input
              type="number"
              value={Number(value.toFixed(2))}
              step={step}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) onChange(v);
              }}
              className="w-14 bg-transparent text-right text-xs font-mono tabular-nums text-cyan-200 focus:outline-none"
            />
            <span className="text-[10px] font-mono text-slate-500 ml-1">
              {unit}
            </span>
          </div>
          {nudgeStep && (
            <button
              type="button"
              onClick={() => onChange(round(value + nudgeStep))}
              title={`+${nudgeStep} ${unit}`}
              className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
            >
              +{nudgeStep}
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="cad-slider w-full"
      />
    </div>
  );
};

interface SimulatorWorkspaceProps {
  material: MaterialType;
}

export const SimulatorWorkspace: React.FC<SimulatorWorkspaceProps> = ({
  material,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const matSpec = MATERIALS[material];

  const [parts, setParts] = useState<LoadedSTLPart[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [toleranceMm, setToleranceMm] = useState<number>(matSpec.toleranceMm);
  const [report, setReport] = useState<CollisionReport>(EMPTY_COLLISION_REPORT);

  const [simConfig, setSimConfig] = useState<SimulationConfig>({
    motionMode: 'linear',
    startPos: { x: -30, y: 0, z: 4.25 },
    endPos: { x: 30, y: 0, z: 4.25 },
    rotateAxis: 'z',
    startAngleDeg: 0,
    endAngleDeg: 360,
    speed: 1.0,
    pingPong: true,
    stopOnCollision: true,
    progress: 0,
    isPlaying: false,
  });

  const [collisionStop, setCollisionStop] =
    useState<SimulationCollisionStop | null>(null);

  // Otomatik Düzeltme ayarları
  const [fixAxis, setFixAxis] = useState<'auto' | AxisKey>('auto');
  const [fixMode, setFixMode] = useState<AutoFixMode>('shrink');
  const [fixClearanceMm, setFixClearanceMm] = useState<number>(matSpec.toleranceMm);
  const [bakeWorldOnExport, setBakeWorldOnExport] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Üst bardaki malzeme (PLA 0.25 / PETG 0.30 / ASA-ABS 0.35 mm) değiştiğinde tolerans eşiğini dinamik güncelle
  useEffect(() => {
    setToleranceMm(matSpec.toleranceMm);
    setFixClearanceMm(matSpec.toleranceMm);
  }, [matSpec.toleranceMm]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 5000);
  }, []);

  // Parça bellek temizleme yardımcısı
  const disposeParts = (list: LoadedSTLPart[]) => {
    for (const p of list) {
      p.geometry.dispose();
    }
  };

  // Örnek sahne yükleyicileri
  const loadDemo = useCallback((kind: 'rail' | 'box' | 'gear') => {
    setSimConfig((s) => ({ ...s, isPlaying: false, progress: 0 }));
    setCollisionStop(null);

    const demo =
      kind === 'rail'
        ? createDemoRailSliderPair()
        : kind === 'box'
          ? createDemoBoxLidPair()
          : createDemoGearPair();

    setParts((prev) => {
      disposeParts(prev);
      return [demo.staticPart, demo.movingPart];
    });
    setSelectedPartId(demo.movingPart.id);

    if (kind === 'gear') {
      setSimConfig((s) => ({
        ...s,
        motionMode: 'rotate',
        rotateAxis: 'z',
        startAngleDeg: 12.85,
        endAngleDeg: 372.85,
        startPos: demo.startPos,
        endPos: demo.endPos,
        progress: 0,
        isPlaying: false,
      }));
    } else {
      setSimConfig((s) => ({
        ...s,
        motionMode: 'linear',
        startPos: demo.startPos,
        endPos: demo.endPos,
        progress: 0,
        isPlaying: false,
      }));
    }
  }, []);

  // İlk açılışta örnek Ray + Kızak test sahnesini yükle
  useEffect(() => {
    loadDemo('rail');
    return () => {
      setParts((prev) => {
        disposeParts(prev);
        return [];
      });
    };
  }, [loadDemo]);

  // Çoklu STL dosya yükleme
  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const stlFiles = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith('.stl')
    );
    if (stlFiles.length === 0) {
      showToast('Lütfen yalnızca .stl uzantılı dosyalar seçin.');
      return;
    }

    const hasStaticAlready = parts.some((p) => p.role === 'static');
    const loaded: LoadedSTLPart[] = [];

    for (let i = 0; i < stlFiles.length; i++) {
      const role =
        !hasStaticAlready && i === 0 ? 'static' : 'moving';
      try {
        const part = await loadSTLFile(stlFiles[i], role, true);
        loaded.push(part);
      } catch (err) {
        showToast(`STL okuma hatası (${stlFiles[i].name}): ${String(err)}`);
      }
    }

    if (loaded.length > 0) {
      setParts((prev) => [...prev, ...loaded]);
      const lastMoving =
        [...loaded].reverse().find((p) => p.role === 'moving') ?? loaded[0];
      setSelectedPartId(lastMoving.id);
      setCollisionStop(null);

      // Yeni hareketli parça için varsayılan doğrusal hareket aralığı ata
      setSimConfig((s) => ({
        ...s,
        isPlaying: false,
        progress: 0,
        startPos: { ...lastMoving.position },
        endPos: {
          x: lastMoving.position.x + 30,
          y: lastMoving.position.y,
          z: lastMoving.position.z,
        },
      }));
      showToast(`${loaded.length} STL dosyası sahneye yüklendi.`);
    }
  };

  // Gerçek zamanlı three-mesh-bvh çakışma & tolerans analizi
  // (Animasyon oynarken step() zaten hesapladığı için çift hesaplama yapılmaz)
  useEffect(() => {
    if (simConfig.isPlaying) return;
    if (parts.length < 2) {
      setReport(EMPTY_COLLISION_REPORT);
      return;
    }
    const nextReport = analyzeSceneCollisions(parts, toleranceMm);
    setReport(nextReport);
  }, [parts, toleranceMm, simConfig.isPlaying]);

  // Hareketli parçayı ve seçili parçayı bul
  const selectedPart = useMemo(
    () => parts.find((p) => p.id === selectedPartId) ?? parts[0] ?? null,
    [parts, selectedPartId]
  );

  const movingPart = useMemo(
    () => parts.find((p) => p.role === 'moving') ?? null,
    [parts]
  );

  // Belirli bir progress (0..1) değerinde hareketli parçanın konum/dönüşünü uygula
  const applyProgressToMovingPart = useCallback(
    (progressVal: number, cfg: SimulationConfig, currentParts: LoadedSTLPart[]) => {
      const t = Math.max(0, Math.min(1, progressVal));
      return currentParts.map((p) => {
        if (p.role !== 'moving') return p;
        if (cfg.motionMode === 'linear') {
          return {
            ...p,
            position: {
              x: Number(
                (cfg.startPos.x + (cfg.endPos.x - cfg.startPos.x) * t).toFixed(3)
              ),
              y: Number(
                (cfg.startPos.y + (cfg.endPos.y - cfg.startPos.y) * t).toFixed(3)
              ),
              z: Number(
                (cfg.startPos.z + (cfg.endPos.z - cfg.startPos.z) * t).toFixed(3)
              ),
            },
          };
        } else {
          const angle = Number(
            (
              cfg.startAngleDeg +
              (cfg.endAngleDeg - cfg.startAngleDeg) * t
            ).toFixed(2)
          );
          return {
            ...p,
            rotationDeg: {
              ...p.rotationDeg,
              [cfg.rotateAxis]: angle,
            },
          };
        }
      });
    },
    []
  );

  // Animasyon döngüsü (İleri-Geri Kaydırma / Dönme + Çakışmada Anında Durdurma)
  const directionRef = useRef<1 | -1>(1);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const simRef = useRef(simConfig);
  simRef.current = simConfig;
  const tolRef = useRef(toleranceMm);
  tolRef.current = toleranceMm;

  useEffect(() => {
    if (!simConfig.isPlaying) return;

    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const cfg = simRef.current;
      if (!cfg.isPlaying) return;

      const deltaProgress = dt * 0.35 * cfg.speed * directionRef.current;
      let nextProgress = cfg.progress + deltaProgress;

      if (nextProgress >= 1) {
        if (cfg.pingPong) {
          nextProgress = 1;
          directionRef.current = -1;
        } else {
          nextProgress = 1;
        }
      } else if (nextProgress <= 0) {
        if (cfg.pingPong) {
          nextProgress = 0;
          directionRef.current = 1;
        } else {
          nextProgress = 0;
        }
      }

      const updatedParts = applyProgressToMovingPart(
        nextProgress,
        cfg,
        partsRef.current
      );
      const nextReport = analyzeSceneCollisions(updatedParts, tolRef.current);

      setParts(updatedParts);
      setReport(nextReport);

      if (cfg.stopOnCollision && nextReport.hasCollision) {
        const mv = updatedParts.find((p) => p.role === 'moving');
        setSimConfig((prev) => ({
          ...prev,
          progress: nextProgress,
          isPlaying: false,
        }));
        if (mv) {
          setCollisionStop({
            position: { ...mv.position },
            rotationDeg: { ...mv.rotationDeg },
            progress: nextProgress,
            maxPenetrationMm: nextReport.maxPenetrationMm,
            dominantAxis: nextReport.dominantAxis,
          });
        }
        return;
      }

      const finishedOneWay = !cfg.pingPong && nextProgress >= 1;
      setSimConfig((prev) => ({
        ...prev,
        progress: nextProgress,
        isPlaying: !finishedOneWay,
      }));

      if (!finishedOneWay) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [simConfig.isPlaying, applyProgressToMovingPart]);

  // Manuel zaman çizelgesi (scrubber)
  const handleScrub = (val: number) => {
    setCollisionStop(null);
    setSimConfig((prev) => ({ ...prev, progress: val, isPlaying: false }));
    setParts((prev) => applyProgressToMovingPart(val, simConfig, prev));
  };

  // Seçili parça konum/döndürme güncelle
  const updateSelectedPart = (
    updater: (part: LoadedSTLPart) => LoadedSTLPart
  ) => {
    if (!selectedPart) return;
    setCollisionStop(null);
    setParts((prev) =>
      prev.map((p) => (p.id === selectedPart.id ? updater(p) : p))
    );
  };

  // Otomatik Düzeltme (Auto-Fix) uygula
  const handleAutoFix = () => {
    const target = movingPart ?? selectedPart;
    if (!target) {
      showToast('Düzeltilecek hareketli bir parça bulunamadı.');
      return;
    }

    const effectiveAxis: AxisKey =
      fixAxis === 'auto' ? report.dominantAxis : fixAxis;
    const pen = report.hasCollision ? report.maxPenetrationMm : 0;

    const fixedPart = applyAutoFixToPart(
      target,
      effectiveAxis,
      fixMode,
      pen,
      fixClearanceMm,
      report.escapeSign
    );

    setParts((prev) =>
      prev.map((p) => {
        if (p.id !== target.id) return p;
        // Eğer yeni geometri oluşturulduysa eskisini temizle
        if (fixedPart.geometry !== p.geometry) {
          p.geometry.dispose();
        }
        return fixedPart;
      })
    );
    setCollisionStop(null);
    showToast(
      `Otomatik düzeltme uygulandı: ${fixedPart.appliedFixNote ?? ''}`
    );
  };

  const handleRestoreOriginal = () => {
    const target = movingPart ?? selectedPart;
    if (!target) return;
    const restored = restoreOriginalPartGeometry(target);
    setParts((prev) =>
      prev.map((p) => {
        if (p.id !== target.id) return p;
        p.geometry.dispose();
        return restored;
      })
    );
    setCollisionStop(null);
    showToast(`${target.name} orijinal geometrisine geri döndürüldü.`);
  };

  // Düzeltilmiş parçayı Binary STL olarak D:\...\exports klasörüne + tarayıcıya kaydet
  const handleExportCorrectedSTL = () => {
    const target = movingPart ?? selectedPart;
    if (!target) {
      showToast('Dışa aktarılacak parça bulunamadı.');
      return;
    }

    const exportGeo = buildExportableGeometry(target, bakeWorldOnExport);
    const cleanBase = target.name.replace(/\.stl$/i, '');
    const axisTag = fixAxis === 'auto' ? report.dominantAxis : fixAxis;
    const rawFilename = `${cleanBase}_duzeltilmis_${axisTag}_${fixClearanceMm.toFixed(2)}mm.stl`;

    const { filename, byteLength, savePromise } = downloadBinarySTL(
      exportGeo,
      rawFilename
    );
    exportGeo.dispose();

    const kb = (byteLength / 1024).toFixed(1);
    showToast(`${filename} indirildi (${kb} KB)`);

    void savePromise.then((savedPath) => {
      if (savedPath) {
        showToast(
          `${filename} → D:\\...\\exports klasörüne kaydedildi (${kb} KB)`
        );
      }
    });
  };

  const effectiveFixAxis: AxisKey =
    fixAxis === 'auto' ? report.dominantAxis : fixAxis;

  return (
    <div className="flex-1 flex min-h-0 w-full overflow-hidden relative bg-[#0b0f14]">
      {/* Gizli Çoklu STL Dosya Seçici */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleUploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* ==================== SOL PANEL: STL YÜKLEME & HİZALAMA ==================== */}
      <aside className="relative z-20 w-[340px] shrink-0 h-full bg-[#111720] border-r border-slate-800/90 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/90 bg-[#0f151e] flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              STL Parçalar & Hizalama
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Çoklu STL yükle • 0.05 mm hassas konum
            </p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            STL Yükle
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Hazır Test Çiftleri */}
          <div className="pb-3 border-b border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                Hızlı Test Senaryoları
              </span>
              {parts.length > 0 && (
                <button
                  onClick={() => {
                    setSimConfig((s) => ({ ...s, isPlaying: false }));
                    setCollisionStop(null);
                    setParts((prev) => {
                      disposeParts(prev);
                      return [];
                    });
                    setSelectedPartId(null);
                  }}
                  className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                >
                  Sahneyi Temizle
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => loadDemo('rail')}
                className="text-[11px] py-1.5 px-2 rounded bg-slate-800/80 hover:bg-cyan-500/20 text-slate-200 border border-slate-700/80 hover:border-cyan-500/40 transition-colors"
              >
                Ray + Kızak
              </button>
              <button
                onClick={() => loadDemo('box')}
                className="text-[11px] py-1.5 px-2 rounded bg-slate-800/80 hover:bg-cyan-500/20 text-slate-200 border border-slate-700/80 hover:border-cyan-500/40 transition-colors"
              >
                Kutu + Kapak
              </button>
              <button
                onClick={() => loadDemo('gear')}
                className="text-[11px] py-1.5 px-2 rounded bg-slate-800/80 hover:bg-cyan-500/20 text-slate-200 border border-slate-700/80 hover:border-cyan-500/40 transition-colors"
              >
                İki Dişli
              </button>
            </div>
          </div>

          {/* Yüklü STL Listesi + X, Y, Z Sınır Kutusu */}
          <div className="pb-3 border-b border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Yüklü Parçalar ({parts.length})
              </h3>
              <span className="text-[10px] text-slate-500">
                Sürükle-bırak destekli
              </span>
            </div>

            {parts.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-6 px-3 rounded-lg border border-dashed border-slate-700 hover:border-cyan-500/60 bg-[#0b0f14] text-center space-y-1.5 transition-colors cursor-pointer"
              >
                <Upload className="w-5 h-5 text-slate-500 mx-auto" />
                <p className="text-xs text-slate-300 font-medium">
                  Birden fazla .STL dosyası seçin
                </p>
                <p className="text-[10px] text-slate-500">
                  Ana gövde/ray ve hareketli parçayı birlikte yükleyin
                </p>
              </button>
            ) : (
              <div className="space-y-2">
                {parts.map((part) => {
                  const isSelected = selectedPart?.id === part.id;
                  return (
                    <div
                      key={part.id}
                      onClick={() => setSelectedPartId(part.id)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-cyan-500/10 border-cyan-500/50'
                          : 'bg-[#0b0f14] border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: part.baseColor }}
                          />
                          <span
                            className="text-xs font-medium text-slate-200 truncate"
                            title={part.name}
                          >
                            {part.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setParts((prev) =>
                                prev.map((p) => {
                                  if (p.id !== part.id) return p;
                                  const nextRole =
                                    p.role === 'static' ? 'moving' : 'static';
                                  return {
                                    ...p,
                                    role: nextRole,
                                    baseColor:
                                      nextRole === 'static'
                                        ? '#38bdf8'
                                        : '#10b981',
                                    opacity: nextRole === 'static' ? 0.72 : 0.96,
                                  };
                                })
                              );
                            }}
                            title="Sabit / Hareketli rolünü değiştir"
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                              part.role === 'static'
                                ? 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                            }`}
                          >
                            {part.role === 'static' ? 'Sabit' : 'Hareketli'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setParts((prev) =>
                                prev.map((p) =>
                                  p.id === part.id
                                    ? { ...p, visible: !p.visible }
                                    : p
                                )
                              );
                            }}
                            className="p-1 text-slate-400 hover:text-slate-200"
                            title="Görünürlük"
                          >
                            {part.visible ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setParts((prev) => {
                                const rem = prev.find((p) => p.id === part.id);
                                if (rem) rem.geometry.dispose();
                                return prev.filter((p) => p.id !== part.id);
                              });
                            }}
                            className="p-1 text-slate-500 hover:text-rose-400"
                            title="Parçayı Kaldır"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Bounding Box Ölçüleri (mm) */}
                      <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                        <span>
                          <span className="text-red-400/90">X</span>{' '}
                          {part.bboxSize.x.toFixed(2)}{' '}
                          <span className="text-slate-600">×</span>{' '}
                          <span className="text-green-400/90">Y</span>{' '}
                          {part.bboxSize.y.toFixed(2)}{' '}
                          <span className="text-slate-600">×</span>{' '}
                          <span className="text-blue-400/90">Z</span>{' '}
                          {part.bboxSize.z.toFixed(2)} mm
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {part.triangleCount.toLocaleString('tr-TR')}Δ
                        </span>
                      </div>

                      {part.appliedFixNote && (
                        <div className="mt-1.5 text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5">
                          ✓ {part.appliedFixNote}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 0.05 mm Hassas Pozisyon ve Döndürme Kontrolü */}
          {selectedPart && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">
                  Konum & Döndürme (0.05 mm)
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    updateSelectedPart((p) => ({
                      ...p,
                      position: { x: 0, y: 0, z: 0 },
                      rotationDeg: { x: 0, y: 0, z: 0 },
                    }))
                  }
                  className="text-[10px] text-slate-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Sıfırla
                </button>
              </div>

              <div className="space-y-2.5 bg-[#0c1118] border border-slate-800/80 rounded-lg p-2.5">
                <PrecisionSlider
                  label="X"
                  colorClass="text-red-400"
                  value={selectedPart.position.x}
                  min={-110}
                  max={110}
                  step={0.05}
                  nudgeStep={0.05}
                  unit="mm"
                  onChange={(x) =>
                    updateSelectedPart((p) => ({
                      ...p,
                      position: { ...p.position, x },
                    }))
                  }
                />
                <PrecisionSlider
                  label="Y"
                  colorClass="text-green-400"
                  value={selectedPart.position.y}
                  min={-110}
                  max={110}
                  step={0.05}
                  nudgeStep={0.05}
                  unit="mm"
                  onChange={(y) =>
                    updateSelectedPart((p) => ({
                      ...p,
                      position: { ...p.position, y },
                    }))
                  }
                />
                <PrecisionSlider
                  label="Z"
                  colorClass="text-blue-400"
                  value={selectedPart.position.z}
                  min={-60}
                  max={150}
                  step={0.05}
                  nudgeStep={0.05}
                  unit="mm"
                  onChange={(z) =>
                    updateSelectedPart((p) => ({
                      ...p,
                      position: { ...p.position, z },
                    }))
                  }
                />
              </div>

              {/* Döndürme (RX, RY, RZ) */}
              <div className="space-y-2.5 bg-[#0c1118] border border-slate-800/80 rounded-lg p-2.5">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Döndürme Açısı</span>
                  <div className="flex gap-1">
                    {(['x', 'y', 'z'] as const).map((ax) => (
                      <button
                        key={ax}
                        type="button"
                        onClick={() =>
                          updateSelectedPart((p) => ({
                            ...p,
                            rotationDeg: {
                              ...p.rotationDeg,
                              [ax]: (p.rotationDeg[ax] + 90) % 360,
                            },
                          }))
                        }
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 font-mono"
                      >
                        {ax.toUpperCase()}+90°
                      </button>
                    ))}
                  </div>
                </div>
                <PrecisionSlider
                  label="RX"
                  colorClass="text-red-300"
                  value={selectedPart.rotationDeg.x}
                  min={-180}
                  max={180}
                  step={0.5}
                  unit="°"
                  onChange={(x) =>
                    updateSelectedPart((p) => ({
                      ...p,
                      rotationDeg: { ...p.rotationDeg, x },
                    }))
                  }
                />
                <PrecisionSlider
                  label="RY"
                  colorClass="text-green-300"
                  value={selectedPart.rotationDeg.y}
                  min={-180}
                  max={180}
                  step={0.5}
                  unit="°"
                  onChange={(y) =>
                    updateSelectedPart((p) => ({
                      ...p,
                      rotationDeg: { ...p.rotationDeg, y },
                    }))
                  }
                />
                <PrecisionSlider
                  label="RZ"
                  colorClass="text-blue-300"
                  value={selectedPart.rotationDeg.z}
                  min={-180}
                  max={180}
                  step={0.5}
                  unit="°"
                  onChange={(z) =>
                    updateSelectedPart((p) => ({
                      ...p,
                      rotationDeg: { ...p.rotationDeg, z },
                    }))
                  }
                />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ==================== ORTA: 3D ÇAKIŞMA & SİMÜLASYON SAHNESİ ==================== */}
      <SimulatorViewport
        parts={parts}
        report={report}
        toleranceMm={toleranceMm}
        simConfig={simConfig}
        selectedPartId={selectedPart?.id ?? null}
        onDropFiles={(files) => void handleUploadFiles(files)}
      />

      {/* ==================== SAĞ PANEL: ANALİZ, SİMÜLASYON & OTO DÜZELTME ==================== */}
      <aside className="relative z-20 w-[330px] shrink-0 h-full bg-[#111720] border-l border-slate-800/90 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/90 bg-[#0f151e]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Çakışma & Hareket Simülatörü
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            three-mesh-bvh gerçek zamanlı tolerans analizi
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* 1. TOLERANS & BVH ANALİZ ÖZETİ */}
          <div className="pb-4 border-b border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                Tolerans Analizi
              </h3>
              <span className="text-[10px] font-mono text-slate-500">
                BVH: {report.computeTimeMs.toFixed(1)} ms
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {[
                { label: 'PLA 0.25', v: 0.25 },
                { label: 'PETG 0.30', v: 0.3 },
                { label: 'ASA 0.35', v: 0.35 },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setToleranceMm(t.v)}
                  className={`flex-1 py-1 text-[10px] font-mono rounded border transition-colors ${
                    Math.abs(toleranceMm - t.v) < 0.005
                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                      : 'bg-[#0b0f14] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <PrecisionSlider
              label="Kritik Uyarı Eşiği"
              colorClass="text-amber-300"
              value={toleranceMm}
              min={0.05}
              max={1.2}
              step={0.05}
              unit="mm"
              onChange={setToleranceMm}
            />

            {/* Sayısal Analiz Kartları */}
            <div className="grid grid-cols-2 gap-2">
              <div
                className={`p-2 rounded-lg border ${
                  report.hasCollision
                    ? 'bg-rose-950/60 border-rose-500/50'
                    : 'bg-[#0b0f14] border-slate-800'
                }`}
              >
                <div className="text-[10px] text-slate-400">Maks. Gömülme</div>
                <div
                  className={`text-sm font-mono font-bold tabular-nums mt-0.5 ${
                    report.hasCollision ? 'text-rose-300' : 'text-slate-300'
                  }`}
                >
                  {report.maxPenetrationMm.toFixed(2)} mm
                </div>
              </div>

              <div
                className={`p-2 rounded-lg border ${
                  !report.hasCollision && report.hasTightClearance
                    ? 'bg-amber-950/50 border-amber-500/50'
                    : 'bg-[#0b0f14] border-slate-800'
                }`}
              >
                <div className="text-[10px] text-slate-400">En Dar Boşluk</div>
                <div
                  className={`text-sm font-mono font-bold tabular-nums mt-0.5 ${
                    report.hasCollision
                      ? 'text-rose-400'
                      : report.hasTightClearance
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                  }`}
                >
                  {report.hasCollision
                    ? '0.00 mm'
                    : report.minClearanceMm !== null
                      ? `${report.minClearanceMm.toFixed(2)} mm`
                      : '> 15 mm'}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] bg-[#0b0f14] border border-slate-800/80 rounded px-2.5 py-1.5 font-mono">
              <span className="text-rose-400">
                Kırmızı: {report.collidingTriangleCountA + report.collidingTriangleCountB}Δ
              </span>
              <span className="text-amber-300">
                Sarı: {report.tightTriangleCountA + report.tightTriangleCountB}Δ
              </span>
              <span className="text-cyan-300">
                Eksen: {report.dominantAxis.toUpperCase()}
              </span>
            </div>
          </div>

          {/* 2. HAREKET SİMÜLASYONU (RAY / DİŞLİ TESTİ) */}
          <div className="pb-4 border-b border-slate-800/80 space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5 text-cyan-400" />
              Hareket Simülasyonu
            </h3>

            {/* Doğrusal / Dönme Modu */}
            <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded-md border border-slate-800">
              <button
                type="button"
                onClick={() =>
                  setSimConfig((s) => ({
                    ...s,
                    motionMode: 'linear',
                    isPlaying: false,
                  }))
                }
                className={`py-1 text-[11px] font-medium rounded flex items-center justify-center gap-1 ${
                  simConfig.motionMode === 'linear'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowRight className="w-3 h-3" /> Doğrusal (Ray)
              </button>
              <button
                type="button"
                onClick={() =>
                  setSimConfig((s) => ({
                    ...s,
                    motionMode: 'rotate',
                    isPlaying: false,
                  }))
                }
                className={`py-1 text-[11px] font-medium rounded flex items-center justify-center gap-1 ${
                  simConfig.motionMode === 'rotate'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <RotateCw className="w-3 h-3" /> Dönme (Dişli)
              </button>
            </div>

            {simConfig.motionMode === 'linear' ? (
              <div className="space-y-2 bg-[#0c1118] border border-slate-800/80 rounded-lg p-2.5">
                {/* Başlangıç Koordinatı */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold uppercase text-emerald-400">
                      Başlangıç (mm)
                    </span>
                    {movingPart && (
                      <button
                        type="button"
                        onClick={() =>
                          setSimConfig((s) => ({
                            ...s,
                            startPos: { ...movingPart.position },
                          }))
                        }
                        className="text-[10px] text-cyan-400 hover:underline"
                      >
                        Mevcut Konumu Al
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['x', 'y', 'z'] as const).map((ax) => (
                      <label
                        key={ax}
                        className="flex items-center bg-[#0b0f14] border border-slate-800 rounded px-1.5 py-1"
                      >
                        <span className="text-[10px] font-mono text-slate-500 mr-1 uppercase">
                          {ax}
                        </span>
                        <input
                          type="number"
                          step={0.5}
                          value={Number(simConfig.startPos[ax].toFixed(2))}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) {
                              setSimConfig((s) => ({
                                ...s,
                                startPos: { ...s.startPos, [ax]: v },
                              }));
                            }
                          }}
                          className="w-full bg-transparent text-right text-[11px] font-mono text-slate-200 focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Bitiş Koordinatı */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold uppercase text-amber-400">
                      Bitiş (mm)
                    </span>
                    {movingPart && (
                      <button
                        type="button"
                        onClick={() =>
                          setSimConfig((s) => ({
                            ...s,
                            endPos: { ...movingPart.position },
                          }))
                        }
                        className="text-[10px] text-cyan-400 hover:underline"
                      >
                        Mevcut Konumu Al
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['x', 'y', 'z'] as const).map((ax) => (
                      <label
                        key={ax}
                        className="flex items-center bg-[#0b0f14] border border-slate-800 rounded px-1.5 py-1"
                      >
                        <span className="text-[10px] font-mono text-slate-500 mr-1 uppercase">
                          {ax}
                        </span>
                        <input
                          type="number"
                          step={0.5}
                          value={Number(simConfig.endPos[ax].toFixed(2))}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) {
                              setSimConfig((s) => ({
                                ...s,
                                endPos: { ...s.endPos, [ax]: v },
                              }));
                            }
                          }}
                          className="w-full bg-transparent text-right text-[11px] font-mono text-slate-200 focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 bg-[#0c1118] border border-slate-800/80 rounded-lg p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Dönme Ekseni</span>
                  <div className="flex gap-1">
                    {(['x', 'y', 'z'] as const).map((ax) => (
                      <button
                        key={ax}
                        type="button"
                        onClick={() =>
                          setSimConfig((s) => ({ ...s, rotateAxis: ax }))
                        }
                        className={`px-2 py-0.5 text-[11px] font-mono rounded border ${
                          simConfig.rotateAxis === ax
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-[#0b0f14] text-slate-400 border-slate-800'
                        }`}
                      >
                        {ax.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center justify-between bg-[#0b0f14] border border-slate-800 rounded px-2 py-1">
                    <span className="text-[10px] text-slate-500">Başla°</span>
                    <input
                      type="number"
                      value={simConfig.startAngleDeg}
                      onChange={(e) =>
                        setSimConfig((s) => ({
                          ...s,
                          startAngleDeg: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-14 bg-transparent text-right text-xs font-mono text-slate-200 focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center justify-between bg-[#0b0f14] border border-slate-800 rounded px-2 py-1">
                    <span className="text-[10px] text-slate-500">Bitiş°</span>
                    <input
                      type="number"
                      value={simConfig.endAngleDeg}
                      onChange={(e) =>
                        setSimConfig((s) => ({
                          ...s,
                          endAngleDeg: parseFloat(e.target.value) || 360,
                        }))
                      }
                      className="w-14 bg-transparent text-right text-xs font-mono text-slate-200 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Oynatıcı Kontrolleri & Scrubber */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!movingPart}
                  onClick={() => {
                    setCollisionStop(null);
                    setSimConfig((s) => {
                      const restart = !s.isPlaying && s.progress >= 0.99;
                      if (restart) directionRef.current = 1;
                      return {
                        ...s,
                        progress: restart ? 0 : s.progress,
                        isPlaying: !s.isPlaying,
                      };
                    });
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    simConfig.isPlaying
                      ? 'bg-amber-500/20 text-amber-200 border border-amber-500/50'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                  }`}
                >
                  {simConfig.isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" /> Duraklat
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" /> Simülasyonu Oynat
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    directionRef.current = 1;
                    handleScrub(0);
                  }}
                  title="Başa Al"
                  className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSimConfig((s) => ({ ...s, pingPong: !s.pingPong }))
                  }
                  title="İleri-Geri Döngü (Ping-Pong)"
                  className={`p-1.5 rounded-md border ${
                    simConfig.pingPong
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-800 text-slate-500 border-slate-700'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>İlerleme</span>
                  <span className="text-cyan-300">
                    %{Math.round(simConfig.progress * 100)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.005}
                  value={simConfig.progress}
                  onChange={(e) => handleScrub(parseFloat(e.target.value))}
                  className="cad-slider w-full"
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={simConfig.stopOnCollision}
                    onChange={(e) =>
                      setSimConfig((s) => ({
                        ...s,
                        stopOnCollision: e.target.checked,
                      }))
                    }
                    className="w-3.5 h-3.5 accent-rose-500 rounded"
                  />
                  Çakışmada Durdur
                </label>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">Hız:</span>
                  {[0.5, 1, 2].map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() =>
                        setSimConfig((s) => ({ ...s, speed: sp }))
                      }
                      className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                        simConfig.speed === sp
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ÇAKIŞMA HATA KOORDİNATI BİLDİRİMİ */}
            {collisionStop && (
              <div className="p-2.5 rounded-lg bg-rose-950/75 border border-rose-500/60 text-rose-100 text-[11px] space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                  Çakışma Nedeniyle Durduruldu!
                </div>
                <div className="font-mono text-[11px] text-rose-200">
                  Koordinat: X {collisionStop.position.x.toFixed(2)} • Y{' '}
                  {collisionStop.position.y.toFixed(2)} • Z{' '}
                  {collisionStop.position.z.toFixed(2)} mm
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-rose-300/90">
                  <span>İlerleme: %{Math.round(collisionStop.progress * 100)}</span>
                  <span>
                    Gömülme: {collisionStop.maxPenetrationMm.toFixed(2)} mm (
                    {collisionStop.dominantAxis.toUpperCase()})
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3. OTOMATİK DÜZELTME & STL KAYIT (D:\...\exports) */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-emerald-400" />
              Otomatik Düzeltme & STL Kayıt
            </h3>

            {/* Eksen Seçimi */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-400">Düzeltme Ekseni</span>
              <div className="grid grid-cols-4 gap-1 bg-[#0b0f14] p-1 rounded border border-slate-800">
                {(
                  [
                    { id: 'auto', label: `Oto (${report.dominantAxis.toUpperCase()})` },
                    { id: 'x', label: 'X' },
                    { id: 'y', label: 'Y' },
                    { id: 'z', label: 'Z' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFixAxis(item.id)}
                    className={`py-1 text-[10px] font-mono font-semibold rounded ${
                      fixAxis === item.id
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Yöntem Seçimi */}
            <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded border border-slate-800">
              <button
                type="button"
                onClick={() => setFixMode('shrink')}
                className={`py-1 text-[11px] font-medium rounded ${
                  fixMode === 'shrink'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Parçayı Daralt
              </button>
              <button
                type="button"
                onClick={() => setFixMode('offset')}
                className={`py-1 text-[11px] font-medium rounded ${
                  fixMode === 'offset'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Konumu Kaydır
              </button>
            </div>

            {/* Boşluk Payı (+0.2 / +0.3 / +0.4 mm) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Boşluk Payı</span>
                <div className="flex gap-1">
                  {[0.2, 0.3, 0.4].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setFixClearanceMm(m)}
                      className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                        Math.abs(fixClearanceMm - m) < 0.005
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                          : 'bg-[#0b0f14] text-slate-400 border-slate-800'
                      }`}
                    >
                      +{m.toFixed(1)}mm
                    </button>
                  ))}
                </div>
              </div>
              <PrecisionSlider
                label="Özel Boşluk"
                colorClass="text-emerald-300"
                value={fixClearanceMm}
                min={0.05}
                max={2.0}
                step={0.05}
                unit="mm"
                onChange={setFixClearanceMm}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!movingPart && !selectedPart}
                onClick={handleAutoFix}
                className="flex-1 py-2 px-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/50 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                {effectiveFixAxis.toUpperCase()} Ekseninde Düzelt (+
                {fixClearanceMm.toFixed(2)}mm)
              </button>
              <button
                type="button"
                onClick={handleRestoreOriginal}
                title="Orijinal Geometriye Geri Al"
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={bakeWorldOnExport}
                onChange={(e) => setBakeWorldOnExport(e.target.checked)}
                className="w-3.5 h-3.5 accent-cyan-500 rounded"
              />
              Dünya konumunu/döndürmesini STL&apos;e işle
            </label>

            <button
              type="button"
              disabled={!movingPart && !selectedPart}
              onClick={handleExportCorrectedSTL}
              className="w-full py-2.5 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              Düzeltilmiş STL Kaydet (D:\...\exports)
            </button>
          </div>
        </div>
      </aside>

      {/* Bildirim Toast */}
      {toastMsg && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-emerald-950/95 border border-emerald-500/50 text-emerald-200 px-4 py-2 rounded-lg shadow-2xl text-xs font-medium backdrop-blur-md">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-mono">{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
