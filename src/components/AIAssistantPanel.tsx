import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  ImagePlus,
  KeyRound,
  Loader2,
  Printer,
  RotateCcw,
  RotateCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import * as THREE from 'three';
import {
  FastenerParams,
  HoneycombSieveParams,
  MATERIALS,
  MaterialType,
  MountingPlateParams,
  ParametricBoxParams,
  PartCategory,
} from '../geometry/types';
import { analyzeGeometryForAD5X } from '../geometry/printAnalyzer';
import {
  AD5XPrintAnalysisResult,
  AICadPatchResult,
  requestAD5XPrintAnalysis,
  requestAICadUpdate,
  resolveGeminiApiKey,
} from '../services/geminiCadService';

interface AIAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeCategory: PartCategory;
  material: MaterialType;
  boxParams: ParametricBoxParams;
  sieveParams: HoneycombSieveParams;
  plateParams: MountingPlateParams;
  fastenerParams: FastenerParams;
  baseGeometry: THREE.BufferGeometry;
  printRotationDeg: { x: number; y: number; z: number };
  onApplyPrintRotation: (rot: { x: number; y: number; z: number }) => void;
  onApplyAICadPatch: (patch: AICadPatchResult) => void;
}

const EXAMPLE_PROMPTS = [
  'Kutunun merkezine M4 somun yuvası aç ve sağ kenara 15 mm boşlukla 2 adet M3 vida deliği ekle',
  '110x75x35 mm ESP32 kutusu yap, ön duvara USB-C slotu ve 4 köşeye M3 somun yuvası aç',
  'Ø115 mm 6 mm bal peteği delikli, 16 mm yüksek kenarlı elek üret',
  'M12 32 mm tırtıklı el vidası ve uyumlu somun üret',
];

