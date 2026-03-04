"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain, Layers, Pencil, Trash2, Check, X, MoreVertical } from "lucide-react";
import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import {
  ORGAN_LABELS,
  ORGAN_TO_SYSTEM,
  getAllSystems,
  getSystemLabel,
  getOrganLabel,
} from "@/lib/taxonomy";

interface Chapter {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  organ: string | null;
  summary: string | null;
  _count: {
    questions: number;
    flashcards: number;
  };
}

function getBookLabel(bookSource: string): string {
  if (bookSource === "core_radiology") return "Core Radiology";
  if (bookSource === "crack_the_core") return "Crack the Core";
  if (bookSource === "notebook_import") return "Imported Notes";
  return bookSource;
}

function ChaptersContent() {
  const searchParams = useSearchParams();
  const paramOrgan = searchParams.get("organ");
  const paramSystem = searchParams.get("system");

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSystem, setSelectedSystem] = useState<string | null>(
    paramSystem || (paramOrgan ? ORGAN_TO_SYSTEM[paramOrgan] ?? null : null)
  );
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(paramOrgan);
  const [bookFilter, setBookFilter] = useState<string>("all");

  // Chapter management state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  const systems = useMemo(() => getAllSystems(), []);

  // Always load all chapters (client-side filtering)
  const loadChapters = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/chapters")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load chapters (${r.status})`);
        return r.json();
      })
      .then(setChapters)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chapters"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadChapters(); }, [loadChapters]);

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

  // Only show systems that have at least one chapter
  const systemsWithChapters = useMemo(() => {
    const organSet = new Set(chapters.map((ch) => ch.organ).filter(Boolean) as string[]);
    return systems.filter((sys) =>
      sys.organs.some((o) => organSet.has(o.key))
    );
  }, [chapters, systems]);

  // Only show organs that have at least one chapter
  const organsWithChapters = useMemo(() => {
    if (!selectedSystem) return [];
    const organSet = new Set(chapters.map((ch) => ch.organ).filter(Boolean) as string[]);
    const sys = systems.find((s) => s.key === selectedSystem);
    return sys?.organs.filter((o) => organSet.has(o.key)) ?? [];
  }, [chapters, systems, selectedSystem]);

  // Unique book sources present
  const bookSources = useMemo(() => {
    const sources = [...new Set(chapters.map((ch) => ch.bookSource))];
    return sources.sort();
  }, [chapters]);

  // Apply filters
  const filteredChapters = useMemo(() => {
    return chapters.filter((ch) => {
      // System filter
      if (selectedSystem) {
        const chSystem = ch.organ ? ORGAN_TO_SYSTEM[ch.organ] : null;
        if (chSystem !== selectedSystem) return false;
      }
      // Organ filter
      if (selectedOrgan) {
        if (ch.organ !== selectedOrgan) return false;
      }
      // Book source filter
      if (bookFilter !== "all") {
        if (ch.bookSource !== bookFilter) return false;
      }
      return true;
    });
  }, [chapters, selectedSystem, selectedOrgan, bookFilter]);

  // Group chapters by organ for display when a system is selected
  const groupedChapters = useMemo(() => {
    if (!selectedSystem || selectedOrgan) return null;

    const groups: { organ: string; label: string; chapters: Chapter[] }[] = [];
    const byOrgan = new Map<string, Chapter[]>();

    for (const ch of filteredChapters) {
      const key = ch.organ || "_uncategorized";
      if (!byOrgan.has(key)) byOrgan.set(key, []);
      byOrgan.get(key)!.push(ch);
    }

    // Sort organs in the order they appear in the system definition
    const sys = systems.find((s) => s.key === selectedSystem);
    if (sys) {
      for (const o of sys.organs) {
        const chs = byOrgan.get(o.key);
        if (chs && chs.length > 0) {
          groups.push({ organ: o.key, label: o.label, chapters: chs });
        }
      }
    }

    // Add uncategorized at end
    const uncategorized = byOrgan.get("_uncategorized");
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ organ: "_uncategorized", label: "Non classé", chapters: uncategorized });
    }

    return groups;
  }, [filteredChapters, selectedSystem, selectedOrgan, systems]);

  // Count chapters per system for badge display
  const chapterCountBySystem = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ch of chapters) {
      if (ch.organ) {
        const sys = ORGAN_TO_SYSTEM[ch.organ];
        if (sys) counts[sys] = (counts[sys] || 0) + 1;
      }
    }
    return counts;
  }, [chapters]);

  const books = [
    { key: "all", label: "Toutes les sources" },
    { key: "core_radiology", label: "Core Radiology" },
    { key: "crack_the_core", label: "Crack the Core" },
    { key: "notebook_import", label: "Notes importées" },
  ];

  // ── Render a single chapter card ──────────────────────────────────────────

  const renderChapterCard = (ch: Chapter) => (
    <Card key={ch.id} className="hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        {deletingId === ch.id ? (
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
          <div className="flex items-start justify-between">
            <Link href={`/chapters/${ch.id}`} className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 mb-1">
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
                    {ORGAN_LABELS[ch.organ] || ch.organ}
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
            </Link>
            <div className="flex items-center gap-3 text-sm text-muted-foreground ml-4">
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Chapitres</h1>
        <p className="text-muted-foreground mt-1">
          Parcourir les guides d&apos;étude par thème
        </p>
      </div>

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
                ? `Aucun chapitre pour ${getSystemLabel(selectedSystem)}${selectedOrgan ? ` / ${getOrganLabel(selectedOrgan)}` : ""}.`
                : "Importez des notes ou lancez le pipeline d'ingestion."}
            </p>
          </CardContent>
        </Card>
      ) : groupedChapters ? (
        /* Grouped display when a system is selected but no specific organ */
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
        /* Flat list */
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
