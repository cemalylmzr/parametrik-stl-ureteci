import React, { useEffect, useRef } from 'react';
import {
  CircleDot,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Scissors,
  Trash2,
} from 'lucide-react';
import {
  BoxCoordOrigin,
  BoxCutoutHole,
  BoxHoleDepthMode,
  BoxHoleOrientation,
  BoxHoleShape,
  ParametricBoxParams,
} from '../geometry/types';
import { getBoxTargetBounds } from '../geometry/boxCutouts';

interface BoxCutoutPanelProps {
  boxParams: ParametricBoxParams;
  selectedHoleId: string | null;
  onSelectHole: (id: string | null) => void;
  onBoxChange: (next: ParametricBoxParams) => void;
}

const SHAPE_LABELS: Record<BoxHoleShape, string> = {
  cylinder: 'Silindir',
  box: 'Dikdörtgen',
  hexagon: 'Altıgen',
  slot: 'Slot',
};

const AXIS_LABELS: Record<BoxHoleOrientation, string> = {
  z: 'Z (Üst/Alt)',
  x: 'X (Sağ/Sol)',
  y: 'Y (Ön/Arka)',
};

interface Slider01Props {
  label: string;
  colorClass?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}

const Slider01: React.FC<Slider01Props> = ({
  label,
  colorClass = 'text-slate-300',
  value,
  min,
  max,
  step = 0.1,
  unit = 'mm',
  onChange,
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[11px] font-medium ${colorClass}`}>{label}</span>
      <div className="flex items-center bg-[#0b0f14] border border-slate-700/80 focus-within:border-orange-500/80 rounded px-1.5 py-0.5">
        <input
          type="number"
          step={step}
          value={Number(value.toFixed(2))}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          className="w-14 bg-transparent text-right text-[11px] font-mono tabular-nums text-orange-200 focus:outline-none"
        />
        {unit && (
          <span className="text-[10px] font-mono text-slate-500 ml-1">
            {unit}
          </span>
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

function makeHoleId(): string {
  return `hole_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export const BoxCutoutPanel: React.FC<BoxCutoutPanelProps> = ({
  boxParams,
  selectedHoleId,
  onSelectHole,
  onBoxChange,
}) => {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 3D sahneden tıklanarak seçilen kartı görünür alana kaydır
  useEffect(() => {
    if (!selectedHoleId) return;
    const el = cardRefs.current.get(selectedHoleId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedHoleId]);

  const cutouts = boxParams.cutouts ?? [];

  const updateCutouts = (nextList: BoxCutoutHole[]) => {
    onBoxChange({ ...boxParams, cutouts: nextList });
  };

  const updateHole = (id: string, patch: Partial<BoxCutoutHole>) => {
    updateCutouts(
      cutouts.map((h) => (h.id === id ? { ...h, ...patch } : h))
    );
  };

  // Referans noktası (Merkez <-> Sol-Alt Köşe) değiştiğinde mevcut X, Y, Z değerlerini
  // fiziksel konumu bozmadan otomatik dönüştür
  const switchCoordOrigin = (hole: BoxCutoutHole, nextOrigin: BoxCoordOrigin) => {
    if (hole.coordOrigin === nextOrigin) return;
    const bounds = getBoxTargetBounds(boxParams, hole.target);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    if (nextOrigin === 'corner') {
      // center -> corner
      updateHole(hole.id, {
        coordOrigin: 'corner',
        x: round1(hole.x + bounds.width * 0.5),
        y: round1(hole.y + bounds.depth * 0.5),
        z: round1(hole.z + bounds.height * 0.5),
      });
    } else {
      // corner -> center
      updateHole(hole.id, {
        coordOrigin: 'center',
        x: round1(hole.x - bounds.width * 0.5),
        y: round1(hole.y - bounds.depth * 0.5),
        z: round1(hole.z - bounds.height * 0.5),
      });
    }
  };

  // Yeni standart delik ekle
  const addNewHole = (preset?: 'blank' | 'usbc' | 'm3nut' | 'cable' | 'window') => {
    const idx = cutouts.length + 1;
    const defaultTarget = boxParams.lidMode === 'lid' ? 'lid' : 'box';
    const w = boxParams.width;
    const d = boxParams.depth;
    const h = boxParams.height;
    const wall = boxParams.wallThickness;
    const floor = boxParams.floorThickness;

    let newHole: BoxCutoutHole = {
      id: makeHoleId(),
      name: `Delik #${idx}`,
      enabled: true,
      target: defaultTarget,
      shape: 'cylinder',
      orientation: 'z',
      depthMode: 'through',
      coordOrigin: 'center',
      x: 0,
      y: 0,
      z: 0,
      diameter: 8.0,
      rectWidth: 14.0,
      rectLength: 10.0,
      hexFlatToFlat: 5.7,
      slotWidth: 3.8,
      slotLength: 9.6,
      depth: Number((wall + 3.0).toFixed(1)),
      rotationDeg: 0,
    };

    if (preset === 'usbc') {
      newHole = {
        ...newHole,
        name: `USB-C Slotu #${idx}`,
        shape: 'slot',
        orientation: 'y',
        depthMode: 'blind',
        coordOrigin: 'center',
        x: 0,
        y: Number((-d * 0.5 + wall * 0.5).toFixed(1)),
        z: Number((-h * 0.5 + floor + 6.0).toFixed(1)),
        slotWidth: 3.8,
        slotLength: 9.6,
        depth: Number((wall + 4.0).toFixed(1)),
      };
    } else if (preset === 'm3nut') {
      newHole = {
        ...newHole,
        name: `M3 Somun Yuvası #${idx}`,
        shape: 'hexagon',
        orientation: 'z',
        depthMode: 'blind',
        coordOrigin: 'center',
        x: Number((w * 0.25).toFixed(1)),
        y: 0,
        z: Number((-h * 0.5 + 0.8).toFixed(1)),
        hexFlatToFlat: 5.7,
        depth: 2.2,
      };
    } else if (preset === 'cable') {
      newHole = {
        ...newHole,
        name: `Ø12 Yan Kablo #${idx}`,
        shape: 'cylinder',
        orientation: 'x',
        depthMode: 'blind',
        coordOrigin: 'center',
        x: Number((w * 0.5 - wall * 0.5).toFixed(1)),
        y: 0,
        z: 0,
        diameter: 12.0,
        depth: Number((wall + 4.0).toFixed(1)),
      };
    } else if (preset === 'window') {
      newHole = {
        ...newHole,
        name: `Kare Pencere #${idx}`,
        shape: 'box',
        orientation: 'z',
        depthMode: 'through',
        coordOrigin: 'center',
        x: 0,
        y: 0,
        z: 0,
        rectWidth: 20.0,
        rectLength: 12.0,
      };
    }

    updateCutouts([...cutouts, newHole]);
    onSelectHole(newHole.id);
  };

  // Deliği kopyala (+10mm kaydırarak)
  const duplicateHole = (hole: BoxCutoutHole) => {
    const copy: BoxCutoutHole = {
      ...hole,
      id: makeHoleId(),
      name: `${hole.name} (Kopya)`,
      x: Number((hole.x + (hole.orientation === 'x' ? 0 : 10)).toFixed(1)),
      y: Number((hole.y + (hole.orientation === 'x' ? 10 : 0)).toFixed(1)),
    };
    updateCutouts([...cutouts, copy]);
    onSelectHole(copy.id);
  };

  // Tek tıkla duvar/taban hizalama (kör kesimler için)
  const snapHoleToWall = (
    hole: BoxCutoutHole,
    wallSide: 'floor' | 'front' | 'back' | 'left' | 'right'
  ) => {
    const bounds = getBoxTargetBounds(boxParams, hole.target);
    const w = bounds.width;
    const d = bounds.depth;
    const h = bounds.height;
    const wt = boxParams.wallThickness;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const isCorner = hole.coordOrigin === 'corner';

    const cx = isCorner ? w * 0.5 : 0;
    const cy = isCorner ? d * 0.5 : 0;
    const cz = isCorner ? h * 0.5 : 0;

    if (wallSide === 'floor') {
      updateHole(hole.id, {
        orientation: 'z',
        depthMode: 'blind',
        z: round1(isCorner ? 1.0 : -h * 0.5 + 1.0),
        depth: round1(Math.max(2.0, boxParams.floorThickness + 2.0)),
      });
    } else if (wallSide === 'front') {
      updateHole(hole.id, {
        orientation: 'y',
        depthMode: 'blind',
        y: round1(isCorner ? wt * 0.5 : -d * 0.5 + wt * 0.5),
        z: round1(cz),
        depth: round1(wt + 4.0),
      });
    } else if (wallSide === 'back') {
      updateHole(hole.id, {
        orientation: 'y',
        depthMode: 'blind',
        y: round1(isCorner ? d - wt * 0.5 : d * 0.5 - wt * 0.5),
        z: round1(cz),
        depth: round1(wt + 4.0),
      });
    } else if (wallSide === 'left') {
      updateHole(hole.id, {
        orientation: 'x',
        depthMode: 'blind',
        x: round1(isCorner ? wt * 0.5 : -w * 0.5 + wt * 0.5),
        y: round1(cy),
        z: round1(cz),
        depth: round1(wt + 4.0),
      });
    } else {
      updateHole(hole.id, {
        orientation: 'x',
        depthMode: 'blind',
        x: round1(isCorner ? w - wt * 0.5 : w * 0.5 - wt * 0.5),
        y: round1(cy),
        z: round1(cz),
        depth: round1(wt + 4.0),
      });
    }
    void cx;
  };

  const holeSummary = (h: BoxCutoutHole): string => {
    const dim =
      h.shape === 'cylinder'
        ? `Ø${h.diameter}`
        : h.shape === 'box'
          ? `${h.rectWidth}×${h.rectLength}`
          : h.shape === 'hexagon'
            ? `AF${h.hexFlatToFlat}`
            : `${h.slotLength}×${h.slotWidth}`;
    return `${SHAPE_LABELS[h.shape]} ${dim} • ${h.orientation.toUpperCase()} • ${
      h.depthMode === 'through' ? 'Boydan' : `${h.depth}mm`
    }`;
  };

  return (
    <aside className="relative z-20 w-[345px] shrink-0 h-full bg-[#111720] border-l border-slate-800/90 flex flex-col overflow-hidden">
      {/* Başlık */}
      <div className="px-4 py-3 border-b border-slate-800/90 bg-[#0f151e] flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-orange-400" />
            Delik / Kesim (CSG)
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            three-bvh-csg • Sahnede tıklayarak seç
          </p>
        </div>
        <button
          type="button"
          onClick={() => addNewHole('blank')}
          className="px-2.5 py-1.5 rounded-md bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/50 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Yeni Delik
        </button>
      </div>

      {/* Hızlı Delik Şablonları */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 bg-[#0d121a]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
          Hızlı Kesim Ekle
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => addNewHole('usbc')}
            className="text-[11px] py-1 px-2 rounded bg-slate-800/75 hover:bg-orange-500/20 text-slate-300 hover:text-orange-200 border border-slate-700/70 hover:border-orange-500/40 transition-colors text-left truncate"
          >
            + USB-C Slotu (Ön)
          </button>
          <button
            type="button"
            onClick={() => addNewHole('m3nut')}
            className="text-[11px] py-1 px-2 rounded bg-slate-800/75 hover:bg-orange-500/20 text-slate-300 hover:text-orange-200 border border-slate-700/70 hover:border-orange-500/40 transition-colors text-left truncate"
          >
            + M3 Somun Yuvası
          </button>
          <button
            type="button"
            onClick={() => addNewHole('cable')}
            className="text-[11px] py-1 px-2 rounded bg-slate-800/75 hover:bg-orange-500/20 text-slate-300 hover:text-orange-200 border border-slate-700/70 hover:border-orange-500/40 transition-colors text-left truncate"
          >
            + Ø12 Yan Kablo
          </button>
          <button
            type="button"
            onClick={() => addNewHole('window')}
            className="text-[11px] py-1 px-2 rounded bg-slate-800/75 hover:bg-orange-500/20 text-slate-300 hover:text-orange-200 border border-slate-700/70 hover:border-orange-500/40 transition-colors text-left truncate"
          >
            + Kare Pencere
          </button>
        </div>
      </div>

      {/* Delik Kartları Listesi */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
        {cutouts.length === 0 ? (
          <div className="py-8 px-4 rounded-lg border border-dashed border-slate-800 bg-[#0b0f14] text-center space-y-2">
            <CircleDot className="w-6 h-6 text-slate-600 mx-auto" />
            <p className="text-xs font-medium text-slate-300">
              Henüz parametrik kesim eklenmedi
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Yukarıdaki <strong>+ Yeni Delik</strong> veya hızlı şablonlarla
              silindir, dikdörtgen, M3/M4/M5 somun yuvası ya da oval USB slotu
              açabilirsiniz.
            </p>
          </div>
        ) : (
          cutouts.map((hole) => {
            const isSelected = hole.id === selectedHoleId;
            const bounds = getBoxTargetBounds(boxParams, hole.target);
            const xMin = hole.coordOrigin === 'corner' ? -10 : -bounds.width * 0.6;
            const xMax = hole.coordOrigin === 'corner' ? bounds.width + 10 : bounds.width * 0.6;
            const yMin = hole.coordOrigin === 'corner' ? -10 : -bounds.depth * 0.6;
            const yMax = hole.coordOrigin === 'corner' ? bounds.depth + 10 : bounds.depth * 0.6;
            const zMin = hole.coordOrigin === 'corner' ? -10 : -bounds.height * 0.6;
            const zMax = hole.coordOrigin === 'corner' ? bounds.height + 10 : bounds.height * 0.6;

            return (
              <div
                key={hole.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(hole.id, el);
                  else cardRefs.current.delete(hole.id);
                }}
                className={`rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-[#151c27] border-red-500/60 shadow-lg shadow-red-950/20'
                    : 'bg-[#0c1118] border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Kart Başlığı */}
                <div
                  onClick={() => onSelectHole(isSelected ? null : hole.id)}
                  className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer select-none"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        !hole.enabled
                          ? 'bg-slate-600'
                          : isSelected
                            ? 'bg-red-500 ring-2 ring-red-400/40'
                            : 'bg-orange-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200 truncate">
                        {hole.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">
                        {holeSummary(hole)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateHole(hole.id, { enabled: !hole.enabled });
                      }}
                      title={hole.enabled ? 'Kesimi Pasifleştir' : 'Kesimi Aktifleştir'}
                      className="p-1 text-slate-400 hover:text-slate-200 rounded"
                    >
                      {hole.enabled ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateHole(hole);
                      }}
                      title="Deliği Kopyala"
                      className="p-1 text-slate-400 hover:text-cyan-300 rounded"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = cutouts.filter((h) => h.id !== hole.id);
                        updateCutouts(next);
                        if (selectedHoleId === hole.id) {
                          onSelectHole(next[0]?.id ?? null);
                        }
                      }}
                      title="Deliği Sil"
                      className="p-1 text-slate-500 hover:text-rose-400 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Kart Düzenleme Alanı (Seçiliyse Açık) */}
                {isSelected && (
                  <div className="px-3 pb-3 pt-2 border-t border-slate-800/90 space-y-3">
                    {/* Hedef Parça (Kutu + Kapak modunda) */}
                    {boxParams.lidMode === 'both' && (
                      <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded border border-slate-800">
                        {(
                          [
                            { id: 'box', label: 'Kutu Gövdesi' },
                            { id: 'lid', label: 'Kapak' },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => updateHole(hole.id, { target: t.id })}
                            className={`py-1 text-[11px] font-medium rounded ${
                              hole.target === t.id
                                ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 1. Delik Şekli */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        1. Delik Şekli
                      </span>
                      <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded border border-slate-800">
                        {(
                          [
                            { id: 'cylinder', label: 'Silindir / Daire' },
                            { id: 'box', label: 'Kare / Dikdörtgen' },
                            { id: 'hexagon', label: 'Altıgen (Somun)' },
                            { id: 'slot', label: 'Slot / Oval' },
                          ] as const
                        ).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => updateHole(hole.id, { shape: s.id })}
                            className={`py-1 text-[11px] font-medium rounded ${
                              hole.shape === s.id
                                ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>

                      {/* Şekle Özel Ölçüler */}
                      {hole.shape === 'cylinder' && (
                        <Slider01
                          label="Çap (D)"
                          value={hole.diameter}
                          min={1.5}
                          max={60}
                          onChange={(diameter) => updateHole(hole.id, { diameter })}
                        />
                      )}

                      {hole.shape === 'box' && (
                        <div className="space-y-2">
                          <Slider01
                            label="Genişlik (X)"
                            value={hole.rectWidth}
                            min={1.5}
                            max={80}
                            onChange={(rectWidth) =>
                              updateHole(hole.id, { rectWidth })
                            }
                          />
                          <Slider01
                            label="Uzunluk (Y)"
                            value={hole.rectLength}
                            min={1.5}
                            max={80}
                            onChange={(rectLength) =>
                              updateHole(hole.id, { rectLength })
                            }
                          />
                        </div>
                      )}

                      {hole.shape === 'hexagon' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] text-slate-400">
                              Somun Yuvası:
                            </span>
                            <div className="flex gap-1">
                              {[
                                { label: 'M3', af: 5.7 },
                                { label: 'M4', af: 7.2 },
                                { label: 'M5', af: 8.2 },
                                { label: 'M6', af: 10.2 },
                              ].map((m) => (
                                <button
                                  key={m.label}
                                  type="button"
                                  onClick={() =>
                                    updateHole(hole.id, { hexFlatToFlat: m.af })
                                  }
                                  className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-orange-500/20 text-slate-300 border border-slate-700"
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <Slider01
                            label="Anahtar Ağzı (Flat-to-Flat)"
                            value={hole.hexFlatToFlat}
                            min={2.5}
                            max={40}
                            onChange={(hexFlatToFlat) =>
                              updateHole(hole.id, { hexFlatToFlat })
                            }
                          />
                        </div>
                      )}

                      {hole.shape === 'slot' && (
                        <div className="space-y-2">
                          <Slider01
                            label="Kanal Genişliği"
                            value={hole.slotWidth}
                            min={1.5}
                            max={40}
                            onChange={(slotWidth) =>
                              updateHole(hole.id, {
                                slotWidth,
                                slotLength: Math.max(slotWidth, hole.slotLength),
                              })
                            }
                          />
                          <Slider01
                            label="Kanal Uzunluğu"
                            value={hole.slotLength}
                            min={hole.slotWidth}
                            max={90}
                            onChange={(slotLength) =>
                              updateHole(hole.id, { slotLength })
                            }
                          />
                        </div>
                      )}
                    </div>

                    {/* 2. Delik Ekseni / Yönü */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        2. Delik Ekseni (Yön)
                      </span>
                      <div className="grid grid-cols-3 gap-1 bg-[#0b0f14] p-1 rounded border border-slate-800">
                        {(['z', 'x', 'y'] as const).map((axis) => (
                          <button
                            key={axis}
                            type="button"
                            onClick={() =>
                              updateHole(hole.id, { orientation: axis })
                            }
                            className={`py-1 text-[10px] font-medium rounded ${
                              hole.orientation === axis
                                ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {AXIS_LABELS[axis]}
                          </button>
                        ))}
                      </div>
                      <Slider01
                        label="Döndürme Açısı"
                        value={hole.rotationDeg}
                        min={0}
                        max={180}
                        step={5}
                        unit="°"
                        onChange={(rotationDeg) =>
                          updateHole(hole.id, { rotationDeg })
                        }
                      />
                    </div>

                    {/* 3. Delik Tipi (Boydan Boya vs Kör Delik / Havşa) */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        3. Delik Tipi
                      </span>
                      <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded border border-slate-800">
                        {(
                          [
                            { id: 'through', label: 'Boydan Boya' },
                            { id: 'blind', label: 'Kör Delik / Havşa' },
                          ] as Array<{ id: BoxHoleDepthMode; label: string }>
                        ).map((dm) => (
                          <button
                            key={dm.id}
                            type="button"
                            onClick={() =>
                              updateHole(hole.id, { depthMode: dm.id })
                            }
                            className={`py-1 text-[11px] font-medium rounded ${
                              hole.depthMode === dm.id
                                ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {dm.label}
                          </button>
                        ))}
                      </div>

                      {hole.depthMode === 'blind' && (
                        <div className="space-y-2 pt-0.5">
                          <Slider01
                            label="Kesim Derinliği (H)"
                            value={hole.depth}
                            min={0.5}
                            max={Math.max(40, boxParams.height)}
                            onChange={(depth) => updateHole(hole.id, { depth })}
                          />
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] text-slate-500">
                              Duvara Hizala:
                            </span>
                            <div className="flex gap-1">
                              {(
                                [
                                  { id: 'floor', label: 'Taban' },
                                  { id: 'front', label: 'Ön' },
                                  { id: 'back', label: 'Arka' },
                                  { id: 'left', label: 'Sol' },
                                  { id: 'right', label: 'Sağ' },
                                ] as const
                              ).map((w) => (
                                <button
                                  key={w.id}
                                  type="button"
                                  onClick={() => snapHoleToWall(hole, w.id)}
                                  className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-orange-500/20 text-slate-300 border border-slate-700"
                                >
                                  {w.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 4. Koordinat Konumlandırma (0.1 mm Hassasiyet) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          4. Konum (0.1 mm)
                        </span>
                        <div className="flex bg-[#0b0f14] p-0.5 rounded border border-slate-800">
                          <button
                            type="button"
                            onClick={() => switchCoordOrigin(hole, 'center')}
                            className={`px-1.5 py-0.5 text-[10px] rounded ${
                              hole.coordOrigin === 'center'
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            Merkez (0,0)
                          </button>
                          <button
                            type="button"
                            onClick={() => switchCoordOrigin(hole, 'corner')}
                            className={`px-1.5 py-0.5 text-[10px] rounded ${
                              hole.coordOrigin === 'corner'
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            Sol-Alt Köşe
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 bg-[#0b0f14] border border-slate-800/80 rounded-md p-2">
                        <Slider01
                          label="X Konumu"
                          colorClass="text-red-400"
                          value={hole.x}
                          min={Number(xMin.toFixed(1))}
                          max={Number(xMax.toFixed(1))}
                          step={0.1}
                          onChange={(x) => updateHole(hole.id, { x })}
                        />
                        <Slider01
                          label="Y Konumu"
                          colorClass="text-green-400"
                          value={hole.y}
                          min={Number(yMin.toFixed(1))}
                          max={Number(yMax.toFixed(1))}
                          step={0.1}
                          onChange={(y) => updateHole(hole.id, { y })}
                        />
                        <Slider01
                          label="Z Konumu"
                          colorClass="text-blue-400"
                          value={hole.z}
                          min={Number(zMin.toFixed(1))}
                          max={Number(zMax.toFixed(1))}
                          step={0.1}
                          onChange={(z) => updateHole(hole.id, { z })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
