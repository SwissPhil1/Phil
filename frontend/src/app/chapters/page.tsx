"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain, Layers, Pencil, Trash2, Check, X, MoreVertical } from "lucide-react";
import { useEffect, useState, useCallback, Suspense } from "react";

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

const ORGAN_LABELS: Record<string, string> = {
  esophagus: "Esophagus",
  stomach: "Stomach",
  small_bowel: "Small Bowel",
  colon: "Colon & Rectum",
  liver: "Liver",
  biliary: "Biliary System",
  pancreas: "Pancreas",
  spleen: "Spleen",
  kidney: "Kidney & Adrenal",
  bladder: "Bladder & Prostate",
  uterus: "Uterus & Ovaries",
  chest: "Chest & Lungs",
  heart: "Heart & Vessels",
  brain: "Brain & Spine",
  msk: "MSK",
  breast: "Breast",
  head_neck: "Head & Neck",
  pediatric: "Pediatric",
  nuclear: "Nuclear Medicine",
  interventional: "Interventional",
};

function getBookLabel(bookSource: string): string {
  if (bookSource === "core_radiology") return "Core Radiology";
  if (bookSource === "crack_the_core") return "Crack the Core";
  if (bookSource === "notebook_import") return "Imported Notes";
  return bookSource;
}

function ChaptersContent() {
  const searchParams = useSearchParams();
  const organParam = searchParams.get("organ");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>(organParam ? "notebook_import" : "all");
  const [organFilter, setOrganFilter] = useState<string>(organParam || "all");

  // Chapter management state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  // Collect unique organs from imported chapters
  const importedOrgans = [...new Set(
    chapters
      .filter((ch) => ch.bookSource === "notebook_import" && ch.organ)
      .map((ch) => ch.organ!)
  )].sort();

  const [error, setError] = useState<string | null>(null);

  const loadChapters = useCallback(() => {
    const url = filter === "all" ? "/api/chapters" : `/api/chapters?book=${filter}`;
    setLoading(true);
    setError(null);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load chapters (${r.status})`);
        return r.json();
      })
      .then(setChapters)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load chapters"))
      .finally(() => setLoading(false));
  }, [filter]);

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

  // If organParam is set, auto-select notebook_import filter
  useEffect(() => {
    if (organParam) {
      setFilter("notebook_import");
      setOrganFilter(organParam);
    }
  }, [organParam]);

  const books = [
    { key: "all", label: "All Books" },
    { key: "core_radiology", label: "Core Radiology" },
    { key: "crack_the_core", label: "Crack the Core" },
    { key: "notebook_import", label: "Imported Notes" },
  ];

  // Apply organ filter for imported notes
  const filteredChapters = chapters.filter((ch) => {
    if (filter === "notebook_import" && organFilter !== "all") {
      return ch.organ === organFilter;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Chapters</h1>
        <p className="text-muted-foreground mt-1">
          Browse study material by chapter
        </p>
      </div>

      {/* Book Filter */}
      <div className="flex gap-2 flex-wrap">
        {books.map((b) => (
          <Button
            key={b.key}
            variant={filter === b.key ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFilter(b.key);
              setOrganFilter("all");
            }}
          >
            {b.label}
          </Button>
        ))}
      </div>

      {/* Organ sub-filter for imported notes */}
      {filter === "notebook_import" && importedOrgans.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={organFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setOrganFilter("all")}
            className="text-xs"
          >
            All Organs
          </Button>
          {importedOrgans.map((o) => (
            <Button
              key={o}
              variant={organFilter === o ? "default" : "outline"}
              size="sm"
              onClick={() => setOrganFilter(o)}
              className="text-xs"
            >
              {ORGAN_LABELS[o] || o}
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
              Retry
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
            <h3 className="text-lg font-medium mb-2">No chapters yet</h3>
            <p className="text-muted-foreground">
              {filter === "notebook_import"
                ? "Import a NotebookLM summary to create study guides."
                : "Run the ingestion pipeline to extract content from your PDFs."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredChapters.map((ch) => (
            <Card key={ch.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-5">
                {/* Delete confirmation */}
                {deletingId === ch.id ? (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-destructive font-medium">
                      Delete &quot;{ch.title}&quot; and all its questions, flashcards, and notes?
                    </p>
                    <div className="flex gap-2 ml-4">
                      <Button size="sm" variant="destructive" onClick={() => deleteChapter(ch.id)} className="text-xs gap-1">
                        <Trash2 className="h-3.5 w-3.5" />Delete
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeletingId(null)} className="text-xs">
                        Cancel
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
                        {ch.organ && (
                          <Badge variant="outline" className="text-xs">
                            {ORGAN_LABELS[ch.organ] || ch.organ}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          Chapter {ch.number}
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
                      {/* Chapter actions menu */}
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
                                Rename
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
                                Delete
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
          ))}
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
            <h1 className="text-3xl font-bold">Chapters</h1>
            <p className="text-muted-foreground mt-1">Loading...</p>
          </div>
        </div>
      }
    >
      <ChaptersContent />
    </Suspense>
  );
}
