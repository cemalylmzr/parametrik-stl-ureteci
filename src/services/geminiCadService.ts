import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  BoxCoordOrigin,
  BoxCutoutHole,
  BoxHoleDepthMode,
  BoxHoleOrientation,
  BoxHoleShape,
  BoxHoleTarget,
  FastenerParams,
  HoneycombSieveParams,
  MATERIALS,
  MaterialType,
  MountingPlateParams,
  ParametricBoxParams,
  PartCategory,
} from '../geometry/types';
import { GeometryPrintMetrics } from '../geometry/printAnalyzer';

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
] as const;

async function generateWithModelFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
): Promise<{ text: string; modelUsed: string }> {
  let lastError: unknown = null;
  for (const model of GEMINI_MODELS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 18000);
      try {
        const response = await ai.models.generateContent({
          ...params,
          model,
          config: {
            ...(params.config ?? {}),
            abortSignal: controller.signal,
          },
        });
        if (response.text) {
          return { text: response.text, modelUsed: model };
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // 404 (model kullanılamıyor), 503 (geçici yoğunluk), 429 veya zaman aşımında sonraki modele geç
      const retryable =
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('no longer available') ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('abort');
      if (!retryable) {
        throw err;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'Gemini API yanıt vermedi.'));
}

export interface AICadPatchResult {
  targetCategory: PartCategory;
  summary: string;
  extractedNotes: string[];
  replaceExistingCutouts: boolean;
  boxPatch?: Partial<
    Pick<
      ParametricBoxParams,
      | 'width'
      | 'depth'
      | 'height'
      | 'wallThickness'
      | 'floorThickness'
      | 'cornerRadius'
      | 'lidMode'
      | 'ventSlots'
    >
  >;
  boxCutouts?: BoxCutoutHole[];
  sievePatch?: Partial<
    Pick<
      HoneycombSieveParams,
      | 'shape'
      | 'width'
      | 'depth'
      | 'thickness'
      | 'rimWidth'
      | 'rimHeight'
      | 'holeType'
      | 'holeSize'
      | 'wallSpacing'
    >
  >;
  platePatch?: Partial<
    Pick<
      MountingPlateParams,
      | 'mode'
      | 'width'
      | 'depth'
      | 'thickness'
      | 'holeCount'
      | 'holeDiameter'
      | 'holeInsetX'
      | 'holeInsetY'
      | 'holeStyle'
      | 'centerCutout'
      | 'centerCutoutWidth'
      | 'outerDiameter'
      | 'innerDiameter'
      | 'spacerHeight'
      | 'spacerThreaded'
    >
  >;
  fastenerPatch?: Partial<
    Pick<
      FastenerParams,
      | 'mode'
      | 'threadDiameter'
      | 'threadPitch'
      | 'boltHeadType'
      | 'boltShaftLength'
      | 'boltIncludeNut'
      | 'jarDiameter'
      | 'jarHeight'
      | 'gearModule'
      | 'gearTeeth'
      | 'gearThickness'
      | 'gearBoreDiameter'
    >
  >;
}

export interface AD5XPrintAnalysisResult {
  recommendedRotationDeg: { x: number; y: number; z: number };
  needsSupports: boolean;
  summary: string;
  strengthAdvice: string;
  ad5xSlicerTips: {
    layerHeightMm: number;
    wallLoops: number;
    infillPercent: number;
    nozzleTempC: number;
    bedTempC: number;
    brimRecommended: boolean;
  };
  usedAI: boolean;
}

const CAD_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    targetCategory: {
      type: Type.STRING,
      enum: ['sieve', 'box', 'plate', 'fastener'],
      description: 'Uygulanacak parça kategorisi',
    },
    summary: {
      type: Type.STRING,
      description: 'Yapılan işlemin Türkçe kısa özeti',
    },
    extractedNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Çıkarılan ölçüler, toleranslar ve notlar (Türkçe)',
    },
    replaceExistingCutouts: {
      type: Type.BOOLEAN,
      description: 'Mevcut kutu delikleri silinip yerine yenileri mi konulsun?',
    },
    boxPatch: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        width: { type: Type.NUMBER },
        depth: { type: Type.NUMBER },
        height: { type: Type.NUMBER },
        wallThickness: { type: Type.NUMBER },
        floorThickness: { type: Type.NUMBER },
        cornerRadius: { type: Type.NUMBER },
        lidMode: { type: Type.STRING, enum: ['both', 'box', 'lid'] },
        ventSlots: { type: Type.BOOLEAN },
      },
    },
    boxCutouts: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          target: { type: Type.STRING, enum: ['box', 'lid'] },
          shape: {
            type: Type.STRING,
            enum: ['cylinder', 'box', 'hexagon', 'slot'],
          },
          orientation: { type: Type.STRING, enum: ['z', 'x', 'y'] },
          depthMode: { type: Type.STRING, enum: ['through', 'blind'] },
          coordOrigin: { type: Type.STRING, enum: ['center', 'corner'] },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          z: { type: Type.NUMBER },
          diameter: { type: Type.NUMBER },
          rectWidth: { type: Type.NUMBER },
          rectLength: { type: Type.NUMBER },
          hexFlatToFlat: { type: Type.NUMBER },
          slotWidth: { type: Type.NUMBER },
          slotLength: { type: Type.NUMBER },
          depth: { type: Type.NUMBER },
          rotationDeg: { type: Type.NUMBER },
        },
        required: ['name', 'shape', 'orientation', 'depthMode', 'x', 'y', 'z'],
      },
    },
    sievePatch: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        shape: { type: Type.STRING, enum: ['circle', 'rectangle'] },
        width: { type: Type.NUMBER },
        depth: { type: Type.NUMBER },
        thickness: { type: Type.NUMBER },
        rimWidth: { type: Type.NUMBER },
        rimHeight: { type: Type.NUMBER },
        holeType: { type: Type.STRING, enum: ['hexagon', 'square', 'circle'] },
        holeSize: { type: Type.NUMBER },
        wallSpacing: { type: Type.NUMBER },
      },
    },
    platePatch: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        mode: { type: Type.STRING, enum: ['plate', 'spacer'] },
        width: { type: Type.NUMBER },
        depth: { type: Type.NUMBER },
        thickness: { type: Type.NUMBER },
        holeCount: { type: Type.STRING, enum: ['4-corners', '2-sides', 'none'] },
        holeDiameter: { type: Type.NUMBER },
        holeInsetX: { type: Type.NUMBER },
        holeInsetY: { type: Type.NUMBER },
        holeStyle: {
          type: Type.STRING,
          enum: ['through', 'counterbore', 'standoff', 'threaded'],
        },
        centerCutout: { type: Type.STRING, enum: ['none', 'circle', 'rectangle'] },
        centerCutoutWidth: { type: Type.NUMBER },
        outerDiameter: { type: Type.NUMBER },
        innerDiameter: { type: Type.NUMBER },
        spacerHeight: { type: Type.NUMBER },
        spacerThreaded: { type: Type.BOOLEAN },
      },
    },
    fastenerPatch: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        mode: { type: Type.STRING, enum: ['bolt', 'nut', 'threadedCap', 'gear'] },
        threadDiameter: { type: Type.NUMBER },
        threadPitch: { type: Type.NUMBER },
        boltHeadType: { type: Type.STRING, enum: ['hex', 'socket', 'knurled'] },
        boltShaftLength: { type: Type.NUMBER },
        boltIncludeNut: { type: Type.BOOLEAN },
        jarDiameter: { type: Type.NUMBER },
        jarHeight: { type: Type.NUMBER },
        gearModule: { type: Type.NUMBER },
        gearTeeth: { type: Type.NUMBER },
        gearThickness: { type: Type.NUMBER },
        gearBoreDiameter: { type: Type.NUMBER },
      },
    },
  },
  required: ['targetCategory', 'summary', 'extractedNotes', 'replaceExistingCutouts'],
};

