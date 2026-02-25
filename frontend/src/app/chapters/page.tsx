"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain, Layers } from "lucide-react";
import { useEffect, useState, Suspense } from "react";

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

  // Collect unique organs from imported chapters
  const importedOrgans = [...new Set(
    chapters
      .filter((ch) => ch.bookSource === "notebook_import" && ch.organ)
      .map((ch) => ch.organ!)
  )].sort();

  useEffect(() => {
    const url = filter === "all" ? "/api/chapters" : `/api/chapters?book=${filter}`;
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then(setChapters)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter]);

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

      {/* Chapter List */}
      {loading ? (
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
            <Link key={ch.id} href={`/chapters/${ch.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
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
                      <h3 className="text-lg font-semibold">{ch.title}</h3>
                      {ch.summary && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {ch.summary.substring(0, 150)}...
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground ml-4">
                      <span className="flex items-center gap-1">
                        <Brain className="h-4 w-4" />
                        {ch._count.questions}
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="h-4 w-4" />
                        {ch._count.flashcards}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
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
