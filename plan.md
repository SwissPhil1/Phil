# Flashcard System Overhaul — Implementation Plan

## Overview

Transform the basic flashcard review into a world-class spaced repetition system with:
- **Anatomy taxonomy** — organ → system mapping (GI, Génito-urinaire, Thorax, etc.)
- **3-level flashcard filtering** — random / by system / by section (organ)
- **Session summary** with score breakdown, retention rate, XP earned
- **Pre-session dashboard** with card state counts (Nouvelles/En apprentissage/À réviser/Maîtrisées)
- **Anki-style "Again" re-queuing** — failed cards go to back of queue
- **Interval preview** on rating buttons ("< 1j", "4j", "10j", "25j")
- **Daily new card limit** with user-configurable slider (localStorage)
- **Gamification** — XP, levels, streaks, motivational messages
- **French UI** throughout

No database schema changes needed — system is computed from existing `organ` field via a shared mapping.

---

## Part 1: Anatomy Taxonomy (shared lib)

### New file: `src/lib/taxonomy.ts`

Maps the existing `organ` field on chapters to a higher-level `system`:

```typescript
// organ → system mapping
const ORGAN_TO_SYSTEM = {
  esophagus: "gi", stomach: "gi", small_bowel: "gi", colon: "gi",
  liver: "gi", biliary: "gi", pancreas: "gi", spleen: "gi",
  kidney: "genito_urinary", bladder: "genito_urinary", uterus: "genito_urinary",
  chest: "thorax", heart: "thorax",
  brain: "neuro",
  msk: "msk",
  breast: "breast",
  head_neck: "head_neck",
  pediatric: "pediatric",
  nuclear: "nuclear",
  interventional: "interventional",
};

// System labels (French)
const SYSTEM_LABELS = {
  gi: "Gastro-intestinal",
  genito_urinary: "Génito-urinaire",
  thorax: "Thorax",
  neuro: "Neuro",
  msk: "Musculosquelettique",
  breast: "Sénologie",
  head_neck: "Tête & Cou",
  pediatric: "Pédiatrique",
  nuclear: "Médecine nucléaire",
  interventional: "Interventionnel",
};

// Organ labels (French)
const ORGAN_LABELS = {
  esophagus: "Œsophage", stomach: "Estomac", small_bowel: "Grêle",
  colon: "Côlon & Rectum", liver: "Foie", biliary: "Voies biliaires",
  pancreas: "Pancréas", spleen: "Rate",
  kidney: "Reins & Surrénales", bladder: "Vessie & Prostate",
  uterus: "Utérus & Ovaires",
  chest: "Poumons", heart: "Cœur & Vaisseaux",
  brain: "Cerveau & Rachis",
  msk: "MSK", breast: "Sein",
  head_neck: "Tête & Cou",
  pediatric: "Pédiatrique", nuclear: "Médecine nucléaire",
  interventional: "Interventionnel",
};

// Helper functions:
getSystemForOrgan(organ) → system key
getSystemLabel(system) → French label
getOrganLabel(organ) → French label
getOrgansForSystem(system) → organ keys[]
getAllSystems() → { key, label, organs[] }[]
```

This file is imported everywhere: flashcards page, chapters page, import page, analytics.

### Files to update with taxonomy:
- `src/app/chapters/page.tsx` — replace inline ORGAN_LABELS with shared taxonomy, group by system
- `src/app/import/page.tsx` — replace PRESET_ORGANS with taxonomy (grouped by system in the selector)
- `src/app/flashcards/page.tsx` — 3-level filter using taxonomy
- `src/app/api/flashcards/route.ts` — accept `system` and `organ` filter params

---

## Part 2: Flashcard System Overhaul

### Files to Modify/Create

#### 1. `src/lib/sm2.ts` — Add helpers
- `previewIntervals(ef, interval, reps)` → `{ again: number, hard: number, good: number, easy: number }` (days)
- `cardMaturity(interval, reps)` → `"new" | "learning" | "young" | "mature"`
- `xpForQuality(quality)` → XP points (Again=1, Hard=3, Good=5, Easy=8)
- `levelFromXp(xp)` → `{ level: number, currentXp: number, nextLevelXp: number }`

#### 2. `src/app/api/flashcards/route.ts` — Modify GET
- Add `mode=stats` → card state counts + streak + XP + today's new card usage
- Add `system` and `organ` filter params to all modes
- Modify `mode=due` to accept `newLimit`, separate new cards (0 reviews) from review cards, cap new
- Return `isNew: boolean` flag on each card
- Return `system` and `organ` computed from chapter relation

#### 3. `src/app/api/flashcards/review/route.ts` — Modify POST
- Return `xpEarned` in the response

#### 4. `src/app/flashcards/page.tsx` — Major rewrite

Three-state UI with 3-level filtering:

**State A: Pre-session dashboard**
```
┌─────────────────────────────────────────────┐
│ 🔥 Flashcards                  Série: 5 j   │
│                                              │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ │  12  │ │  34  │ │  28  │ │  156 │        │
│ │Nouv. │ │Appr. │ │À rév.│ │Maîtr.│        │
│ └──────┘ └──────┘ └──────┘ └──────┘        │
│                                              │
│ XP: 1 240  Niveau 3 ████████░░  → Niv.4    │
│                                              │
│ ── Filtre ──────────────────────────────     │
│ [Tout]  [GI]  [Génito-U]  [Thorax]  [...]  │
│                                              │
│   ↳ [Tout GI] [Œsophage] [Estomac] [Grêle] │
│     [Côlon] [Foie] [Biliaire] [Pancréas]    │
│                                              │
│ Nouvelles cartes/jour: [===15===]  8/20      │
│                                              │
│    [ Commencer la révision (43 cartes) ]     │
│                                              │
│ Par section:                                 │
│ Pancréas:   8 à réviser                      │
│ Foie:       5 à réviser                      │
│ Œsophage:   3 à réviser                      │
└─────────────────────────────────────────────┘
```