const AD5X_PRINT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    recommendedRotationDeg: {
      type: Type.OBJECT,
      properties: {
        x: { type: Type.NUMBER },
        y: { type: Type.NUMBER },
        z: { type: Type.NUMBER },
      },
      required: ['x', 'y', 'z'],
    },
    needsSupports: { type: Type.BOOLEAN },
    summary: { type: Type.STRING },
    strengthAdvice: { type: Type.STRING },
    ad5xSlicerTips: {
      type: Type.OBJECT,
      properties: {
        layerHeightMm: { type: Type.NUMBER },
        wallLoops: { type: Type.NUMBER },
        infillPercent: { type: Type.NUMBER },
        nozzleTempC: { type: Type.NUMBER },
        bedTempC: { type: Type.NUMBER },
        brimRecommended: { type: Type.BOOLEAN },
      },
      required: [
        'layerHeightMm',
        'wallLoops',
        'infillPercent',
        'nozzleTempC',
        'bedTempC',
        'brimRecommended',
      ],
    },
  },
  required: [
    'recommendedRotationDeg',
    'needsSupports',
    'summary',
    'strengthAdvice',
    'ad5xSlicerTips',
  ],
};

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Görsel dosyası okunamadı.'));
    reader.readAsDataURL(file);
  });
}

