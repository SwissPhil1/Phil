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
    // Also index by label (lowercased) so "Gastro-intestinal" resolves to "gi"
    systemLabels[sys.label.toLowerCase()] = sys.label;
    return {
      key: sys.key,
      label: sys.label,
      organs: sys.organs.map((o) => {
        organToSystem[o.key] = sys.key;
        organLabels[o.key] = o.label;
        // Also index by label (lowercased) so "Œsophage" → "gi"
        const lowerLabel = o.label.toLowerCase();
        if (!organToSystem[lowerLabel]) {
          organToSystem[lowerLabel] = sys.key;
          organLabels[lowerLabel] = o.label;
        }
        return { key: o.key, label: o.label };
      }),
    };
  });

  // Also index system labels as organ keys pointing to their own system
  // This handles cases where ch.organ = "Imagerie de la femme" (a system label used as organ)
  for (const sys of dbSystems) {
    const lowerLabel = sys.label.toLowerCase();
    if (!organToSystem[lowerLabel]) {
      organToSystem[lowerLabel] = sys.key;
      organLabels[lowerLabel] = sys.label;
    }
    // Also add the key form of the label (e.g., "imagerie_de_la_femme")
    const keyForm = sys.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!organToSystem[keyForm]) {
      organToSystem[keyForm] = sys.key;
      organLabels[keyForm] = sys.label;
    }
  }

  return { systems, organToSystem, organLabels, systemLabels };
}

/**
 * Resolve a chapter's organ value to its system key.
 * Handles direct keys ("esophagus"), raw labels ("Œsophage"),
 * and system labels used as organs ("Imagerie de la femme").
 */
export function resolveOrganSystem(
  organ: string,
  organToSystem: Record<string, string>,
): string | null {
  // Direct key match
  if (organToSystem[organ]) return organToSystem[organ];
  // Lowercase match
  const lower = organ.toLowerCase();
  if (organToSystem[lower]) return organToSystem[lower];
  // Key-form match (label → snake_case)
  const keyForm = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (organToSystem[keyForm]) return organToSystem[keyForm];
  return null;
}

/**
 * Resolve a chapter's organ value to its display label.
 */
export function resolveOrganLabel(
  organ: string,
  organLabels: Record<string, string>,
): string {
  if (organLabels[organ]) return organLabels[organ];
  const lower = organ.toLowerCase();
  if (organLabels[lower]) return organLabels[lower];
  const keyForm = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (organLabels[keyForm]) return organLabels[keyForm];
  return organ; // Return as-is if not found
}