Filter logic:
- **Level 1 — No filter**: "Tout" selected → all due cards, random order
- **Level 2 — By system**: e.g., "GI" selected → all due cards from GI organs
- **Level 3 — By section**: e.g., "Pancréas" selected → only pancreas cards

The second row of filter pills only appears when a system is selected.

**State B: Active review** (enhanced)
- Same flip card + rating buttons
- Interval preview under each button: "< 1j", "4j", "10j", "25j"
- Re-queue "Again" cards: pushed to back of queue, session ends when queue empty
- Track per-rating counts in state: `{ again: 0, hard: 0, good: 0, easy: 0 }`
- Track XP earned + per-card intervals for summary
- Progress bar shows total unique cards reviewed / total in session

**State C: Session summary**
```
┌─────────────────────────────────────────────┐
│ 🏆 Session terminée !                       │
│                                              │
│ 43 cartes révisées  •  +215 XP              │
│                                              │
│ À revoir  ██░░░░░░░░░ 5 (12%)              │
│ Difficile ████░░░░░░░ 8 (19%)              │
│ Bien      █████████░░ 22 (51%)             │
│ Facile    ████░░░░░░░ 8 (19%)              │
│                                              │
│ Rétention: 88%  🎯                          │
│ 🔥 Série: 6 jours !                         │
│                                              │
│ À revoir bientôt:                            │
│ • 5 cartes demain (À revoir)                │
│ • 8 cartes dans 4j (Difficile)              │
│                                              │
│ "Excellente session ! Votre rétention       │
│  dépasse 85% — continuez comme ça !"       │
│                                              │
│ [Continuer]  [Tableau de bord]              │
└─────────────────────────────────────────────┘
```

---

## Implementation Order

### Step 1: Shared taxonomy (`src/lib/taxonomy.ts`)
Create the organ → system mapping, labels, and helper functions.

### Step 2: SM-2 helpers (`src/lib/sm2.ts`)
Add `previewIntervals`, `cardMaturity`, `xpForQuality`, `levelFromXp`.

### Step 3: Flashcard API overhaul (`src/app/api/flashcards/route.ts`)
- Add `mode=stats` returning card counts, streak, XP, today's new cards
- Add `system` and `organ` filter params
- Modify `mode=due` to accept `newLimit` and separate new/review cards

### Step 4: Review API (`src/app/api/flashcards/review/route.ts`)
Return `xpEarned` in the response.

### Step 5: Flashcard page rewrite (`src/app/flashcards/page.tsx`)
- Pre-session dashboard with taxonomy filters + stats + gamification
- Enhanced review with interval preview + Anki-style re-queuing
- Session summary with breakdown

### Step 6: Update chapters page + import page with shared taxonomy
Replace inline ORGAN_LABELS with taxonomy imports.

---

## Key Technical Decisions

- **No DB schema changes** — system computed from organ field via shared mapping
- **Daily new card limit in localStorage** — simple, no migration needed
- **Again re-queue**: cards rated Again(0) pushed to end of array, removed when rated ≥ 3. Session ends when queue is empty.
- **Streak**: count consecutive days (backward from today) that have ≥1 FlashcardReview record
- **XP**: Again=1, Hard=3, Good=5, Easy=8 per review. Computed by summing all FlashcardReview records.
- **Levels**: `level = floor(sqrt(totalXP / 50))`. Level 1=50 XP, Level 5=1250 XP, Level 10=5000 XP.
- **Filter state**: stored in URL params (`?system=gi&organ=pancreas`) so links are shareable

## Gamification Details

### XP System
| Rating | XP | Rationale |
|--------|-----|-----------|
| À revoir (0) | 1 | You still showed up |
| Difficile (3) | 3 | Effort rewarded |
| Bien (4) | 5 | Solid recall |
| Facile (5) | 8 | Mastery bonus |

### Streak Messages (French)
- 0 days: "Commencez une série !"
- 1-2 days: "Bon début ! 🔥"
- 3-6 days: "Belle série de {n} jours ! 🔥"
- 7-13 days: "1 semaine+ ! Impressionnant ! 🔥🔥"
- 14-29 days: "2 semaines+ ! Vous êtes en feu ! 🔥🔥🔥"
- 30+ days: "{n} jours ! Légende ! 🔥🔥🔥🔥"

### Retention-Based Messages (French)
- ≥ 90%: "Excellente maîtrise ! Vous êtes prêt pour le FMH2 !"
- ≥ 80%: "Très bonne session ! Continuez comme ça !"
- ≥ 70%: "Bonne session ! Les cartes difficiles reviendront bientôt."
- ≥ 60%: "Session correcte. Révisez les cartes ratées avant demain."
- < 60%: "Session difficile. Pas de panique — la répétition fera son travail !"

### Rating Buttons (French)
| Key | Quality | Label | Color |
|-----|---------|-------|-------|
| 1 | 0 | À revoir | Red |
| 2 | 3 | Difficile | Orange |
| 3 | 4 | Bien | Blue |
| 4 | 5 | Facile | Green |
