/**
 * Anatomy taxonomy — shared organ → system mapping for the entire app.
 *
 * The Chapter model has an `organ` field (e.g. "esophagus", "pancreas").
 * This module groups organs into higher-level systems (e.g. "gi", "thorax")
 * for filtering flashcards, organizing chapters, and analytics.
 */

// ── Organ → System mapping ──────────────────────────────────────────────────

export const ORGAN_TO_SYSTEM: Record<string, string> = {
  esophagus: "gi",
  stomach: "gi",
  small_bowel: "gi",
  colon: "gi",
  liver: "gi",
  biliary: "gi",
  pancreas: "gi",
  spleen: "gi",
  peritoneum: "gi",
  kidney: "genito_urinary",
  bladder: "genito_urinary",
  uterus: "genito_urinary",
  retroperitoneum: "genito_urinary",
  adrenal: "genito_urinary",
  chest: "thorax",
  heart: "thorax",
  mediastinum: "thorax",
  aorta: "vascular",
  mesenteric_vessels: "vascular",
  venous: "vascular",
  peripheral_vascular: "vascular",
  brain: "neuro",
  spine: "neuro",
  msk: "msk",
  breast: "breast",
  head_neck: "head_neck",
  pediatric: "pediatric",
  nuclear: "nuclear",
  interventional: "interventional",
};

// ── System labels (French) ──────────────────────────────────────────────────

export const SYSTEM_LABELS: Record<string, string> = {
  gi: "Gastro-intestinal",
  genito_urinary: "Génito-urinaire",
  thorax: "Thorax",
  vascular: "Vasculaire",
  neuro: "Neuro",
  msk: "Musculosquelettique",
  breast: "Sénologie",
  head_neck: "Tête & Cou",
  pediatric: "Pédiatrique",
  nuclear: "Médecine nucléaire",
  interventional: "Interventionnel",
};

// ── Organ labels (French) ───────────────────────────────────────────────────

export const ORGAN_LABELS: Record<string, string> = {
  esophagus: "Œsophage",
  stomach: "Estomac",
  small_bowel: "Grêle",
  colon: "Côlon & Rectum",
  liver: "Foie",
  biliary: "Voies biliaires",
  pancreas: "Pancréas",
  spleen: "Rate",
  peritoneum: "Péritoine & Mésentère",
  kidney: "Reins",
  bladder: "Vessie & Prostate",
  uterus: "Utérus & Ovaires",
  retroperitoneum: "Rétropéritoine",
  adrenal: "Surrénales",
  chest: "Poumons",
  heart: "Cœur",
  mediastinum: "Médiastin",
  aorta: "Aorte",
  mesenteric_vessels: "Vaisseaux mésentériques",
  venous: "Système veineux",
  peripheral_vascular: "Vascularisation périphérique",
  brain: "Cerveau",
  spine: "Rachis",
  msk: "MSK",
  breast: "Sein",
  head_neck: "Tête & Cou",
  pediatric: "Pédiatrique",
  nuclear: "Médecine nucléaire",
  interventional: "Interventionnel",
};

// ── System display order ────────────────────────────────────────────────────

export const SYSTEM_ORDER = [
  "gi",
  "genito_urinary",
  "thorax",
  "vascular",
  "neuro",
  "msk",
  "breast",
  "head_neck",
  "pediatric",
  "nuclear",
  "interventional",
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getSystemForOrgan(organ: string): string | null {
  return ORGAN_TO_SYSTEM[organ] ?? null;
}

export function getSystemLabel(system: string): string {
  return SYSTEM_LABELS[system] ?? system;
}

export function getOrganLabel(organ: string): string {
  return ORGAN_LABELS[organ] ?? organ;
}

export function getOrgansForSystem(system: string): string[] {
  return Object.entries(ORGAN_TO_SYSTEM)
    .filter(([, sys]) => sys === system)
    .map(([organ]) => organ);
}

export interface SystemInfo {
  key: string;
  label: string;
  organs: { key: string; label: string }[];
}

export function getAllSystems(): SystemInfo[] {
  return SYSTEM_ORDER.map((key) => ({
    key,
    label: SYSTEM_LABELS[key] ?? key,
    organs: getOrgansForSystem(key).map((o) => ({
      key: o,
      label: ORGAN_LABELS[o] ?? o,
    })),
  }));
}

// ── Dynamic taxonomy from DB ────────────────────────────────────────────────

export interface DbOrgan {
  id: number;
  key: string;
  label: string;
  systemId: number;
  sortOrder: number;
}

export interface DbSystem {
  id: number;
  key: string;
  label: string;
  sortOrder: number;
  organs: DbOrgan[];
}

/** Build SystemInfo[] + lookup maps from DB taxonomy response */
export function buildTaxonomyFromDb(dbSystems: DbSystem[]): {
  systems: SystemInfo[];
  organToSystem: Record<string, string>;
  organLabels: Record<string, string>;
  systemLabels: Record<string, string>;
} {
  const organToSystem: Record<string, string> = {};
  const organLabels: Record<string, string> = {};
  const systemLabels: Record<string, string> = {};

  const systems: SystemInfo[] = dbSystems.map((sys) => {
    systemLabels[sys.key] = sys.label;
    return {
      key: sys.key,
      label: sys.label,
      organs: sys.organs.map((o) => {
        organToSystem[o.key] = sys.key;
        organLabels[o.key] = o.label;
        return { key: o.key, label: o.label };
      }),
    };
  });

  return { systems, organToSystem, organLabels, systemLabels };
}
