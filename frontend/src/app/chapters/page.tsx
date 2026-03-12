"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Brain,
  Layers,
  Pencil,
  Trash2,
  Check,
  X,
  MoreVertical,
  FolderInput,
  BookCheck,
  ArrowUpDown,
  Clock,
  Target,
} from "lucide-react";
import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import {
  ORGAN_TO_SYSTEM as FALLBACK_ORGAN_TO_SYSTEM,
  getAllSystems as getFallbackSystems,
  type SystemInfo,
  type DbSystem,
  buildTaxonomyFromDb,
  resolveOrganSystem,
  resolveOrganLabel,
} from "@/lib/taxonomy";

interface Chapter {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  organ: string | null;
  summary: string | null;
  lastStudiedAt: string | null;
  _count: {
    questions: number;
    flashcards: number;
  };
  quizAccuracy: number | null;
  questionsAttempted: number;
}

function getBookLabel(bookSource: string): string {
  if (bookSource === "core_radiology") return "Core Radiology";
  if (bookSource === "crack_the_core") return "Crack the Core";
  if (bookSource === "notebook_import") return "Imported Notes";
  return bookSource;
}

/** Spaced review intervals (days) — exponential schedule for chapter-level review */
const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];

/** Returns a recency status based on days since last study, with review-due awareness */
function getRecencyStatus(lastStudiedAt: string | null): {
  label: string;
  color: string;
  bgColor: string;
  daysAgo: number | null;
  reviewDue: boolean;
  reviewLabel: string | null;
} {
  if (!lastStudiedAt) {
    return { label: "Jamais étudié", color: "text-muted-foreground", bgColor: "bg-muted", daysAgo: null, reviewDue: true, reviewLabel: "Nouveau" };
  }
  const days = Math.floor(
    (Date.now() - new Date(lastStudiedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Determine if review is due based on spaced intervals
  // Find the smallest interval the user has exceeded
  const reviewDue = REVIEW_INTERVALS.some(interval => days >= interval && days < interval * 2) || days >= 30;
  const reviewLabel = days >= 30 ? "Révision urgente" : days >= 14 ? "Révision recommandée" : days >= 7 ? "À revoir bientôt" : null;

  if (days === 0) return { label: "Aujourd'hui", color: "text-green-700", bgColor: "bg-green-100 dark:bg-green-900/30", daysAgo: 0, reviewDue: false, reviewLabel: null };
  if (days <= 3) return { label: `Il y a ${days}j`, color: "text-green-600", bgColor: "bg-green-50 dark:bg-green-900/20", daysAgo: days, reviewDue, reviewLabel };
  if (days <= 7) return { label: `Il y a ${days}j`, color: "text-yellow-600", bgColor: "bg-yellow-50 dark:bg-yellow-900/20", daysAgo: days, reviewDue, reviewLabel };
  if (days <= 14) return { label: `Il y a ${days}j`, color: "text-orange-600", bgColor: "bg-orange-50 dark:bg-orange-900/20", daysAgo: days, reviewDue, reviewLabel };
  return { label: `Il y a ${days}j`, color: "text-red-600", bgColor: "bg-red-50 dark:bg-red-900/20", daysAgo: days, reviewDue, reviewLabel };
}

// ── Two-level organ assigner: System → Organ ────────────────────────────────

function OrganAssigner({
  currentOrgan,
  title,
  systems,
  organToSystem,
  dbSystems,
  onAssign,
  onCancel,
  onTaxonomyChanged,
}: {
  currentOrgan: string | null;
  title: string;
  systems: SystemInfo[];
  organToSystem: Record<string, string>;
  dbSystems: import("@/lib/taxonomy").DbSystem[] | null;
  onAssign: (organ: string) => void;
  onCancel: () => void;
  onTaxonomyChanged: () => void;
}) {
  const [pickedSystem, setPickedSystem] = useState<string | null>(
    currentOrgan ? organToSystem[currentOrgan] ?? null : null
  );
  const [addingSystem, setAddingSystem] = useState(false);
  const [newSysLabel, setNewSysLabel] = useState("");
  const [addingOrgan, setAddingOrgan] = useState(false);
  const [newOrgLabel, setNewOrgLabel] = useState("");

  const currentSystemOrgans = useMemo(() => {
    if (!pickedSystem) return [];
    return systems.find((s) => s.key === pickedSystem)?.organs ?? [];
  }, [pickedSystem, systems]);

  const handleAddSystem = async () => {
    const label = newSysLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    try {
      await fetch("/api/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_system", key, label }),
      });
      onTaxonomyChanged();
      setAddingSystem(false);
      setNewSysLabel("");
      // Auto-select the new system after a brief delay for re-render
      setTimeout(() => setPickedSystem(key), 100);
    } catch (e) { console.error(e); }
  };

  const handleAddOrgan = async () => {
    const label = newOrgLabel.trim();
    if (!label || !pickedSystem) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const dbSys = dbSystems?.find((s) => s.key === pickedSystem);
    if (!dbSys) return;
    try {
      await fetch("/api/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_organ", systemId: dbSys.id, key, label }),
      });
      onTaxonomyChanged();
      setAddingOrgan(false);
      setNewOrgLabel("");
      // Auto-assign the new organ
      setTimeout(() => onAssign(key), 100);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        Assigner &quot;{title}&quot; — choisir le système puis la section :
      </p>

      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Système :</p>
        <div className="flex flex-wrap gap-1.5">
          {systems.map((sys) => (
            <button
              key={sys.key}
              onClick={() => { setPickedSystem(sys.key); setAddingOrgan(false); }}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                pickedSystem === sys.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent border-border"
              }`}
            >
              {sys.label}
            </button>
          ))}
          {!addingSystem ? (
            <button
              onClick={() => setAddingSystem(true)}
              className="px-2.5 py-1 rounded-md border border-dashed border-primary/40 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
            >
              + Nouveau système
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newSysLabel}
                onChange={(e) => setNewSysLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddSystem(); if (e.key === "Escape") setAddingSystem(false); }}
                placeholder="Nom du système..."
                className="px-2 py-1 text-xs border rounded-md bg-background w-36"
              />
              <button onClick={handleAddSystem} className="px-1.5 py-1 text-xs text-primary hover:bg-primary/10 rounded">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setAddingSystem(false)} className="px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted rounded">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {pickedSystem && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Section :</p>
          <div className="flex flex-wrap gap-1.5 pl-2 border-l-2 border-primary/20">
            {currentSystemOrgans.map((o) => (
              <button
                key={o.key}
                onClick={() => onAssign(o.key)}
                className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                  currentOrgan === o.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-accent border-border"
                }`}
              >
                {o.label}
              </button>
            ))}
            {!addingOrgan ? (
              <button
                onClick={() => setAddingOrgan(true)}
                className="px-2.5 py-1 rounded-md border border-dashed border-primary/40 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
              >
                + Nouvelle section
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newOrgLabel}
                  onChange={(e) => setNewOrgLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddOrgan(); if (e.key === "Escape") setAddingOrgan(false); }}
                  placeholder="Nom de la section..."
                  className="px-2 py-1 text-xs border rounded-md bg-background w-36"
                />
                <button onClick={handleAddOrgan} className="px-1.5 py-1 text-xs text-primary hover:bg-primary/10 rounded">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setAddingOrgan(false)} className="px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted rounded">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <Button size="sm" variant="outline" onClick={onCancel} className="text-xs">
        Annuler
      </Button>
    </div>
  );
}

