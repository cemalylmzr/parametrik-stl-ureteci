import React, { useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  DEFAULT_BOX_PARAMS,
  DEFAULT_FASTENER_PARAMS,
  DEFAULT_PLATE_PARAMS,
  DEFAULT_SIEVE_PARAMS,
  FastenerParams,
  HoneycombSieveParams,
  MountingPlateParams,
  ParametricBoxParams,
  PartCategory,
} from '../geometry/types';
import {
  BOX_PRESETS,
  FASTENER_PRESETS,
  PLATE_PRESETS,
  SIEVE_PRESETS,
} from '../geometry/presets';

interface ParameterPanelProps {
  category: PartCategory;
  sieveParams: HoneycombSieveParams;
  boxParams: ParametricBoxParams;
  plateParams: MountingPlateParams;
  fastenerParams: FastenerParams;
  onSieveChange: (next: HoneycombSieveParams) => void;
  onBoxChange: (next: ParametricBoxParams) => void;
  onPlateChange: (next: MountingPlateParams) => void;
  onFastenerChange: (next: FastenerParams) => void;
  warnings: string[];
  holeCount?: number;
}

interface NumberControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (val: number) => void;
}

const NumberControl: React.FC<NumberControlProps> = ({
  label,
  value,
  min,
  max,
  step = 0.5,
  unit = 'mm',
  hint,
  onChange,
}) => {
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (!Number.isNaN(parsed)) {
      onChange(Math.min(max * 1.5, Math.max(0, parsed)));
    }
  };

  const handleBlur = () => {
    const clamped = Math.max(min, Math.min(max, value));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-300 truncate">
          {label}
          {hint && (
            <span className="ml-1.5 text-[10px] text-slate-500 font-normal">
              ({hint})
            </span>
          )}
        </label>
        <div className="flex items-center bg-[#0b0f14] border border-slate-700/80 focus-within:border-cyan-500/80 rounded px-1.5 py-0.5 shrink-0">
          <input
            type="number"
            value={Number(value.toFixed(2))}
            min={min}
            max={max}
            step={step}
            onChange={handleInput}
            onBlur={handleBlur}
            className="w-14 bg-transparent text-right text-xs font-mono tabular-nums text-cyan-200 focus:outline-none"
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
};

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (val: T) => void;
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-300 block">{label}</label>
      <div className="grid gap-1 bg-[#0b0f14] p-1 rounded-md border border-slate-800" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors truncate ${
                active
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const Section: React.FC<{ title: string; badge?: string; children: React.ReactNode }> = ({
  title,
  badge,
  children,
}) => (
  <div className="border-b border-slate-800/80 pb-4 mb-4 last:border-b-0 last:mb-0">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      {badge && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
          {badge}
        </span>
      )}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

const METRIC_THREAD_QUICK = [
  { label: 'M6', d: 6, p: 1.25, af: 10, h: 4.5 },
  { label: 'M8', d: 8, p: 1.5, af: 13, h: 5.5 },
  { label: 'M10', d: 10, p: 1.75, af: 17, h: 6.5 },
  { label: 'M12', d: 12, p: 2.0, af: 19, h: 7.5 },
  { label: 'M16', d: 16, p: 2.5, af: 24, h: 10 },
  { label: 'M20', d: 20, p: 2.5, af: 30, h: 12 },
];

export const ParameterPanel: React.FC<ParameterPanelProps> = ({
  category,
  sieveParams,
  boxParams,
  plateParams,
  fastenerParams,
  onSieveChange,
  onBoxChange,
  onPlateChange,
  onFastenerChange,
  warnings,
  holeCount,
}) => {
  const [activePresetName, setActivePresetName] = useState<string | null>(null);

  const handleReset = () => {
    setActivePresetName(null);
    if (category === 'sieve') onSieveChange(DEFAULT_SIEVE_PARAMS);
    else if (category === 'box') onBoxChange(DEFAULT_BOX_PARAMS);
    else if (category === 'plate') onPlateChange(DEFAULT_PLATE_PARAMS);
    else onFastenerChange(DEFAULT_FASTENER_PARAMS);
  };

  const presetCount =
    category === 'sieve'
      ? SIEVE_PRESETS.length
      : category === 'box'
        ? BOX_PRESETS.length
        : category === 'plate'
          ? PLATE_PRESETS.length
          : FASTENER_PRESETS.length;

  return (
    <aside className="w-[340px] shrink-0 h-full bg-[#111720] border-r border-slate-800/90 flex flex-col overflow-hidden">
      {/* Panel Başlığı */}
      <div className="px-4 py-3 border-b border-slate-800/90 flex items-center justify-between bg-[#0f151e]">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Parametrik Kontrol
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Tüm ölçüler milimetre (mm) cinsindendir
          </p>
        </div>
        <button
          onClick={handleReset}
          title="Varsayılan Değerlere Sıfırla"
          className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-md transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Kaydırılabilir Parametre Alanı */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Hazır Şablonlar */}
        <div className="mb-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              Hazır Şablonlar
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
              {presetCount} şablon
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
            {category === 'sieve' &&
              SIEVE_PRESETS.map((p) => {
                const isActive = activePresetName === p.name;
                return (
                  <button
                    key={p.name}
                    title={p.desc}
                    onClick={() => {
                      setActivePresetName(p.name);
                      onSieveChange(p.params);
                    }}
                    className={`text-left text-[11px] px-2 py-1.5 rounded border transition-colors truncate ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                        : 'bg-slate-800/70 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 border-slate-700/70 hover:border-cyan-500/40'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            {category === 'box' &&
              BOX_PRESETS.map((p) => {
                const isActive = activePresetName === p.name;
                return (
                  <button
                    key={p.name}
                    title={p.desc}
                    onClick={() => {
                      setActivePresetName(p.name);
                      onBoxChange(p.params);
                    }}
                    className={`text-left text-[11px] px-2 py-1.5 rounded border transition-colors truncate ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                        : 'bg-slate-800/70 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 border-slate-700/70 hover:border-cyan-500/40'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            {category === 'plate' &&
              PLATE_PRESETS.map((p) => {
                const isActive = activePresetName === p.name;
                return (
                  <button
                    key={p.name}
                    title={p.desc}
                    onClick={() => {
                      setActivePresetName(p.name);
                      onPlateChange(p.params);
                    }}
                    className={`text-left text-[11px] px-2 py-1.5 rounded border transition-colors truncate ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                        : 'bg-slate-800/70 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 border-slate-700/70 hover:border-cyan-500/40'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            {category === 'fastener' &&
              FASTENER_PRESETS.map((p) => {
                const isActive = activePresetName === p.name;
                return (
                  <button
                    key={p.name}
                    title={p.desc}
                    onClick={() => {
                      setActivePresetName(p.name);
                      onFastenerChange(p.params);
                    }}
                    className={`text-left text-[11px] px-2 py-1.5 rounded border transition-colors truncate ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                        : 'bg-slate-800/70 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 border-slate-700/70 hover:border-cyan-500/40'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Uyarı Kutusu */}
        {warnings.length > 0 && (
          <div className="mb-4 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Geometri / Baskı Uyarısı
            </div>
            {warnings.map((w, idx) => (
              <p key={idx} className="leading-snug text-amber-200/90">
                • {w}
              </p>
            ))}
          </div>
        )}

        {/* ==================== ELEK / IZGARA ==================== */}
        {category === 'sieve' && (
          <>
            <Section title="Dış Form & Çerçeve">
              <SegmentedControl
                label="Dış Gövde Şekli"
                value={sieveParams.shape}
                options={[
                  { value: 'circle', label: 'Dairesel Elek' },
                  { value: 'rectangle', label: 'Dikdörtgen Izgara' },
                ]}
                onChange={(shape) => onSieveChange({ ...sieveParams, shape })}
              />

              <NumberControl
                label={sieveParams.shape === 'circle' ? 'Dış Çap' : 'Genişlik (X)'}
                value={sieveParams.width}
                min={25}
                max={215}
                step={1}
                onChange={(width) => onSieveChange({ ...sieveParams, width })}
              />

              {sieveParams.shape === 'rectangle' && (
                <>
                  <NumberControl
                    label="Derinlik (Y)"
                    value={sieveParams.depth}
                    min={25}
                    max={215}
                    step={1}
                    onChange={(depth) => onSieveChange({ ...sieveParams, depth })}
                  />
                  <NumberControl
                    label="Köşe Radyüsü"
                    value={sieveParams.cornerRadius}
                    min={0}
                    max={45}
                    step={0.5}
                    onChange={(cornerRadius) =>
                      onSieveChange({ ...sieveParams, cornerRadius })
                    }
                  />
                </>
              )}

              <NumberControl
                label="Elek Taban Kalınlığı"
                value={sieveParams.thickness}
                min={1.0}
                max={12}
                step={0.2}
                onChange={(thickness) =>
                  onSieveChange({
                    ...sieveParams,
                    thickness,
                    rimHeight: Math.max(thickness, sieveParams.rimHeight),
                  })
                }
              />

              <NumberControl
                label="Çerçeve Duvar Genişliği"
                value={sieveParams.rimWidth}
                min={2.0}
                max={30}
                step={0.5}
                onChange={(rimWidth) =>
                  onSieveChange({ ...sieveParams, rimWidth })
                }
              />

              <NumberControl
                label="Çerçeve Yüksekliği"
                hint="Kenar"
                value={sieveParams.rimHeight}
                min={sieveParams.thickness}
                max={45}
                step={0.4}
                onChange={(rimHeight) =>
                  onSieveChange({ ...sieveParams, rimHeight })
                }
              />
            </Section>

            <Section
              title="Delik Deseni"
              badge={holeCount !== undefined ? `${holeCount} delik` : undefined}
            >
              <SegmentedControl
                label="Delik Geometrisi"
                value={sieveParams.holeType}
                options={[
                  { value: 'hexagon', label: 'Bal Peteği' },
                  { value: 'square', label: 'Kare' },
                  { value: 'circle', label: 'Daire' },
                ]}
                onChange={(holeType) =>
                  onSieveChange({ ...sieveParams, holeType })
                }
              />

              <NumberControl
                label="Delik Açıklığı / Çapı"
                value={sieveParams.holeSize}
                min={2.0}
                max={28}
                step={0.5}
                onChange={(holeSize) =>
                  onSieveChange({ ...sieveParams, holeSize })
                }
              />

              <NumberControl
                label="Delikler Arası Duvar"
                hint="Min 0.8mm"
                value={sieveParams.wallSpacing}
                min={0.8}
                max={8.0}
                step={0.2}
                onChange={(wallSpacing) =>
                  onSieveChange({ ...sieveParams, wallSpacing })
                }
              />

              <NumberControl
                label="Desen Açısı"
                value={sieveParams.holeRotation}
                min={0}
                max={90}
                step={5}
                unit="°"
                onChange={(holeRotation) =>
                  onSieveChange({ ...sieveParams, holeRotation })
                }
              />
            </Section>
          </>
        )}

        {/* ==================== ELEKTRONİK KUTU ==================== */}
        {category === 'box' && (
          <>
            <Section title="Kutu Dış Ölçüleri">
              <SegmentedControl
                label="Baskı Parçası"
                value={boxParams.lidMode}
                options={[
                  { value: 'both', label: 'Kutu + Kapak' },
                  { value: 'box', label: 'Sadece Kutu' },
                  { value: 'lid', label: 'Sadece Kapak' },
                ]}
                onChange={(lidMode) => onBoxChange({ ...boxParams, lidMode })}
              />

              <NumberControl
                label="Dış Genişlik (X)"
                value={boxParams.width}
                min={25}
                max={200}
                step={1}
                onChange={(width) => onBoxChange({ ...boxParams, width })}
              />

              <NumberControl
                label="Dış Derinlik (Y)"
                value={boxParams.depth}
                min={25}
                max={200}
                step={1}
                onChange={(depth) => onBoxChange({ ...boxParams, depth })}
              />

              <NumberControl
                label="Kutu Yüksekliği (Z)"
                value={boxParams.height}
                min={12}
                max={140}
                step={1}
                onChange={(height) => onBoxChange({ ...boxParams, height })}
              />

              <NumberControl
                label="Duvar Kalınlığı"
                value={boxParams.wallThickness}
                min={1.2}
                max={6.0}
                step={0.2}
                onChange={(wallThickness) =>
                  onBoxChange({ ...boxParams, wallThickness })
                }
              />

              <NumberControl
                label="Taban Kalınlığı"
                value={boxParams.floorThickness}
                min={1.2}
                max={6.0}
                step={0.2}
                onChange={(floorThickness) =>
                  onBoxChange({ ...boxParams, floorThickness })
                }
              />

              <NumberControl
                label="Köşe Radyüsü"
                value={boxParams.cornerRadius}
                min={0}
                max={25}
                step={0.5}
                onChange={(cornerRadius) =>
                  onBoxChange({ ...boxParams, cornerRadius })
                }
              />
            </Section>

            <Section title="Geçmeli Kapak & Tolerans">
              <NumberControl
                label="Kapak Kalınlığı"
                value={boxParams.lidThickness}
                min={1.2}
                max={6.0}
                step={0.2}
                onChange={(lidThickness) =>
                  onBoxChange({ ...boxParams, lidThickness })
                }
              />

              <NumberControl
                label="Geçme Dudağı Yüksekliği"
                value={boxParams.lipHeight}
                min={0}
                max={12}
                step={0.5}
                onChange={(lipHeight) =>
                  onBoxChange({ ...boxParams, lipHeight })
                }
              />

              <NumberControl
                label="FDM Geçme Toleransı"
                hint="AD5X: 0.20mm"
                value={boxParams.lipTolerance}
                min={0.1}
                max={0.6}
                step={0.05}
                onChange={(lipTolerance) =>
                  onBoxChange({ ...boxParams, lipTolerance })
                }
              />
            </Section>

            <Section title="Havalandırma & Kablo Deliği">
              <label className="flex items-center justify-between cursor-pointer py-1">
                <span className="text-xs font-medium text-slate-300">
                  Kapak Havalandırma Delikleri
                </span>
                <input
                  type="checkbox"
                  checked={boxParams.ventSlots}
                  onChange={(e) =>
                    onBoxChange({ ...boxParams, ventSlots: e.target.checked })
                  }
                  className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                />
              </label>

              {boxParams.ventSlots && (
                <>
                  <NumberControl
                    label="Havalandırma Delik Çapı"
                    value={boxParams.ventHoleDiameter}
                    min={2.0}
                    max={8.0}
                    step={0.5}
                    onChange={(ventHoleDiameter) =>
                      onBoxChange({ ...boxParams, ventHoleDiameter })
                    }
                  />
                  <NumberControl
                    label="Delik Satır Sayısı"
                    value={boxParams.ventHoleRows}
                    min={1}
                    max={8}
                    step={1}
                    unit="satır"
                    onChange={(ventHoleRows) =>
                      onBoxChange({ ...boxParams, ventHoleRows })
                    }
                  />
                </>
              )}

              <NumberControl
                label="Taban Kablo / Cıvata Deliği"
                hint="0 = kapalı"
                value={boxParams.cableHoleDiameter}
                min={0}
                max={25}
                step={1}
                onChange={(cableHoleDiameter) =>
                  onBoxChange({ ...boxParams, cableHoleDiameter })
                }
              />

              {boxParams.cableHoleDiameter >= 4 && (
                <>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-xs font-medium text-slate-300">
                      Taban Deliğine İç Diş Ekle
                    </span>
                    <input
                      type="checkbox"
                      checked={boxParams.cableHoleThreaded}
                      onChange={(e) =>
                        onBoxChange({
                          ...boxParams,
                          cableHoleThreaded: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                    />
                  </label>
                  {boxParams.cableHoleThreaded && (
                    <>
                      <NumberControl
                        label="Delik Diş Adımı (Pitch)"
                        value={boxParams.cableHolePitch}
                        min={1.0}
                        max={3.5}
                        step={0.25}
                        onChange={(cableHolePitch) =>
                          onBoxChange({ ...boxParams, cableHolePitch })
                        }
                      />
                      <NumberControl
                        label="FDM Diş Boşluğu"
                        value={boxParams.cableHoleTolerance}
                        min={0.15}
                        max={0.7}
                        step={0.05}
                        onChange={(cableHoleTolerance) =>
                          onBoxChange({ ...boxParams, cableHoleTolerance })
                        }
                      />
                    </>
                  )}
                </>
              )}
            </Section>
          </>
        )}

        {/* ==================== MONTAJ PLAKASI & SPACER ==================== */}
        {category === 'plate' && (
          <>
            <Section title="Parça Tipi">
              <SegmentedControl
                label="Mekanik Mod"
                value={plateParams.mode}
                options={[
                  { value: 'plate', label: 'Montaj Plakası' },
                  { value: 'spacer', label: 'Spacer / Burç' },
                ]}
                onChange={(mode) => onPlateChange({ ...plateParams, mode })}
              />
            </Section>

            {plateParams.mode === 'plate' ? (
              <>
                <Section title="Plaka Boyutları">
                  <NumberControl
                    label="Genişlik (X)"
                    value={plateParams.width}
                    min={20}
                    max={210}
                    step={1}
                    onChange={(width) =>
                      onPlateChange({ ...plateParams, width })
                    }
                  />
                  <NumberControl
                    label="Derinlik (Y)"
                    value={plateParams.depth}
                    min={20}
                    max={210}
                    step={1}
                    onChange={(depth) =>
                      onPlateChange({ ...plateParams, depth })
                    }
                  />
                  <NumberControl
                    label="Plaka Kalınlığı (Z)"
                    value={plateParams.thickness}
                    min={1.6}
                    max={20}
                    step={0.2}
                    onChange={(thickness) =>
                      onPlateChange({ ...plateParams, thickness })
                    }
                  />
                  <NumberControl
                    label="Köşe Radyüsü"
                    value={plateParams.cornerRadius}
                    min={0}
                    max={35}
                    step={0.5}
                    onChange={(cornerRadius) =>
                      onPlateChange({ ...plateParams, cornerRadius })
                    }
                  />
                </Section>

                <Section title="Vida Delikleri & Yükseltici">
                  <SegmentedControl
                    label="Delik Dizilimi"
                    value={plateParams.holeCount}
                    options={[
                      { value: '4-corners', label: '4 Köşe' },
                      { value: '2-sides', label: '2 Yan' },
                      { value: 'none', label: 'Yok' },
                    ]}
                    onChange={(holeCount) =>
                      onPlateChange({ ...plateParams, holeCount })
                    }
                  />

                  {plateParams.holeCount !== 'none' && (
                    <>
                      {/* Metrik Vida Hızlı Seçim */}
                      <div className="flex items-center justify-between gap-1 pt-0.5">
                        <span className="text-[11px] text-slate-400">
                          Hızlı Metrik:
                        </span>
                        <div className="flex gap-1">
                          {[
                            { label: 'M3', d: 3.2, cb: 6.2 },
                            { label: 'M4', d: 4.2, cb: 8.0 },
                            { label: 'M5', d: 5.3, cb: 9.8 },
                            { label: 'M6', d: 6.4, cb: 11.5 },
                          ].map((m) => (
                            <button
                              key={m.label}
                              type="button"
                              onClick={() =>
                                onPlateChange({
                                  ...plateParams,
                                  holeDiameter: m.d,
                                  counterboreDiameter: m.cb,
                                  standoffOuterDiameter: Math.max(
                                    m.d + 3.6,
                                    plateParams.standoffOuterDiameter
                                  ),
                                })
                              }
                              className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-200 border border-slate-700"
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <NumberControl
                        label="Vida Delik Çapı"
                        value={plateParams.holeDiameter}
                        min={2.0}
                        max={16}
                        step={0.1}
                        onChange={(holeDiameter) =>
                          onPlateChange({ ...plateParams, holeDiameter })
                        }
                      />

                      <NumberControl
                        label="X Kenar Mesafesi"
                        value={plateParams.holeInsetX}
                        min={4}
                        max={60}
                        step={0.5}
                        onChange={(holeInsetX) =>
                          onPlateChange({ ...plateParams, holeInsetX })
                        }
                      />

                      {plateParams.holeCount === '4-corners' && (
                        <NumberControl
                          label="Y Kenar Mesafesi"
                          value={plateParams.holeInsetY}
                          min={4}
                          max={60}
                          step={0.5}
                          onChange={(holeInsetY) =>
                            onPlateChange({ ...plateParams, holeInsetY })
                          }
                        />
                      )}

                      <SegmentedControl
                        label="Delik Tipi"
                        value={plateParams.holeStyle}
                        options={[
                          { value: 'through', label: 'Düz' },
                          { value: 'counterbore', label: 'Havşa' },
                          { value: 'standoff', label: 'Standoff' },
                          { value: 'threaded', label: 'İç Dişli' },
                        ]}
                        onChange={(holeStyle) =>
                          onPlateChange({ ...plateParams, holeStyle })
                        }
                      />

                      {plateParams.holeStyle === 'threaded' && (
                        <>
                          <NumberControl
                            label="Diş Adımı (Pitch)"
                            value={plateParams.threadPitch}
                            min={0.8}
                            max={3.0}
                            step={0.25}
                            onChange={(threadPitch) =>
                              onPlateChange({ ...plateParams, threadPitch })
                            }
                          />
                          <NumberControl
                            label="FDM Diş Boşluğu"
                            hint="AD5X: 0.30mm"
                            value={plateParams.threadTolerance}
                            min={0.15}
                            max={0.7}
                            step={0.05}
                            onChange={(threadTolerance) =>
                              onPlateChange({ ...plateParams, threadTolerance })
                            }
                          />
                        </>
                      )}

                      {plateParams.holeStyle === 'counterbore' && (
                        <>
                          <NumberControl
                            label="Havşa Baş Çapı"
                            value={plateParams.counterboreDiameter}
                            min={4}
                            max={24}
                            step={0.2}
                            onChange={(counterboreDiameter) =>
                              onPlateChange({
                                ...plateParams,
                                counterboreDiameter,
                              })
                            }
                          />
                          <NumberControl
                            label="Havşa Derinliği"
                            value={plateParams.counterboreDepth}
                            min={0.6}
                            max={Math.max(1, plateParams.thickness - 0.8)}
                            step={0.2}
                            onChange={(counterboreDepth) =>
                              onPlateChange({
                                ...plateParams,
                                counterboreDepth,
                              })
                            }
                          />
                        </>
                      )}

                      {plateParams.holeStyle === 'standoff' && (
                        <>
                          <NumberControl
                            label="Standoff Yüksekliği"
                            value={plateParams.standoffHeight}
                            min={1.5}
                            max={30}
                            step={0.5}
                            onChange={(standoffHeight) =>
                              onPlateChange({ ...plateParams, standoffHeight })
                            }
                          />
                          <NumberControl
                            label="Standoff Dış Çapı"
                            value={plateParams.standoffOuterDiameter}
                            min={Number((plateParams.holeDiameter + 2).toFixed(1))}
                            max={28}
                            step={0.1}
                            onChange={(standoffOuterDiameter) =>
                              onPlateChange({
                                ...plateParams,
                                standoffOuterDiameter,
                              })
                            }
                          />
                        </>
                      )}
                    </>
                  )}
                </Section>

                <Section title="Merkez Açıklığı (Fan / Motor)">
                  <SegmentedControl
                    label="Merkez Pencere"
                    value={plateParams.centerCutout}
                    options={[
                      { value: 'none', label: 'Kapalı' },
                      { value: 'circle', label: 'Daire' },
                      { value: 'rectangle', label: 'Dikdörtgen' },
                    ]}
                    onChange={(centerCutout) =>
                      onPlateChange({ ...plateParams, centerCutout })
                    }
                  />

                  {plateParams.centerCutout === 'circle' && (
                    <NumberControl
                      label="Merkez Delik Çapı"
                      value={plateParams.centerCutoutWidth}
                      min={4}
                      max={160}
                      step={1}
                      onChange={(centerCutoutWidth) =>
                        onPlateChange({ ...plateParams, centerCutoutWidth })
                      }
                    />
                  )}

                  {plateParams.centerCutout === 'rectangle' && (
                    <>
                      <NumberControl
                        label="Açıklık Genişliği (X)"
                        value={plateParams.centerCutoutWidth}
                        min={4}
                        max={160}
                        step={1}
                        onChange={(centerCutoutWidth) =>
                          onPlateChange({ ...plateParams, centerCutoutWidth })
                        }
                      />
                      <NumberControl
                        label="Açıklık Derinliği (Y)"
                        value={plateParams.centerCutoutDepth}
                        min={4}
                        max={160}
                        step={1}
                        onChange={(centerCutoutDepth) =>
                          onPlateChange({ ...plateParams, centerCutoutDepth })
                        }
                      />
                    </>
                  )}
                </Section>
              </>
            ) : (
              <>
                <Section title="Spacer / Burç Ölçüleri">
                  <SegmentedControl
                    label="Dış Profil"
                    value={plateParams.spacerShape}
                    options={[
                      { value: 'circle', label: 'Silindirik' },
                      { value: 'hexagon', label: 'Altıgen' },
                    ]}
                    onChange={(spacerShape) =>
                      onPlateChange({ ...plateParams, spacerShape })
                    }
                  />

                  <NumberControl
                    label={
                      plateParams.spacerShape === 'hexagon'
                        ? 'Anahtar Ağzı (Dış)'
                        : 'Dış Çap'
                    }
                    value={plateParams.outerDiameter}
                    min={6}
                    max={80}
                    step={0.5}
                    onChange={(outerDiameter) =>
                      onPlateChange({ ...plateParams, outerDiameter })
                    }
                  />

                  <NumberControl
                    label="İç Delik Çapı"
                    value={plateParams.innerDiameter}
                    min={2.0}
                    max={60}
                    step={0.1}
                    onChange={(innerDiameter) =>
                      onPlateChange({ ...plateParams, innerDiameter })
                    }
                  />

                  <NumberControl
                    label="Yükseklik (Z)"
                    value={plateParams.spacerHeight}
                    min={2}
                    max={100}
                    step={0.5}
                    onChange={(spacerHeight) =>
                      onPlateChange({ ...plateParams, spacerHeight })
                    }
                  />

                  <NumberControl
                    label="Kenar Pahı (Chamfer)"
                    hint="Fil ayağı önleme"
                    value={plateParams.chamfer}
                    min={0}
                    max={3.0}
                    step={0.1}
                    onChange={(chamfer) =>
                      onPlateChange({ ...plateParams, chamfer })
                    }
                  />

                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-xs font-medium text-slate-300">
                      İç Deliğe Vida Dişi Ekle
                    </span>
                    <input
                      type="checkbox"
                      checked={plateParams.spacerThreaded}
                      onChange={(e) =>
                        onPlateChange({
                          ...plateParams,
                          spacerThreaded: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                    />
                  </label>

                  {plateParams.spacerThreaded && (
                    <>
                      <NumberControl
                        label="Diş Adımı (Pitch)"
                        value={plateParams.threadPitch}
                        min={0.8}
                        max={3.5}
                        step={0.25}
                        onChange={(threadPitch) =>
                          onPlateChange({ ...plateParams, threadPitch })
                        }
                      />
                      <NumberControl
                        label="FDM Diş Boşluğu"
                        hint="AD5X: 0.30mm"
                        value={plateParams.threadTolerance}
                        min={0.15}
                        max={0.7}
                        step={0.05}
                        onChange={(threadTolerance) =>
                          onPlateChange({ ...plateParams, threadTolerance })
                        }
                      />
                    </>
                  )}
                </Section>

                <Section title="Taban Flanşı (Opsiyonel)">
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-xs font-medium text-slate-300">
                      Taban Flanşı Ekle
                    </span>
                    <input
                      type="checkbox"
                      checked={plateParams.flangeEnabled}
                      onChange={(e) =>
                        onPlateChange({
                          ...plateParams,
                          flangeEnabled: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                    />
                  </label>

                  {plateParams.flangeEnabled && (
                    <>
                      <NumberControl
                        label="Flanş Çapı"
                        value={plateParams.flangeDiameter}
                        min={plateParams.outerDiameter + 2}
                        max={100}
                        step={0.5}
                        onChange={(flangeDiameter) =>
                          onPlateChange({ ...plateParams, flangeDiameter })
                        }
                      />
                      <NumberControl
                        label="Flanş Yüksekliği"
                        value={plateParams.flangeHeight}
                        min={1.0}
                        max={Math.max(2, plateParams.spacerHeight - 1.5)}
                        step={0.2}
                        onChange={(flangeHeight) =>
                          onPlateChange({ ...plateParams, flangeHeight })
                        }
                      />
                    </>
                  )}
                </Section>
              </>
            )}
          </>
        )}

        {/* ==================== CIVATA, DİŞLİ KAPAK & DİŞLİ ÇARK ==================== */}
        {category === 'fastener' && (
          <>
            <Section title="Bağlantı & Dişli Tipi">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 block">
                  Parça Modu
                </label>
                <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded-md border border-slate-800">
                  {(
                    [
                      { value: 'bolt', label: 'Cıvata' },
                      { value: 'nut', label: 'Cıvata Deliği / Somun' },
                      { value: 'threadedCap', label: 'Dişli Kapak' },
                      { value: 'gear', label: 'Dişli Çark' },
                    ] as const
                  ).map((opt) => {
                    const active = opt.value === fastenerParams.mode;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          onFastenerChange({ ...fastenerParams, mode: opt.value })
                        }
                        className={`px-2 py-1.5 text-[11px] font-medium rounded transition-colors ${
                          active
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            {/* --- CIVATA --- */}
            {fastenerParams.mode === 'bolt' && (
              <>
                <Section title="Metrik Vida Dişi">
                  <div className="flex items-center justify-between gap-1 pt-0.5">
                    <span className="text-[11px] text-slate-400">Hızlı Metrik:</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {METRIC_THREAD_QUICK.map((m) => (
                        <button
                          key={m.label}
                          type="button"
                          onClick={() =>
                            onFastenerChange({
                              ...fastenerParams,
                              threadDiameter: m.d,
                              threadPitch: m.p,
                              boltHeadSize: m.af,
                              boltHeadHeight: m.h,
                              nutOuterSize: m.af,
                              nutHeight: Number((m.d * 0.85).toFixed(1)),
                            })
                          }
                          className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-200 border border-slate-700"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <NumberControl
                    label="Anma Çapı (M)"
                    value={fastenerParams.threadDiameter}
                    min={6}
                    max={30}
                    step={0.5}
                    onChange={(threadDiameter) =>
                      onFastenerChange({ ...fastenerParams, threadDiameter })
                    }
                  />
                  <NumberControl
                    label="Diş Adımı (Pitch)"
                    value={fastenerParams.threadPitch}
                    min={1.0}
                    max={4.0}
                    step={0.25}
                    onChange={(threadPitch) =>
                      onFastenerChange({ ...fastenerParams, threadPitch })
                    }
                  />
                  <NumberControl
                    label="Toplam Gövde Boyu"
                    value={fastenerParams.boltShaftLength}
                    min={8}
                    max={120}
                    step={1}
                    onChange={(boltShaftLength) =>
                      onFastenerChange({ ...fastenerParams, boltShaftLength })
                    }
                  />
                  <NumberControl
                    label="Dişsiz Boyun Uzunluğu"
                    hint="0 = tam diş"
                    value={fastenerParams.boltUnthreadedLength}
                    min={0}
                    max={Math.max(0, fastenerParams.boltShaftLength - 6)}
                    step={1}
                    onChange={(boltUnthreadedLength) =>
                      onFastenerChange({
                        ...fastenerParams,
                        boltUnthreadedLength,
                      })
                    }
                  />
                </Section>

                <Section title="Cıvata Başı & Uyumlu Somun">
                  <SegmentedControl
                    label="Baş Tipi"
                    value={fastenerParams.boltHeadType}
                    options={[
                      { value: 'hex', label: 'Altıgen' },
                      { value: 'socket', label: 'Alyan' },
                      { value: 'knurled', label: 'Tırtıklı' },
                    ]}
                    onChange={(boltHeadType) =>
                      onFastenerChange({ ...fastenerParams, boltHeadType })
                    }
                  />
                  <NumberControl
                    label="Baş Ölçüsü / Çapı"
                    value={fastenerParams.boltHeadSize}
                    min={fastenerParams.threadDiameter + 3}
                    max={55}
                    step={0.5}
                    onChange={(boltHeadSize) =>
                      onFastenerChange({ ...fastenerParams, boltHeadSize })
                    }
                  />
                  <NumberControl
                    label="Baş Yüksekliği"
                    value={fastenerParams.boltHeadHeight}
                    min={3}
                    max={25}
                    step={0.5}
                    onChange={(boltHeadHeight) =>
                      onFastenerChange({ ...fastenerParams, boltHeadHeight })
                    }
                  />

                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-xs font-medium text-slate-300">
                      Yanına Uyumlu Somun Ekle
                    </span>
                    <input
                      type="checkbox"
                      checked={fastenerParams.boltIncludeNut}
                      onChange={(e) =>
                        onFastenerChange({
                          ...fastenerParams,
                          boltIncludeNut: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                    />
                  </label>

                  {fastenerParams.boltIncludeNut && (
                    <NumberControl
                      label="Somun FDM Diş Boşluğu"
                      hint="AD5X: 0.30mm"
                      value={fastenerParams.threadTolerance}
                      min={0.15}
                      max={0.7}
                      step={0.05}
                      onChange={(threadTolerance) =>
                        onFastenerChange({ ...fastenerParams, threadTolerance })
                      }
                    />
                  )}
                </Section>
              </>
            )}

            {/* --- CIVATA DELİĞİ / SOMUN --- */}
            {fastenerParams.mode === 'nut' && (
              <>
                <Section title="Dişli Delik & Somun Gövdesi">
                  <div className="flex items-center justify-between gap-1 pt-0.5">
                    <span className="text-[11px] text-slate-400">Hızlı Metrik:</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {METRIC_THREAD_QUICK.map((m) => (
                        <button
                          key={m.label}
                          type="button"
                          onClick={() =>
                            onFastenerChange({
                              ...fastenerParams,
                              threadDiameter: m.d,
                              threadPitch: m.p,
                              nutOuterSize: m.af,
                              nutHeight: Number((m.d * 0.85).toFixed(1)),
                            })
                          }
                          className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-200 border border-slate-700"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <SegmentedControl
                    label="Dış Gövde Formu"
                    value={fastenerParams.nutShape}
                    options={[
                      { value: 'hex', label: 'Altıgen Somun' },
                      { value: 'square', label: 'Kare Blok' },
                      { value: 'round', label: 'Silindir Burç' },
                    ]}
                    onChange={(nutShape) =>
                      onFastenerChange({ ...fastenerParams, nutShape })
                    }
                  />

                  <NumberControl
                    label="Anma Diş Çapı (M)"
                    value={fastenerParams.threadDiameter}
                    min={6}
                    max={30}
                    step={0.5}
                    onChange={(threadDiameter) =>
                      onFastenerChange({ ...fastenerParams, threadDiameter })
                    }
                  />
                  <NumberControl
                    label="Diş Adımı (Pitch)"
                    value={fastenerParams.threadPitch}
                    min={1.0}
                    max={4.0}
                    step={0.25}
                    onChange={(threadPitch) =>
                      onFastenerChange({ ...fastenerParams, threadPitch })
                    }
                  />
                  <NumberControl
                    label="FDM Diş Boşluğu"
                    hint="AD5X: 0.30mm"
                    value={fastenerParams.threadTolerance}
                    min={0.15}
                    max={0.7}
                    step={0.05}
                    onChange={(threadTolerance) =>
                      onFastenerChange({ ...fastenerParams, threadTolerance })
                    }
                  />
                  <NumberControl
                    label="Dış Ölçü / Anahtar Ağzı"
                    value={fastenerParams.nutOuterSize}
                    min={10}
                    max={70}
                    step={0.5}
                    onChange={(nutOuterSize) =>
                      onFastenerChange({ ...fastenerParams, nutOuterSize })
                    }
                  />
                  <NumberControl
                    label="Yükseklik (Z)"
                    value={fastenerParams.nutHeight}
                    min={4}
                    max={50}
                    step={0.5}
                    onChange={(nutHeight) =>
                      onFastenerChange({ ...fastenerParams, nutHeight })
                    }
                  />
                </Section>
              </>
            )}

            {/* --- DİŞLİ KAPAK & KAVANOZ --- */}
            {fastenerParams.mode === 'threadedCap' && (
              <>
                <Section title="Dişli Kavanoz & Kapak">
                  <SegmentedControl
                    label="Baskı Parçası"
                    value={fastenerParams.capMode}
                    options={[
                      { value: 'both', label: 'Gövde + Kapak' },
                      { value: 'body', label: 'Sadece Gövde' },
                      { value: 'cap', label: 'Sadece Kapak' },
                    ]}
                    onChange={(capMode) =>
                      onFastenerChange({ ...fastenerParams, capMode })
                    }
                  />

                  <NumberControl
                    label="Gövde Dış Çapı"
                    value={fastenerParams.jarDiameter}
                    min={24}
                    max={110}
                    step={1}
                    onChange={(jarDiameter) =>
                      onFastenerChange({ ...fastenerParams, jarDiameter })
                    }
                  />
                  <NumberControl
                    label="Gövde Yüksekliği"
                    value={fastenerParams.jarHeight}
                    min={18}
                    max={150}
                    step={1}
                    onChange={(jarHeight) =>
                      onFastenerChange({ ...fastenerParams, jarHeight })
                    }
                  />
                  <NumberControl
                    label="Duvar Kalınlığı"
                    value={fastenerParams.jarWallThickness}
                    min={1.6}
                    max={6.0}
                    step={0.2}
                    onChange={(jarWallThickness) =>
                      onFastenerChange({ ...fastenerParams, jarWallThickness })
                    }
                  />
                </Section>

                <Section title="Kapak Diş Ayarları">
                  <NumberControl
                    label="Dişli Boyun Yüksekliği"
                    value={fastenerParams.jarThreadHeight}
                    min={6}
                    max={25}
                    step={0.5}
                    onChange={(jarThreadHeight) =>
                      onFastenerChange({ ...fastenerParams, jarThreadHeight })
                    }
                  />
                  <NumberControl
                    label="Diş Adımı (Pitch)"
                    value={fastenerParams.jarThreadPitch}
                    min={1.75}
                    max={5.0}
                    step={0.25}
                    onChange={(jarThreadPitch) =>
                      onFastenerChange({ ...fastenerParams, jarThreadPitch })
                    }
                  />
                  <NumberControl
                    label="FDM Diş Toleransı"
                    hint="AD5X: 0.35mm"
                    value={fastenerParams.jarThreadTolerance}
                    min={0.2}
                    max={0.8}
                    step={0.05}
                    onChange={(jarThreadTolerance) =>
                      onFastenerChange({ ...fastenerParams, jarThreadTolerance })
                    }
                  />
                  <NumberControl
                    label="Kapak Tavan Kalınlığı"
                    value={fastenerParams.capTopThickness}
                    min={1.6}
                    max={6.0}
                    step={0.2}
                    onChange={(capTopThickness) =>
                      onFastenerChange({ ...fastenerParams, capTopThickness })
                    }
                  />
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-xs font-medium text-slate-300">
                      Kapak Dış Tırtıklı Tutuş (Knurling)
                    </span>
                    <input
                      type="checkbox"
                      checked={fastenerParams.capKnurling}
                      onChange={(e) =>
                        onFastenerChange({
                          ...fastenerParams,
                          capKnurling: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                    />
                  </label>
                </Section>
              </>
            )}

            {/* --- DİŞLİ ÇARK (SPUR GEAR) --- */}
            {fastenerParams.mode === 'gear' && (
              <>
                <Section
                  title="Evolvent Dişli Çark"
                  badge={`Ø${(fastenerParams.gearModule * (fastenerParams.gearTeeth + 2)).toFixed(1)}mm`}
                >
                  <NumberControl
                    label="Modül (m)"
                    value={fastenerParams.gearModule}
                    min={1.0}
                    max={5.0}
                    step={0.25}
                    onChange={(gearModule) =>
                      onFastenerChange({ ...fastenerParams, gearModule })
                    }
                  />
                  <NumberControl
                    label="Diş Sayısı (z)"
                    value={fastenerParams.gearTeeth}
                    min={8}
                    max={60}
                    step={1}
                    unit="diş"
                    onChange={(gearTeeth) =>
                      onFastenerChange({ ...fastenerParams, gearTeeth })
                    }
                  />
                  <NumberControl
                    label="Dişli Kalınlığı (Z)"
                    value={fastenerParams.gearThickness}
                    min={2.0}
                    max={35}
                    step={0.5}
                    onChange={(gearThickness) =>
                      onFastenerChange({ ...fastenerParams, gearThickness })
                    }
                  />
                  <NumberControl
                    label="Kavrama Açısı"
                    value={fastenerParams.gearPressureAngle}
                    min={14.5}
                    max={25}
                    step={0.5}
                    unit="°"
                    onChange={(gearPressureAngle) =>
                      onFastenerChange({ ...fastenerParams, gearPressureAngle })
                    }
                  />
                  <NumberControl
                    label="FDM Diş Boşluğu (Backlash)"
                    value={fastenerParams.gearBacklash}
                    min={0}
                    max={0.5}
                    step={0.02}
                    onChange={(gearBacklash) =>
                      onFastenerChange({ ...fastenerParams, gearBacklash })
                    }
                  />
                </Section>

                <Section title="Mil Deliği & Göbek">
                  <SegmentedControl
                    label="Mil Deliği Tipi"
                    value={fastenerParams.gearBoreShape}
                    options={[
                      { value: 'circle', label: 'Yuvarlak' },
                      { value: 'd-shaft', label: 'D-Mil' },
                      { value: 'hex', label: 'Altıgen' },
                    ]}
                    onChange={(gearBoreShape) =>
                      onFastenerChange({ ...fastenerParams, gearBoreShape })
                    }
                  />
                  <NumberControl
                    label="Mil Deliği Çapı"
                    hint="0 = dolu"
                    value={fastenerParams.gearBoreDiameter}
                    min={0}
                    max={40}
                    step={0.2}
                    onChange={(gearBoreDiameter) =>
                      onFastenerChange({ ...fastenerParams, gearBoreDiameter })
                    }
                  />

                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-xs font-medium text-slate-300">
                      Yükseltilmiş Göbek (Hub)
                    </span>
                    <input
                      type="checkbox"
                      checked={fastenerParams.gearHubEnabled}
                      onChange={(e) =>
                        onFastenerChange({
                          ...fastenerParams,
                          gearHubEnabled: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-cyan-500 bg-slate-800 border-slate-700"
                    />
                  </label>

                  {fastenerParams.gearHubEnabled && (
                    <>
                      <NumberControl
                        label="Göbek Çapı"
                        value={fastenerParams.gearHubDiameter}
                        min={6}
                        max={80}
                        step={0.5}
                        onChange={(gearHubDiameter) =>
                          onFastenerChange({
                            ...fastenerParams,
                            gearHubDiameter,
                          })
                        }
                      />
                      <NumberControl
                        label="Göbek Yüksekliği"
                        value={fastenerParams.gearHubHeight}
                        min={1}
                        max={25}
                        step={0.5}
                        onChange={(gearHubHeight) =>
                          onFastenerChange({ ...fastenerParams, gearHubHeight })
                        }
                      />
                    </>
                  )}
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
