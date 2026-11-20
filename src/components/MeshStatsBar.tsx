import React from 'react';
import {
  AlertOctagon,
  Box,
  CheckCircle2,
  Cpu,
  Ruler,
  Scale,
  Triangle,
} from 'lucide-react';
import {
  FLASHFORGE_AD5X_BED,
  MATERIALS,
  MaterialType,
  MeshStats,
} from '../geometry/types';

interface MeshStatsBarProps {
  stats: MeshStats;
  material: MaterialType;
  infillPercent: number;
}

export const MeshStatsBar: React.FC<MeshStatsBarProps> = ({
  stats,
  material,
  infillPercent,
}) => {
  const matSpec = MATERIALS[material];

  return (
    <footer className="h-11 shrink-0 bg-[#0e141c] border-t border-slate-800/90 px-4 flex items-center justify-between gap-4 text-xs overflow-x-auto">
      {/* Sol Grup: Dış Ölçüler ve Flashforge AD5X Uyumluluk */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2" title="Dış Sınır Kutusu (Bounding Box)">
          <Ruler className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-400">Ölçüler:</span>
          <span className="font-mono tabular-nums text-slate-200 flex items-center gap-1.5">
            <span className="text-red-400/90">X</span>
            {stats.sizeX.toFixed(1)}
            <span className="text-slate-600">×</span>
            <span className="text-green-400/90">Y</span>
            {stats.sizeY.toFixed(1)}
            <span className="text-slate-600">×</span>
            <span className="text-blue-400/90">Z</span>
            {stats.sizeZ.toFixed(1)}
            <span className="text-slate-500 text-[11px]">mm</span>
          </span>
        </div>

        <div className="w-px h-4 bg-slate-800" />

        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-medium text-[11px] ${
            stats.fitsPrinter
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
              : 'bg-rose-500/15 text-rose-300 border border-rose-500/35'
          }`}
          title={`${FLASHFORGE_AD5X_BED.name} CoreXY Baskı Hacmi: ${FLASHFORGE_AD5X_BED.x} × ${FLASHFORGE_AD5X_BED.y} × ${FLASHFORGE_AD5X_BED.z} mm`}
        >
          <Cpu className="w-3 h-3" />
          {stats.fitsPrinter ? 'Flashforge AD5X Uygun' : 'Tabla Sınırını Aşıyor'}
        </div>
      </div>

      {/* Orta Grup: Üçgen Sayısı & Hacim & Filament */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-1.5" title="Toplam STL Üçgen Sayısı">
          <Triangle className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-400">Üçgen:</span>
          <span className="font-mono tabular-nums text-slate-200">
            {stats.triangleCount.toLocaleString('tr-TR')}
          </span>
        </div>

        <div className="w-px h-4 bg-slate-800" />

        <div className="flex items-center gap-1.5" title="Katı Geometri Hacmi">
          <Box className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-400">Hacim:</span>
          <span className="font-mono tabular-nums text-slate-200">
            {stats.volumeCm3.toFixed(2)} cm³
          </span>
        </div>

        <div className="w-px h-4 bg-slate-800" />

        <div
          className="flex items-center gap-1.5"
          title={`1.75 mm ${matSpec.label} (${matSpec.densityGPerCm3} g/cm³), %${infillPercent} doluluk tahmini`}
        >
          <Scale className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">
            Tahmini {matSpec.label} ({infillPercent}%):
          </span>
          <span className="font-mono tabular-nums text-cyan-300 font-semibold">
            {stats.estimatedWeightG.toFixed(1)} g
          </span>
          <span className="text-slate-500 font-mono tabular-nums">
            (~{stats.estimatedFilamentM.toFixed(2)} m)
          </span>
        </div>
      </div>

      {/* Sağ Grup: Watertight Manifold Durumu */}
      <div className="shrink-0">
        {stats.isWatertight ? (
          <div
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-medium text-[11px]"
            title="Tüm kenarlar tam eşleşiyor (0 açık kenar, 0 non-manifold). Dilimleyiciye doğrudan hazır."
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            Watertight Manifold
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 font-medium text-[11px]"
            title={`Açık kenar: ${stats.openEdges}, Non-manifold: ${stats.nonManifoldEdges}`}
          >
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            Manifold Hatası ({stats.openEdges}/{stats.nonManifoldEdges})
          </div>
        )}
      </div>
    </footer>
  );
};
