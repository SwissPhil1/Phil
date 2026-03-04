"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ScanEye,
  Upload,
  Loader2,
  CheckCircle,
  Trash2,
  RefreshCw,
  ImageIcon,
  Layers,
  X,
} from "lucide-react";
import {
  getAllSystems,
  getOrganLabel,
} from "@/lib/taxonomy";

// ── Types ────────────────────────────────────────────────────────────────────

interface GeneratedCard {
  front: string;
  back: string;
  findings: string[];
  imageDataUri: string;
  fileName: string;
  included: boolean;
}

interface GalleryCard {
  id: number;
  front: string;
  back: string;
  category: string | null;
  imageUrl: string | null;
  chapter: { title: string; organ: string | null };
}

type PageTab = "upload" | "gallery";
type UploadPhase = "config" | "analyzing" | "review" | "saving" | "done";

const MODALITIES = [
  { key: "xr", label: "RX" },
  { key: "ct", label: "CT" },
  { key: "mri", label: "IRM" },
  { key: "us", label: "US" },
] as const;

// ── Main component ──────────────────────────────────────────────────────────

export default function ImageCasesPage() {
  const [tab, setTab] = useState<PageTab>("upload");

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScanEye className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold">Image Cases</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={tab === "upload" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("upload")}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          Uploader
        </Button>
        <Button
          variant={tab === "gallery" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("gallery")}
          className="gap-2"
        >
          <ImageIcon className="h-4 w-4" />
          Galerie
        </Button>
      </div>

      {tab === "upload" ? <UploadTab /> : <GalleryTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD TAB
// ═══════════════════════════════════════════════════════════════════════════════

function UploadTab() {
  const systems = useMemo(() => getAllSystems(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Config state
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [modality, setModality] = useState<string>("xr");
  const [context, setContext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  // Flow state
  const [phase, setPhase] = useState<UploadPhase>("config");
  const [cards, setCards] = useState<GeneratedCard[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [savedChapterId, setSavedChapterId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── File handling ──────────────────────────────────────────────────────

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const valid = Array.from(newFiles).filter(
      (f) => f.type.startsWith("image/") && f.size <= 5 * 1024 * 1024
    );
    setFiles((prev) => [...prev, ...valid]);

    // Generate previews
    for (const f of valid) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(f);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // ── Analyze ────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!selectedOrgan || files.length === 0) return;
    setPhase("analyzing");
    setError(null);
    setCards([]);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("images", file);
      }
      formData.append("organ", selectedOrgan);
      formData.append("modality", modality);
      formData.append("language", "fr");
      if (context.trim()) formData.append("context", context.trim());

      const res = await fetch("/api/analyze-image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Error ${res.status}`);
      }

      const data = await res.json();
      const allCards: GeneratedCard[] = [];

      for (const result of data.results) {
        for (const card of result.cards) {
          allCards.push({
            front: card.front,
            back: card.back,
            findings: card.findings || [],
            imageDataUri: result.imageDataUri,
            fileName: result.fileName,
            included: true,
          });
        }
      }

      setCards(allCards);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("config");
    }
  }, [selectedOrgan, files, modality, context]);

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const toSave = cards.filter((c) => c.included);
    if (toSave.length === 0) return;

    setPhase("saving");
    setError(null);

    try {
      const res = await fetch("/api/save-image-flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organ: selectedOrgan,
          modality,
          cards: toSave.map((c) => ({
            front: c.front,
            back: c.back,
            imageDataUri: c.imageDataUri,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Error ${res.status}`);
      }

      const data = await res.json();
      setSavedCount(data.count);
      setSavedChapterId(data.chapterId);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setPhase("review");
    }
  }, [cards, selectedOrgan, modality]);

  // ── Reset ──────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setPhase("config");
    setFiles([]);
    setPreviews([]);
    setCards([]);
    setError(null);
    setSavedCount(0);
    setSavedChapterId(null);
  }, []);

  // ── Update card text ──────────────────────────────────────────────────

  const updateCard = useCallback(
    (index: number, field: "front" | "back", value: string) => {
      setCards((prev) =>
        prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
      );
    },
    []
  );

  const toggleCard = useCallback((index: number) => {
    setCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, included: !c.included } : c))
    );
  }, []);

  const canAnalyze = selectedOrgan && files.length > 0;

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER: DONE
  // ═══════════════════════════════════════════════════════════════════════

  if (phase === "done") {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
          <h2 className="text-2xl font-bold">
            {savedCount} flashcard{savedCount !== 1 ? "s" : ""} créée
            {savedCount !== 1 ? "s" : ""} !
          </h2>
          <p className="text-muted-foreground">
            Les cartes sont maintenant dans votre file de révision avec
            répétition espacée.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Link href={`/flashcards?organ=${selectedOrgan}`}>
              <Button className="gap-2">
                <Layers className="h-4 w-4" />
                Réviser
              </Button>
            </Link>
            <Button variant="outline" onClick={handleReset} className="gap-2">
              <Upload className="h-4 w-4" />
              Uploader plus
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER: REVIEW
  // ═══════════════════════════════════════════════════════════════════════

  if (phase === "review" || phase === "saving") {
    const includedCount = cards.filter((c) => c.included).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            Vérifier & modifier ({includedCount} carte
            {includedCount !== 1 ? "s" : ""})
          </h2>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPhase("config")}>
              Retour
            </Button>
            <Button
              onClick={handleSave}
              disabled={phase === "saving" || includedCount === 0}
              className="gap-2"
            >
              {phase === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Sauvegarder {includedCount} carte{includedCount !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {cards.map((card, i) => (
          <Card
            key={i}
            className={card.included ? "" : "opacity-50"}
          >
            <CardContent className="p-4">
              <div className="flex gap-4">
                {/* Image thumbnail */}
                {card.imageDataUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageDataUri}
                    alt={card.fileName}
                    className="w-32 h-32 object-cover rounded-lg border flex-shrink-0"
                  />
                )}
                {/* Editable fields */}
                <div className="flex-1 space-y-3 min-w-0">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Question (front)
                    </label>
                    <textarea
                      className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[60px]"
                      value={card.front}
                      onChange={(e) => updateCard(i, "front", e.target.value)}
                      disabled={!card.included}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Réponse (back)
                    </label>
                    <textarea
                      className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[100px]"
                      value={card.back}
                      onChange={(e) => updateCard(i, "back", e.target.value)}
                      disabled={!card.included}
                    />
                  </div>
                  {card.findings.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {card.findings.map((f, j) => (
                        <Badge key={j} variant="secondary" className="text-xs">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {/* Toggle include */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleCard(i)}
                  className="flex-shrink-0"
                  title={card.included ? "Exclure" : "Inclure"}
                >
                  {card.included ? (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  ) : (
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Bottom save button */}
        {cards.length > 3 && (
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={phase === "saving" || includedCount === 0}
              className="gap-2"
            >
              {phase === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Sauvegarder {includedCount} carte{includedCount !== 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER: CONFIG (upload form)
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* Organ selector */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">Organe / Région</div>
          <div className="flex flex-wrap gap-2">
            {systems.map((sys) => (
              <Button
                key={sys.key}
                size="sm"
                variant={selectedSystem === sys.key ? "default" : "outline"}
                onClick={() => {
                  setSelectedSystem(sys.key);
                  setSelectedOrgan(null);
                }}
              >
                {sys.label}
              </Button>
            ))}
          </div>
          {selectedSystem && (
            <div className="flex flex-wrap gap-2 pl-2 border-l-2 border-primary/20">
              {systems
                .find((s) => s.key === selectedSystem)
                ?.organs.map((o) => (
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
        </CardContent>
      </Card>

      {/* Modality selector */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">Modalité</div>
          <div className="flex gap-2">
            {MODALITIES.map((m) => (
              <Button
                key={m.key}
                size="sm"
                variant={modality === m.key ? "default" : "outline"}
                onClick={() => setModality(m.key)}
                className="min-w-[60px]"
              >
                {m.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Clinical context */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium">
            Contexte clinique{" "}
            <span className="text-muted-foreground font-normal">(optionnel)</span>
          </div>
          <input
            type="text"
            className="w-full p-2 text-sm border rounded-md bg-background"
            placeholder="Ex: Patient de 70 ans, fumeur, toux persistante..."
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
        </CardContent>
      </Card>

      {/* Image drop zone */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">Images</div>
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Glissez-déposez des images ici ou cliquez pour parcourir
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              JPEG, PNG, WebP — max 5MB par image
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          {/* Thumbnails */}
          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={files[i]?.name || `Image ${i + 1}`}
                    className="w-20 h-20 object-cover rounded-lg border"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Analyze button */}
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={handleAnalyze}
        disabled={!canAnalyze || phase === "analyzing"}
      >
        {phase === "analyzing" ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Analyse en cours...
          </>
        ) : (
          <>
            <ScanEye className="h-5 w-5" />
            Analyser {files.length} image{files.length !== 1 ? "s" : ""}
          </>
        )}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// GALLERY TAB
// ═══════════════════════════════════════════════════════════════════════════════

function GalleryTab() {
  const systems = useMemo(() => getAllSystems(), []);
  const [cards, setCards] = useState<GalleryCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filterOrgan, setFilterOrgan] = useState<string>("");
  const [filterModality, setFilterModality] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [saving, setSaving] = useState(false);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    let url = "/api/flashcards?mode=all&limit=500&hasImage=true";
    if (filterOrgan) url += `&organ=${filterOrgan}`;
    if (filterModality) url += `&category=imaging:${filterModality}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      setCards(data);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterOrgan, filterModality]);

  // Load on first render and when filters change
  const handleFilter = useCallback(
    (organ: string, mod: string) => {
      setFilterOrgan(organ);
      setFilterModality(mod);
    },
    []
  );

  // Start editing
  const startEdit = useCallback((card: GalleryCard) => {
    setEditingId(card.id);
    setEditFront(card.front);
    setEditBack(card.back);
  }, []);

  // Save edit
  const saveEdit = useCallback(async (id: number) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/flashcards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: editFront, back: editBack }),
      });
      if (res.ok) {
        setCards((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, front: editFront, back: editBack } : c
          )
        );
        setEditingId(null);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [editFront, editBack]);

  // Delete card
  const deleteCard = useCallback(async (id: number) => {
    if (!confirm("Supprimer cette flashcard ?")) return;
    try {
      const res = await fetch(`/api/flashcards/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCards((prev) => prev.filter((c) => c.id !== id));
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium mr-2">Filtres :</span>
            <select
              className="text-sm border rounded-md p-1.5 bg-background"
              value={filterOrgan}
              onChange={(e) => setFilterOrgan(e.target.value)}
            >
              <option value="">Tous les organes</option>
              {systems.flatMap((sys) =>
                sys.organs.map((o) => (
                  <option key={o.key} value={o.key}>
                    {sys.label} → {o.label}
                  </option>
                ))
              )}
            </select>
            <select
              className="text-sm border rounded-md p-1.5 bg-background"
              value={filterModality}
              onChange={(e) => setFilterModality(e.target.value)}
            >
              <option value="">Toutes modalités</option>
              {MODALITIES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={loadGallery} className="gap-1">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
              {loaded ? "Actualiser" : "Charger"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        </div>
      )}

      {loaded && !loading && cards.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Aucune image flashcard trouvée.</p>
          <p className="text-sm mt-1">Uploadez des images dans l&apos;onglet &quot;Uploader&quot; pour commencer.</p>
        </div>
      )}

      {/* Gallery grid */}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => {
            const isExpanded = expandedId === card.id;
            const isEditing = editingId === card.id;
            const organ = card.chapter?.organ;
            const modalityMatch = card.category?.match(/^imaging:(\w+)$/);
            const mod = modalityMatch?.[1];

            return (
              <Card
                key={card.id}
                className={`cursor-pointer transition-all ${isExpanded ? "col-span-1 md:col-span-2 lg:col-span-3" : ""}`}
                onClick={() => {
                  if (!isEditing) setExpandedId(isExpanded ? null : card.id);
                }}
              >
                <CardContent className="p-3">
                  {/* Image */}
                  {card.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.imageUrl}
                      alt="Radiological image"
                      className={`w-full object-contain rounded-lg border mb-2 ${isExpanded ? "max-h-96" : "max-h-40"}`}
                    />
                  )}

                  {/* Badges */}
                  <div className="flex gap-1 mb-2">
                    {organ && (
                      <Badge variant="secondary" className="text-xs">
                        {getOrganLabel(organ)}
                      </Badge>
                    )}
                    {mod && (
                      <Badge variant="outline" className="text-xs">
                        {MODALITIES.find((m) => m.key === mod)?.label || mod}
                      </Badge>
                    )}
                  </div>

                  {/* Content */}
                  {isEditing ? (
                    <div
                      className="space-y-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <textarea
                        className="w-full p-2 text-sm border rounded-md bg-background resize-y min-h-[50px]"
                        value={editFront}
                        onChange={(e) => setEditFront(e.target.value)}
                      />
                      <textarea
                        className="w-full p-2 text-sm border rounded-md bg-background resize-y min-h-[80px]"
                        value={editBack}
                        onChange={(e) => setEditBack(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveEdit(card.id)}
                          disabled={saving}
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sauver"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className={`text-sm font-medium ${isExpanded ? "" : "line-clamp-2"}`}>
                        {card.front}
                      </p>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {card.back}
                          </p>
                          <div
                            className="flex gap-2 pt-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEdit(card)}
                            >
                              Modifier
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => deleteCard(card.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