export function resolveGeminiApiKey(sessionOverride?: string): string {
  const fromOverride = (sessionOverride || '').trim();
  if (fromOverride) return fromOverride;
  const fromEnv = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || '';
  return fromEnv.trim();
}

/**
 * Metin komutundan veya yüklenen parça fotoğrafı/krokisinden parametrik CAD & CSG delik JSON'u üretir.
 */
export async function requestAICadUpdate(opts: {
  apiKey: string;
  prompt: string;
  imageFile?: File | null;
  activeCategory: PartCategory;
  boxParams: ParametricBoxParams;
  sieveParams: HoneycombSieveParams;
  plateParams: MountingPlateParams;
  fastenerParams: FastenerParams;
  material: MaterialType;
}): Promise<AICadPatchResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const matSpec = MATERIALS[opts.material];

  const systemContext = `
Sen Flashforge AD5X (220x220x220 mm CoreXY, 0.4 mm nozzle) için uzman bir 3D CAD parametrik tasarım motorusun.
Tüm ölçüler milimetre (mm) cinsindendir (1 birim = 1 mm, Z-yukarı).
Aktif malzeme: ${matSpec.label} (tolerans: ${matSpec.toleranceMm.toFixed(2)} mm, nozzle: ${matSpec.nozzleTempC}, tabla: ${matSpec.bedTempC}).

METRİK STANDARTLAR (tolerans eklenmiş):
- M3 vida deliği: ${(3.0 + matSpec.toleranceMm).toFixed(2)} mm | M3 somun yuvası (hexFlatToFlat): ${(5.5 + matSpec.toleranceMm).toFixed(2)} mm (derinlik ~2.4 mm)
- M4 vida deliği: ${(4.0 + matSpec.toleranceMm).toFixed(2)} mm | M4 somun yuvası (hexFlatToFlat): ${(7.0 + matSpec.toleranceMm).toFixed(2)} mm (derinlik ~3.2 mm)
- M5 vida deliği: ${(5.0 + matSpec.toleranceMm).toFixed(2)} mm | M5 somun yuvası (hexFlatToFlat): ${(8.0 + matSpec.toleranceMm).toFixed(2)} mm (derinlik ~4.0 mm)
- USB-C portu: slot shape, slotLength = 9.4, slotWidth = 3.6 mm

KUTU KOORDİNAT SİSTEMİ (coordOrigin = "center" varsayılan):
- Kutu boyutları: width=${opts.boxParams.width} mm (X: ${(-opts.boxParams.width / 2).toFixed(1)} .. ${(opts.boxParams.width / 2).toFixed(1)}), depth=${opts.boxParams.depth} mm (Y: ${(-opts.boxParams.depth / 2).toFixed(1)} .. ${(opts.boxParams.depth / 2).toFixed(1)}), height=${opts.boxParams.height} mm (Z: ${(-opts.boxParams.height / 2).toFixed(1)} .. ${(opts.boxParams.height / 2).toFixed(1)}).
- Kutu taban kalınlığı=${opts.boxParams.floorThickness} mm, yan duvar=${opts.boxParams.wallThickness} mm.
- Örn: "sağ kenara 15 mm boşlukla" demek X = +(width/2 - 15).
- Örn: "sol kenara 15 mm boşlukla" demek X = -(width/2 - 15).
- Örn: "kutunun merkezine M4 somun yuvası" -> orientation="z", shape="hexagon", depthMode="blind", x=0, y=0, z=${(-opts.boxParams.height / 2 + 0.8).toFixed(1)}, hexFlatToFlat=${(7.0 + matSpec.toleranceMm).toFixed(2)}, depth=2.6.
- Örn: "ön duvara USB-C slotu" -> orientation="y", shape="slot", depthMode="blind", y=${(-opts.boxParams.depth / 2 + opts.boxParams.wallThickness / 2).toFixed(1)}, depth=${(opts.boxParams.wallThickness + 4).toFixed(1)}.
- Eğer kullanıcı sadece mevcut kutuya delik/kesim ekliyorsa targetCategory="box" ve replaceExistingCutouts=false dön.
- Eğer görsel/kroki yüklendiyse çizimdeki tüm dış ölçüleri (X, Y, Z) ve delik konumlarını/çaplarını tespit edip exact mm olarak modele aktar.
- Mevcut aktif sekme: "${opts.activeCategory}". Tüm açıklamaları Türkçe yaz.
`.trim();

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [
    {
      text: `${systemContext}\n\nKULLANICI KOMUTU:\n${
        opts.prompt.trim() ||
        'Yüklenen görseldeki/krokideki dış ölçüleri ve delikleri çıkarıp 3D parametrik modele aktar.'
      }`,
    },
  ];

  if (opts.imageFile) {
    const base64 = await fileToBase64(opts.imageFile);
    parts.push({
      inlineData: {
        mimeType: opts.imageFile.type || 'image/png',
        data: base64,
      },
    });
  }

  const { text: rawText } = await generateWithModelFallback(ai, {
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: CAD_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });

  const parsed = JSON.parse(rawText) as {
    targetCategory: PartCategory;
    summary: string;
    extractedNotes?: string[];
    replaceExistingCutouts?: boolean;
    boxPatch?: AICadPatchResult['boxPatch'] | null;
    boxCutouts?: Array<Record<string, unknown>> | null;
    sievePatch?: AICadPatchResult['sievePatch'] | null;
    platePatch?: AICadPatchResult['platePatch'] | null;
    fastenerPatch?: AICadPatchResult['fastenerPatch'] | null;
  };

  // CSG deliklerini tam BoxCutoutHole tipine normalize et
  const normalizedCutouts: BoxCutoutHole[] | undefined =
    parsed.boxCutouts && parsed.boxCutouts.length > 0
      ? parsed.boxCutouts.map((h, i) => ({
          id: `ai_hole_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
          name: String(h.name || `AI Delik #${i + 1}`),
          enabled: true,
          target: (h.target === 'lid' ? 'lid' : 'box') as BoxHoleTarget,
          shape: (['cylinder', 'box', 'hexagon', 'slot'].includes(String(h.shape))
            ? h.shape
            : 'cylinder') as BoxHoleShape,
          orientation: (['z', 'x', 'y'].includes(String(h.orientation))
            ? h.orientation
            : 'z') as BoxHoleOrientation,
          depthMode: (h.depthMode === 'blind' ? 'blind' : 'through') as BoxHoleDepthMode,
          coordOrigin: (h.coordOrigin === 'corner' ? 'corner' : 'center') as BoxCoordOrigin,
          x: Number(h.x ?? 0),
          y: Number(h.y ?? 0),
          z: Number(h.z ?? 0),
          diameter: Math.max(1.5, Number(h.diameter ?? 6)),
          rectWidth: Math.max(1.5, Number(h.rectWidth ?? 12)),
          rectLength: Math.max(1.5, Number(h.rectLength ?? 10)),
          hexFlatToFlat: Math.max(2.5, Number(h.hexFlatToFlat ?? 7.2)),
          slotWidth: Math.max(1.5, Number(h.slotWidth ?? 3.8)),
          slotLength: Math.max(2.0, Number(h.slotLength ?? 9.6)),
          depth: Math.max(0.5, Number(h.depth ?? 4.0)),
          rotationDeg: Number(h.rotationDeg ?? 0),
        }))
      : undefined;

  return {
    targetCategory: parsed.targetCategory || opts.activeCategory,
    summary: parsed.summary || 'AI parametreleri başarıyla uygulandı.',
    extractedNotes: parsed.extractedNotes ?? [],
    replaceExistingCutouts: Boolean(parsed.replaceExistingCutouts),
    boxPatch: parsed.boxPatch ?? undefined,
    boxCutouts: normalizedCutouts,
    sievePatch: parsed.sievePatch ?? undefined,
    platePatch: parsed.platePatch ?? undefined,
    fastenerPatch: parsed.fastenerPatch ?? undefined,
  };
}