export const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({
  isOpen,
  onClose,
  activeCategory,
  material,
  boxParams,
  sieveParams,
  plateParams,
  fastenerParams,
  baseGeometry,
  printRotationDeg,
  onApplyPrintRotation,
  onApplyAICadPatch,
}) => {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [innerTab, setInnerTab] = useState<'cad' | 'ad5x'>('cad');

  const [sessionApiKey, setSessionApiKey] = useState<string>('');
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);

  const [prompt, setPrompt] = useState<string>('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [cadLoading, setCadLoading] = useState(false);
  const [cadError, setCadError] = useState<string | null>(null);
  const [lastCadResult, setLastCadResult] = useState<AICadPatchResult | null>(null);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [printAnalysis, setPrintAnalysis] =
    useState<AD5XPrintAnalysisResult | null>(null);

  const effectiveApiKey = resolveGeminiApiKey(sessionApiKey);
  const hasEnvKey = Boolean(
    ((import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || '').trim()
  );
  const matSpec = MATERIALS[material];

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Yerel overhang (>45°) ve AD5X tabla temas metriklerini canlı hesapla
  const localMetrics = useMemo(
    () => analyzeGeometryForAD5X(baseGeometry, printRotationDeg),
    [baseGeometry, printRotationDeg]
  );

  if (!isOpen) return null;

  const handleRunAICad = async () => {
    if (!effectiveApiKey) {
      setCadError(
        'Gemini API anahtarı bulunamadı. Proje kökündeki .env dosyasına VITE_GEMINI_API_KEY ekleyin veya yukarıdan geçici oturum anahtarı girin.'
      );
      setShowKeyInput(true);
      return;
    }
    if (!prompt.trim() && !imageFile) {
      setCadError('Lütfen bir tasarım komutu yazın veya parça fotoğrafı / teknik çizim yükleyin.');
      return;
    }

    setCadLoading(true);
    setCadError(null);
    try {
      const result = await requestAICadUpdate({
        apiKey: effectiveApiKey,
        prompt,
        imageFile,
        activeCategory,
        boxParams,
        sieveParams,
        plateParams,
        fastenerParams,
        material,
      });
      setLastCadResult(result);
      onApplyAICadPatch(result);
    } catch (err) {
      setCadError(
        err instanceof Error ? err.message : `Gemini API hatası: ${String(err)}`
      );
    } finally {
      setCadLoading(false);
    }
  };

  const handleRunAD5XAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const holeSummary =
        activeCategory === 'box'
          ? `${boxParams.cutouts.length} adet CSG delik (${boxParams.cutouts.map((h) => `${h.shape}/${h.orientation.toUpperCase()}`).join(', ') || 'yok'}), kapak modu=${boxParams.lidMode}`
          : activeCategory === 'fastener'
            ? `mod=${fastenerParams.mode}, çap=${fastenerParams.threadDiameter}mm, diş=${fastenerParams.gearTeeth}`
            : activeCategory === 'plate'
              ? `mod=${plateParams.mode}, delik tipi=${plateParams.holeStyle}`
              : `elek şekli=${sieveParams.shape}, delik=${sieveParams.holeType}`;

      const res = await requestAD5XPrintAnalysis({
        apiKey: effectiveApiKey,
        metrics: localMetrics,
        activeCategory,
        material,
        holeSummary,
      });
      setPrintAnalysis(res);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : `Analiz hatası: ${String(err)}`
      );
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <aside className="absolute top-0 right-0 bottom-0 2xl:relative z-30 w-[360px] max-w-[92vw] shrink-0 h-full bg-[#101621]/98 backdrop-blur-md border-l border-cyan-500/35 flex flex-col overflow-hidden shadow-2xl">
      {/* Başlık */}
      <div className="px-4 py-3 border-b border-slate-800/90 bg-gradient-to-r from-[#0f1726] to-[#111b2a] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow">
            <Bot className="w-4 h-4 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100">
              AI Tasarım & Analiz Asistanı
            </h2>
            <p className="text-[10px] font-mono text-cyan-300/80">
              Gemini Flash AI • AD5X ({matSpec.label} {matSpec.toleranceMm.toFixed(2)}mm)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="AI Panelini Kapat"
          className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* API Anahtarı Durumu */}
      <div className="px-4 py-2 border-b border-slate-800/80 bg-[#0b1018] space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5">
            <KeyRound
              className={`w-3.5 h-3.5 ${
                effectiveApiKey ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            {hasEnvKey ? (
              <span className="text-emerald-300 font-medium">
                .env (VITE_GEMINI_API_KEY) Bağlı
              </span>
            ) : effectiveApiKey ? (
              <span className="text-cyan-300 font-medium">
                Oturum API Anahtarı Aktif
              </span>
            ) : (
              <span className="text-amber-300 font-medium">
                API Anahtarı Gerekli (.env)
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setShowKeyInput((v) => !v)}
            className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
          >
            {showKeyInput ? 'Gizle' : 'Anahtar Gir'}
          </button>
        </div>

        {showKeyInput && (
          <div className="space-y-1">
            <input
              type="password"
              value={sessionApiKey}
              onChange={(e) => setSessionApiKey(e.target.value)}
              placeholder="AIza... (veya .env dosyasına VITE_GEMINI_API_KEY yazın)"
              className="w-full bg-[#090d14] border border-slate-700 focus:border-cyan-500 rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none"
            />
            <p className="text-[10px] text-slate-500">
              Kalıcı kullanım için proje klasöründe <code>.env</code> dosyasına{' '}
              <code>VITE_GEMINI_API_KEY=...</code> ekleyin.
            </p>
          </div>
        )}
      </div>

      {/* İç Sekmeler: Metin/Görsel CAD vs AD5X Baskı Analizi */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-800/80">
        <div className="grid grid-cols-2 gap-1 bg-[#0b0f14] p-1 rounded-md border border-slate-800">
          <button
            type="button"
            onClick={() => setInnerTab('cad')}
            className={`py-1.5 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 cursor-pointer ${
              innerTab === 'cad'
                ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Metin & Görsel CAD
          </button>
          <button
            type="button"
            onClick={() => setInnerTab('ad5x')}
            className={`py-1.5 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 cursor-pointer ${
              innerTab === 'ad5x'
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            AD5X Baskı Analizi
          </button>
        </div>
      </div>

      {/* İçerik Alanı */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {innerTab === 'cad' ? (
          <>
            {/* Görsel / Teknik Çizim Yükleme */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Görsel / Krokiden Ölçü Çıkar
                </span>
                {imageFile && (
                  <button
                    type="button"
                    onClick={() => setImageFile(null)}
                    className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                  >
                    Görseli Kaldır
                  </button>
                )}
              </div>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setImageFile(f);
                  e.target.value = '';
                }}
              />

              {imagePreviewUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-violet-500/40 bg-[#0b0f14]">
                  <img
                    src={imagePreviewUrl}
                    alt="Yüklenen kroki"
                    className="w-full h-32 object-contain bg-[#090d12]"
                  />
                  <div className="px-2.5 py-1 text-[10px] font-mono text-violet-200 bg-slate-900/90 truncate">
                    {imageFile?.name}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full py-3.5 px-3 rounded-lg border border-dashed border-slate-700 hover:border-violet-400/60 bg-[#0b0f14] flex items-center justify-center gap-2 text-xs text-slate-300 hover:text-violet-200 transition-colors cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4 text-violet-400" />
                  Parça Fotoğrafı veya Teknik Çizim Yükle
                </button>
              )}
            </div>

            {/* Metinden Parça / Delik Komutu */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Metinden Parça / Delik Üret
              </label>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Örn: "Kutunun merkezine M4 somun yuvası aç ve sağ kenara 15 mm boşlukla 2 adet M3 vida deliği ekle"'
                className="w-full bg-[#0b0f14] border border-slate-700/80 focus:border-violet-500 rounded-lg p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none resize-none leading-relaxed"
              />

              {/* Örnek Komutlar */}
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500">Örnek komutlar:</span>
                <div className="space-y-1">
                  {EXAMPLE_PROMPTS.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPrompt(ex)}
                      className="w-full text-left text-[10px] px-2 py-1.5 rounded bg-slate-800/60 hover:bg-violet-500/15 text-slate-300 hover:text-violet-200 border border-slate-800 hover:border-violet-500/30 transition-colors leading-snug cursor-pointer"
                    >
                      “{ex}”
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={cadLoading}
                onClick={() => void handleRunAICad()}
                className="w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-400 hover:to-cyan-400 disabled:opacity-60 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
              >
                {cadLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gemini 2.5 Flash Analiz Ediyor...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Sahneye Uygula (JSON CAD)
                  </>
                )}
              </button>
            </div>

            {cadError && (
              <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-500/50 text-rose-200 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-snug">{cadError}</span>
              </div>
            )}

            {lastCadResult && (
              <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-emerald-100 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Uygulanan AI Tasarım Özeti
                </div>
                <p className="text-[11px] leading-relaxed text-emerald-100/90">
                  {lastCadResult.summary}
                </p>
                {lastCadResult.extractedNotes.length > 0 && (
                  <ul className="text-[10px] font-mono text-emerald-200/80 space-y-0.5 pt-1 border-t border-emerald-500/20">
                    {lastCadResult.extractedNotes.map((n, idx) => (
                      <li key={idx}>• {n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* CANLI OVERHANG & AD5X GEOMETRİK ÖLÇÜMLER */}
            <div className="p-3 rounded-lg bg-[#0b0f14] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  Mevcut Baskı Durumu
                </span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    localMetrics.current.fitsAD5X
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {localMetrics.current.fitsAD5X ? '220³ Uygun' : 'Sınır Aşıldı!'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="bg-[#111720] rounded p-2 border border-slate-800/80">
                  <div className="text-[10px] text-slate-500">Overhang (&gt;45°)</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      localMetrics.current.needsSupports
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                    }`}
                  >
                    {localMetrics.current.overhangAreaMm2} mm² (%
                    {localMetrics.current.overhangPercent})
                  </div>
                </div>
                <div className="bg-[#111720] rounded p-2 border border-slate-800/80">
                  <div className="text-[10px] text-slate-500">Tabla Teması</div>
                  <div className="font-bold text-cyan-300 mt-0.5">
                    {localMetrics.current.bedContactAreaMm2} mm²
                  </div>
                </div>
              </div>

              {/* Manuel Baskı Yönü Döndürme Kısayolları */}
              <div className="flex items-center justify-between gap-1 pt-1">
                <span className="text-[10px] text-slate-400 font-mono">
                  Açı: {printRotationDeg.x}°/{printRotationDeg.y}°/{printRotationDeg.z}°
                </span>
                <div className="flex gap-1">
                  {(['x', 'y', 'z'] as const).map((ax) => (
                    <button
                      key={ax}
                      type="button"
                      onClick={() =>
                        onApplyPrintRotation({
                          ...printRotationDeg,
                          [ax]: (printRotationDeg[ax] + 90) % 360,
                        })
                      }
                      className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-cyan-500/20 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      {ax.toUpperCase()}+90°
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onApplyPrintRotation({ x: 0, y: 0, z: 0 })}
                    title="Açıyı Sıfırla (0°)"
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* AD5X BASKI ANALİZİ BUTONU */}
            <button
              type="button"
              disabled={analysisLoading}
              onClick={() => void handleRunAD5XAnalysis()}
              className="w-full py-2.5 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              {analysisLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AD5X Baskı Yönü Analiz Ediliyor...
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4 stroke-[2.5]" />
                  AD5X Baskı Analizi
                </>
              )}
            </button>

            {analysisError && (
              <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-500/50 text-rose-200 text-[11px]">
                {analysisError}
              </div>
            )}

            {/* ANALİZ SONUCU & TEK TIKLA ÖNERİLEN AÇIYA DÖNDÜR */}
            {printAnalysis && (
              <div className="p-3 rounded-lg bg-[#0d1520] border border-cyan-500/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    {printAnalysis.usedAI
                      ? 'Gemini AD5X Önerisi'
                      : 'AD5X Yerel Overhang Önerisi'}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      printAnalysis.needsSupports
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {printAnalysis.needsSupports ? 'Destek Gerekir' : 'Desteksiz Basılır'}
                  </span>
                </div>

                <p className="text-xs text-slate-100 leading-relaxed font-medium">
                  {printAnalysis.summary}
                </p>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {printAnalysis.strengthAdvice}
                </p>

                {/* Tek Tıkla Önerilen Açıya Döndür */}
                <button
                  type="button"
                  onClick={() =>
                    onApplyPrintRotation(printAnalysis.recommendedRotationDeg)
                  }
                  className="w-full py-2 px-3 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/50 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Önerilen Açıya Döndür (X:{printAnalysis.recommendedRotationDeg.x}° Y:
                  {printAnalysis.recommendedRotationDeg.y}° Z:
                  {printAnalysis.recommendedRotationDeg.z}°)
                </button>

                {/* Önerilen Orca-Flashforge Dilimleyici Ayarları */}
                <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-800 text-[10px] font-mono">
                  <div className="bg-[#090d14] rounded p-1.5 text-center">
                    <div className="text-slate-500">Katman</div>
                    <div className="text-cyan-200 font-semibold">
                      {printAnalysis.ad5xSlicerTips.layerHeightMm} mm
                    </div>
                  </div>
                  <div className="bg-[#090d14] rounded p-1.5 text-center">
                    <div className="text-slate-500">Duvar / Doluluk</div>
                    <div className="text-cyan-200 font-semibold">
                      {printAnalysis.ad5xSlicerTips.wallLoops} / %
                      {printAnalysis.ad5xSlicerTips.infillPercent}
                    </div>
                  </div>
                  <div className="bg-[#090d14] rounded p-1.5 text-center">
                    <div className="text-slate-500">Nozzle / Tabla</div>
                    <div className="text-cyan-200 font-semibold">
                      {printAnalysis.ad5xSlicerTips.nozzleTempC}° /{' '}
                      {printAnalysis.ad5xSlicerTips.bedTempC}°
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