type SortMode = "default" | "last_studied" | "quiz_accuracy";

function ChaptersContent() {
  const searchParams = useSearchParams();
  const paramOrgan = searchParams.get("organ");
  const paramSystem = searchParams.get("system");

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dynamic taxonomy from DB
  const [dbSystems, setDbSystems] = useState<DbSystem[] | null>(null);
  const taxonomy = useMemo(() => {
    if (dbSystems) return buildTaxonomyFromDb(dbSystems);
    // Fallback to hardcoded
    const fallback = getFallbackSystems();
    return {
      systems: fallback,
      organToSystem: FALLBACK_ORGAN_TO_SYSTEM,
      organLabels: {} as Record<string, string>,
      systemLabels: {} as Record<string, string>,
    };
  }, [dbSystems]);

  const systems = taxonomy.systems;
  const ORGAN_TO_SYSTEM = taxonomy.organToSystem;
  const getOrganLabelResolved = useCallback((organ: string) => resolveOrganLabel(organ, taxonomy.organLabels), [taxonomy.organLabels]);
  const getSystemLabel = (system: string) => taxonomy.systemLabels[system] || system;
  /** Resolve an organ value (key, label, or system-name) to its system key */
  const getSystemForOrgan = useCallback((organ: string) => resolveOrganSystem(organ, ORGAN_TO_SYSTEM), [ORGAN_TO_SYSTEM]);

  // Filters
  const [selectedSystem, setSelectedSystem] = useState<string | null>(
    paramSystem || (paramOrgan ? FALLBACK_ORGAN_TO_SYSTEM[paramOrgan] ?? null : null)
  );
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(paramOrgan);
  const [bookFilter, setBookFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("default");

  // Chapter management state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [assigningOrganId, setAssigningOrganId] = useState<number | null>(null);
  const [markingStudied, setMarkingStudied] = useState<Set<number>>(new Set());

  // Adding new system/organ inline
  const [addingNewSystem, setAddingNewSystem] = useState(false);
  const [newSystemLabel, setNewSystemLabel] = useState("");
  const [addingNewOrgan, setAddingNewOrgan] = useState<number | null>(null); // systemId
  const [newOrganLabel, setNewOrganLabel] = useState("");

  const loadTaxonomy = useCallback(() => {
    fetch("/api/taxonomy")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && Array.isArray(data)) setDbSystems(data); })
      .catch(() => {});
  }, []);

  const loadChapters = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/chapters?stats=1")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load chapters (${r.status})`);
        return r.json();
      })
      .then((data: Chapter[]) => setChapters(data.filter((ch) => ch.bookSource !== "image_cases")))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chapters"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTaxonomy(); loadChapters(); }, [loadTaxonomy, loadChapters]);

  const markAsStudied = async (id: number) => {
    setMarkingStudied((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/chapters/${id}/study`, { method: "POST" });
      if (res.ok) {
        const { lastStudiedAt } = await res.json();
        setChapters((prev) =>
          prev.map((ch) => ch.id === id ? { ...ch, lastStudiedAt } : ch)
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setMarkingStudied((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const renameChapter = async (id: number) => {
    if (!editTitle.trim()) return;
    try {
      const res = await fetch(`/api/chapters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle }),
      });
      if (res.ok) {
        setChapters((prev) => prev.map((ch) => ch.id === id ? { ...ch, title: editTitle.trim() } : ch));
        setEditingId(null);
      }
    } catch (e) { console.error(e); }
  };

  const deleteChapter = async (id: number) => {
    try {
      const res = await fetch(`/api/chapters/${id}`, { method: "DELETE" });
      if (res.ok) {
        setChapters((prev) => prev.filter((ch) => ch.id !== id));
        setDeletingId(null);
      }
    } catch (e) { console.error(e); }
  };

  const assignOrgan = async (id: number, organ: string) => {
    try {
      const res = await fetch(`/api/chapters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organ }),
      });
      if (res.ok) {
        setChapters((prev) => prev.map((ch) => ch.id === id ? { ...ch, organ } : ch));
        setAssigningOrganId(null);
      }
    } catch (e) { console.error(e); }
  };

  // Only show systems that have at least one chapter (using resolver for non-key organ values)
  const systemsWithChapters = useMemo(() => {
    const systemSet = new Set<string>();
    for (const ch of chapters) {
      if (ch.organ) {
        const sys = getSystemForOrgan(ch.organ);
        if (sys) systemSet.add(sys);
      }
    }
    return systems.filter((sys) => systemSet.has(sys.key));
  }, [chapters, systems, getSystemForOrgan]);

  // Count chapters with no organ or organ not in taxonomy
  const unclassifiedCount = useMemo(() => {
    return chapters.filter((ch) => !ch.organ || !getSystemForOrgan(ch.organ)).length;
  }, [chapters, getSystemForOrgan]);

  const organsWithChapters = useMemo(() => {
    if (!selectedSystem) return [];
    // Collect all organ keys that resolve to the selected system
    const organKeysInSystem = new Set<string>();
    for (const ch of chapters) {
      if (ch.organ && getSystemForOrgan(ch.organ) === selectedSystem) {
        organKeysInSystem.add(ch.organ);
      }
    }
    const sys = systems.find((s) => s.key === selectedSystem);
    return sys?.organs.filter((o) => organKeysInSystem.has(o.key)) ?? [];
  }, [chapters, systems, selectedSystem, getSystemForOrgan]);

  const bookSources = useMemo(() => {
    const sources = [...new Set(chapters.map((ch) => ch.bookSource))];
    return sources.sort();
  }, [chapters]);

  // Apply filters + sort
  const filteredChapters = useMemo(() => {
    let result = chapters.filter((ch) => {
      if (selectedSystem === "_unclassified") {
        if (ch.organ && getSystemForOrgan(ch.organ)) return false;
        // Show only unclassified chapters
      } else if (selectedSystem) {
        const chSystem = ch.organ ? getSystemForOrgan(ch.organ) : null;
        if (chSystem !== selectedSystem) return false;
      }
      if (selectedOrgan) {
        if (ch.organ !== selectedOrgan) return false;
      }
      if (bookFilter !== "all") {
        if (ch.bookSource !== bookFilter) return false;
      }
      return true;
    });

    // Apply sort
    if (sortMode === "last_studied") {
      result = [...result].sort((a, b) => {
        // Never studied → top (needs attention)
        if (!a.lastStudiedAt && !b.lastStudiedAt) return 0;
        if (!a.lastStudiedAt) return -1;
        if (!b.lastStudiedAt) return 1;
        // Oldest studied first (needs review most)
        return new Date(a.lastStudiedAt).getTime() - new Date(b.lastStudiedAt).getTime();
      });
    } else if (sortMode === "quiz_accuracy") {
      result = [...result].sort((a, b) => {
        // No quiz data → top (needs attention)
        if (a.quizAccuracy === null && b.quizAccuracy === null) return 0;
        if (a.quizAccuracy === null) return -1;
        if (b.quizAccuracy === null) return 1;
        // Lowest accuracy first
        return a.quizAccuracy - b.quizAccuracy;
      });
    }

    return result;
  }, [chapters, selectedSystem, selectedOrgan, bookFilter, sortMode, getSystemForOrgan]);

  // Group chapters by organ for display when a system is selected
  const groupedChapters = useMemo(() => {
    if (!selectedSystem || selectedOrgan) return null;
    if (selectedSystem === "_unclassified") return null; // Flat list for unclassified
    if (sortMode !== "default") return null; // Don't group when sorting

    const groups: { organ: string; label: string; chapters: Chapter[] }[] = [];
    const byOrgan = new Map<string, Chapter[]>();

    for (const ch of filteredChapters) {
      const key = ch.organ || "_uncategorized";
      if (!byOrgan.has(key)) byOrgan.set(key, []);
      byOrgan.get(key)!.push(ch);
    }

    const sys = systems.find((s) => s.key === selectedSystem);
    if (sys) {
      for (const o of sys.organs) {
        const chs = byOrgan.get(o.key);
        if (chs && chs.length > 0) {
          groups.push({ organ: o.key, label: o.label, chapters: chs });
        }
      }
    }

    const uncategorized = byOrgan.get("_uncategorized");
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ organ: "_uncategorized", label: "Non classé", chapters: uncategorized });
    }

    return groups;
  }, [filteredChapters, selectedSystem, selectedOrgan, systems, sortMode]);

  const chapterCountBySystem = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ch of chapters) {
      if (ch.organ) {
        const sys = getSystemForOrgan(ch.organ);
        if (sys) counts[sys] = (counts[sys] || 0) + 1;
      }
    }
    return counts;
  }, [chapters, getSystemForOrgan]);

  // Study stats
  const studyStats = useMemo(() => {
    const total = filteredChapters.length;
    const studied = filteredChapters.filter((ch) => ch.lastStudiedAt).length;
    const withQuiz = filteredChapters.filter((ch) => ch.quizAccuracy !== null);
    const avgAccuracy = withQuiz.length > 0
      ? Math.round(withQuiz.reduce((sum, ch) => sum + ch.quizAccuracy!, 0) / withQuiz.length)
      : null;
    return { total, studied, avgAccuracy };
  }, [filteredChapters]);

  const books = [
    { key: "all", label: "Toutes les sources" },
    { key: "core_radiology", label: "Core Radiology" },
    { key: "crack_the_core", label: "Crack the Core" },
    { key: "notebook_import", label: "Notes importées" },
  ];

  // ── Render a single chapter card ──────────────────────────────────────────

  const renderChapterCard = (ch: Chapter) => {
    const recency = getRecencyStatus(ch.lastStudiedAt);

    return (
      <Card key={ch.id} className="hover:border-primary/50 transition-colors">
        <CardContent className="p-5">
          {assigningOrganId === ch.id ? (
            <OrganAssigner
              currentOrgan={ch.organ}
              title={ch.title}
              systems={systems}
              organToSystem={ORGAN_TO_SYSTEM}
              dbSystems={dbSystems}
              onAssign={(organ) => assignOrgan(ch.id, organ)}
              onCancel={() => setAssigningOrganId(null)}
              onTaxonomyChanged={loadTaxonomy}
            />
          ) : deletingId === ch.id ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-destructive font-medium">
                Supprimer &quot;{ch.title}&quot; et toutes ses questions, flashcards et notes ?
              </p>
              <div className="flex gap-2 ml-4">
                <Button size="sm" variant="destructive" onClick={() => deleteChapter(ch.id)} className="text-xs gap-1">
                  <Trash2 className="h-3.5 w-3.5" />Supprimer
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeletingId(null)} className="text-xs">
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <Link href={`/chapters/${ch.id}`} className="flex-1 cursor-pointer min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge
                    variant={
                      ch.bookSource === "core_radiology"
                        ? "default"
                        : ch.bookSource === "notebook_import"
                        ? "outline"
                        : "secondary"
                    }
                    className={`text-xs ${
                      ch.bookSource === "notebook_import"
                        ? "border-purple-400 text-purple-700 dark:text-purple-300"
                        : ""
                    }`}
                  >
                    {getBookLabel(ch.bookSource)}
                  </Badge>
                  {ch.organ && !selectedOrgan && (
                    <Badge variant="outline" className="text-xs">
                      {getOrganLabelResolved(ch.organ)}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Ch. {ch.number}
                  </span>
                </div>
                {editingId === ch.id ? (
                  <div className="flex items-center gap-2 mt-1" onClick={(e) => e.preventDefault()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameChapter(ch.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 px-2 py-1 border rounded text-lg font-semibold bg-background"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" onClick={() => renameChapter(ch.id)} className="h-8 w-8 p-0">
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-8 w-8 p-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <h3 className="text-lg font-semibold">{ch.title}</h3>
                )}
                {ch.summary && editingId !== ch.id && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {ch.summary.substring(0, 150)}...
                  </p>
                )}

                {/* Study indicators row */}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {/* Recency badge */}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${recency.bgColor} ${recency.color} font-medium`}>
                    <Clock className="h-3 w-3 inline mr-1" />
                    {recency.label}
                  </span>
                  {/* Review due badge */}
                  {recency.reviewLabel && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      recency.reviewLabel === "Révision urgente"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : recency.reviewLabel === "Révision recommandée"
                        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    }`}>
                      {recency.reviewLabel}
                    </span>
                  )}

                  {/* Quiz accuracy */}
                  {ch.quizAccuracy !== null && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ch.quizAccuracy >= 80
                        ? "bg-green-50 text-green-700 dark:bg-green-900/20"
                        : ch.quizAccuracy >= 60
                        ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20"
                        : "bg-red-50 text-red-700 dark:bg-red-900/20"
                    }`}>
                      <Target className="h-3 w-3 inline mr-1" />
                      Quiz: {ch.quizAccuracy}%
                      <span className="text-[10px] opacity-70 ml-1">
                        ({ch.questionsAttempted}/{ch._count.questions})
                      </span>
                    </span>
                  )}
                  {ch.quizAccuracy === null && ch._count.questions > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      <Target className="h-3 w-3 inline mr-1" />
                      Quiz: pas encore testé
                    </span>
                  )}
                </div>
              </Link>

              <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                {/* Mark as studied button */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    markAsStudied(ch.id);
                  }}
                  disabled={markingStudied.has(ch.id)}
                  className={`p-1.5 rounded-md transition-colors ${
                    markingStudied.has(ch.id)
                      ? "opacity-50"
                      : "hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  }`}
                  title="Marquer comme étudié"
                >
                  <BookCheck className="h-4 w-4" />
                </button>

                <span className="flex items-center gap-1">
                  <Brain className="h-4 w-4" />
                  {ch._count.questions}
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="h-4 w-4" />
                  {ch._count.flashcards}
                </span>
                <div className="relative">
                  <button
                    onClick={(e) => { e.preventDefault(); setMenuOpenId(menuOpenId === ch.id ? null : ch.id); }}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {menuOpenId === ch.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                      <div className="absolute right-0 top-8 z-20 bg-popover border rounded-lg shadow-lg py-1 min-w-[140px]">
                        <button
                          className="w-full px-3 py-2 text-sm text-left hover:bg-accent flex items-center gap-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditTitle(ch.title);
                            setEditingId(ch.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Renommer
                        </button>
                        <button
                          className="w-full px-3 py-2 text-sm text-left hover:bg-accent flex items-center gap-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setAssigningOrganId(ch.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <FolderInput className="h-3.5 w-3.5" />
                          Changer de section
                        </button>
                        <button
                          className="w-full px-3 py-2 text-sm text-left hover:bg-accent flex items-center gap-2 text-destructive"
                          onClick={(e) => {
                            e.preventDefault();
                            setDeletingId(ch.id);
                            setMenuOpenId(null);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Chapitres</h1>
        <p className="text-muted-foreground mt-1">
          Parcourir les guides d&apos;étude par thème
        </p>
      </div>

      {/* Study stats summary */}
      {!loading && chapters.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <BookCheck className="h-4 w-4 text-green-600" />
            <span className="font-medium">{studyStats.studied}/{studyStats.total}</span>
            <span className="text-muted-foreground">chapitres étudiés</span>
          </div>
          {studyStats.avgAccuracy !== null && (
            <div className="flex items-center gap-2 text-sm">
              <Target className="h-4 w-4 text-blue-600" />
              <span className="font-medium">{studyStats.avgAccuracy}%</span>
              <span className="text-muted-foreground">score quiz moyen</span>
            </div>
          )}
        </div>
      )}

      {/* System (theme) filter */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant={!selectedSystem ? "default" : "outline"}
          onClick={() => { setSelectedSystem(null); setSelectedOrgan(null); }}
        >
          Tout
        </Button>
        {systemsWithChapters.map((sys) => (
          <Button
            key={sys.key}
            size="sm"
            variant={selectedSystem === sys.key ? "default" : "outline"}
            onClick={() => { setSelectedSystem(sys.key); setSelectedOrgan(null); }}
          >
            {sys.label}
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
              {chapterCountBySystem[sys.key] || 0}
            </Badge>
          </Button>
        ))}
        {unclassifiedCount > 0 && (
          <Button
            size="sm"
            variant={selectedSystem === "_unclassified" ? "default" : "outline"}
            className="border-dashed"
            onClick={() => { setSelectedSystem("_unclassified"); setSelectedOrgan(null); }}
          >
            Non classé
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
              {unclassifiedCount}
            </Badge>
          </Button>
        )}
      </div>

      {/* Organ sub-filter when system is selected */}
      {selectedSystem && organsWithChapters.length > 1 && (
        <div className="flex gap-2 flex-wrap pl-2 border-l-2 border-primary/20">
          <Button
            size="sm"
            variant={!selectedOrgan ? "default" : "outline"}
            onClick={() => setSelectedOrgan(null)}
          >
            Tout {getSystemLabel(selectedSystem)}
          </Button>
          {organsWithChapters.map((o) => (
            <Button
              key={o.key}
              size="sm"
              variant={selectedOrgan === o.key ? "default" : "outline"}
              onClick={() => setSelectedOrgan(o.key)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      {/* Sort + book source filter row */}
      <div className="flex gap-3 flex-wrap items-center">
        {/* Sort buttons */}
        <div className="flex gap-1 items-center">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground mr-1" />
          <Button
            size="sm"
            variant={sortMode === "default" ? "secondary" : "ghost"}
            className="text-xs h-7"
            onClick={() => setSortMode("default")}
          >
            Par défaut
          </Button>
          <Button
            size="sm"
            variant={sortMode === "last_studied" ? "secondary" : "ghost"}
            className="text-xs h-7"
            onClick={() => setSortMode("last_studied")}
          >
            <Clock className="h-3 w-3 mr-1" />
            Dernière étude
          </Button>
          <Button
            size="sm"
            variant={sortMode === "quiz_accuracy" ? "secondary" : "ghost"}
            className="text-xs h-7"
            onClick={() => setSortMode("quiz_accuracy")}
          >
            <Target className="h-3 w-3 mr-1" />
            Score quiz
          </Button>
        </div>

        {/* Separator */}
        {bookSources.length > 1 && <div className="w-px h-5 bg-border" />}

        {/* Book source secondary filter */}
        {bookSources.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {books
              .filter((b) => b.key === "all" || bookSources.includes(b.key))
              .map((b) => (
                <Button
                  key={b.key}
                  size="sm"
                  variant={bookFilter === b.key ? "secondary" : "ghost"}
                  className="text-xs h-7"
                  onClick={() => setBookFilter(b.key)}
                >
                  {b.label}
                </Button>
              ))}
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-destructive font-medium">{error}</p>
            <button onClick={loadChapters} className="mt-3 text-sm text-muted-foreground underline hover:text-foreground">
              Réessayer
            </button>
          </CardContent>
        </Card>
      )}

      {/* Chapter List */}
      {!error && loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredChapters.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Aucun chapitre</h3>
            <p className="text-muted-foreground">
              {selectedSystem
                ? `Aucun chapitre pour ${getSystemLabel(selectedSystem)}${selectedOrgan ? ` / ${getOrganLabelResolved(selectedOrgan)}` : ""}.`
                : "Importez des notes ou lancez le pipeline d'ingestion."}
            </p>
          </CardContent>
        </Card>
      ) : groupedChapters ? (
        <div className="space-y-6">
          {groupedChapters.map((group) => (
            <div key={group.organ}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                {group.label}
                <span className="text-xs font-normal">({group.chapters.length})</span>
              </h2>
              <div className="space-y-3">
                {group.chapters.map(renderChapterCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredChapters.map(renderChapterCard)}
        </div>
      )}
    </div>
  );
}

export default function ChaptersPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Chapitres</h1>
            <p className="text-muted-foreground mt-1">Chargement...</p>
          </div>
        </div>
      }
    >
      <ChaptersContent />
    </Suspense>
  );
}