/**
 * Flashforge AD5X Baskı Yönü ve Mukavemet Analizi (Gemini API + Yerel Overhang Metrikleri).
 * API anahtarı yoksa yerel geometrik overhang analizine dayalı güvenli bir öneri üretir.
 */
export async function requestAD5XPrintAnalysis(opts: {
  apiKey: string;
  metrics: GeometryPrintMetrics;
  activeCategory: PartCategory;
  material: MaterialType;
  holeSummary: string;
}): Promise<AD5XPrintAnalysisResult> {
  const matSpec = MATERIALS[opts.material];
  const best = opts.metrics.bestLocalCandidate;

  // API anahtarı yoksa yerel geometrik analiz sonucuyla çalış
  if (!opts.apiKey) {
    const nozzleNum = parseInt(matSpec.nozzleTempC, 10) || 215;
    const bedNum = parseInt(matSpec.bedTempC, 10) || 55;
    return {
      recommendedRotationDeg: best.rotationDeg,
      needsSupports: best.needsSupports,
      summary: best.needsSupports
        ? `Yerel Analiz: En düşük çıkıntı "${best.label}" yönünde (${best.overhangAreaMm2} mm² >45° overhang). Tree destek önerilir.`
        : `Yerel Analiz: "${best.label}" yönünde parça desteksiz basılabilir (0°–45° uyumlu, tabla teması ${best.bedContactAreaMm2} mm²).`,
      strengthAdvice: `${matSpec.label} (${matSpec.toleranceMm.toFixed(2)} mm tolerans) için Flashforge AD5X CoreXY profilinde 3–4 duvar ve %20–30 gyroid doluluk önerilir. Daha detaylı AI mukavemet yorumu için .env dosyasına VITE_GEMINI_API_KEY ekleyin.`,
      ad5xSlicerTips: {
        layerHeightMm: 0.2,
        wallLoops: 3,
        infillPercent: 25,
        nozzleTempC: nozzleNum,
        bedTempC: bedNum,
        brimRecommended: best.bedContactAreaMm2 < 350 || opts.material === 'ASA' || opts.material === 'ABS',
      },
      usedAI: false,
    };
  }

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  const promptText = `
Flashforge AD5X (220x220x220 mm CoreXY, 0.4 mm nozzle, Orca-Flashforge / FlashPrint) için baskı yönü, destek ihtiyacı ve katman mukavemeti analizi yap.

PARÇA BİLGİSİ:
- Kategori: ${opts.activeCategory}
- Malzeme: ${matSpec.label} (kalibre tolerans: ${matSpec.toleranceMm} mm, önerilen nozzle: ${matSpec.nozzleTempC}, tabla: ${matSpec.bedTempC})
- Üçgen sayısı: ${opts.metrics.triangleCount}
- Delikler / Özellikler: ${opts.holeSummary}

YEREL GEOMETRİK OVERHANG (>45°) VE TABLA TEMASI ÖLÇÜMLERİ:
- Mevcut Yön: ${JSON.stringify(opts.metrics.current)}
- Aday Yönelimler:
${opts.metrics.candidates.map((c) => `  * ${c.label}: boyut=${c.sizeX}x${c.sizeY}x${c.sizeZ}mm, AD5X_sigar=${c.fitsAD5X}, overhang>45=${c.overhangAreaMm2}mm² (%${c.overhangPercent}), tabla_temasi=${c.bedContactAreaMm2}mm²`).join('\n')}

GÖREV:
1. En az destek gerektiren, Flashforge AD5X (220x220x220 mm) tablasına sığan ve mekanik yük yönüne göre en mukavemetli baskı açısını seç (aday açılardan birini: 0/90/-90/180 derece katları).
2. Türkçe olarak kısa ve net bir özet ("summary") ve mukavemet tavsiyesi ("strengthAdvice") yaz.
3. Orca-Flashforge / AD5X dilimleyici parametrelerini ("ad5xSlicerTips") öner.
`.trim();

  try {
    const { text: rawText } = await generateWithModelFallback(ai, {
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: AD5X_PRINT_SCHEMA,
        temperature: 0.2,
      },
    });

    const parsed = JSON.parse(rawText) as Omit<AD5XPrintAnalysisResult, 'usedAI'>;
    return {
      ...parsed,
      usedAI: true,
    };
  } catch {
    // Bulut Gemini geçici olarak yoğun/erişilemezse yerel geometrik AD5X analizi ile kesintisiz devam et
    const nozzleNum = parseInt(matSpec.nozzleTempC, 10) || 215;
    const bedNum = parseInt(matSpec.bedTempC, 10) || 55;
    return {
      recommendedRotationDeg: best.rotationDeg,
      needsSupports: best.needsSupports,
      summary: `Yerel AD5X Analizi (Gemini geçici yoğun): "${best.label}" yönü en uygun (${best.overhangAreaMm2} mm² >45° overhang, tabla teması ${best.bedContactAreaMm2} mm²).`,
      strengthAdvice: `${matSpec.label} (${matSpec.toleranceMm.toFixed(2)} mm tolerans) için Flashforge AD5X CoreXY profilinde 3–4 duvar ve %25 doluluk önerilir.`,
      ad5xSlicerTips: {
        layerHeightMm: 0.2,
        wallLoops: 3,
        infillPercent: 25,
        nozzleTempC: nozzleNum,
        bedTempC: bedNum,
        brimRecommended:
          best.bedContactAreaMm2 < 350 ||
          opts.material === 'ASA' ||
          opts.material === 'ABS',
      },
      usedAI: false,
    };
  }
}
