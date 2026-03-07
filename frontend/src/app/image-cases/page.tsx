"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
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
  ImageIcon,
  Layers,
  X,
  Plus,
  Brain,
} from "lucide-react";
import {
  getAllSystems,
  getOrganLabel,
} from "@/lib/taxonomy";

// ── Types ────────────────────────────────────────────────────────────────────

interface GalleryCard {
  id: number;
  front: string;
  back: string;
  category: string | null;
  imageUrl: string | null;
  chapter: { title: string; organ: string | null };
}

type PageTab = "upload" | "gallery";

const IMAGE_TYPES = [
  { key: "xr", label: "RX" },
  { key: "ct", label: "CT" },
  { key: "mri", label: "IRM" },
  { key: "us", label: "US" },
  { key: "diagram", label: "Schéma" },
  { key: "table", label: "Tableau" },
  { key: "photo", label: "Photo" },
  { key: "other", label: "Autre" },
] as const;

// ── Main component ──────────────────────────────────────────────────────────

export default function ImageCasesPage() {
  const [tab, setTab] = useState<PageTab>("upload");
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  const generateQuiz = async () => {
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await fetch("/api/generate-image-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setGenResult(data.message);
    } catch (err) {
      setGenResult(err instanceof Error ? err.message : "Erreur de génération");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ScanEye className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold">Image Cases</h1>
        </div>
        <Button
          onClick={generateQuiz}
          disabled={generating}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          {generating ? "Génération..." : "Générer Quiz Images"}
        </Button>
      </div>

      {/* Quiz generation feedback */}
      {genResult && (
        <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted">
          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          <span>{genResult}</span>
          <button onClick={() => setGenResult(null)} className="ml-auto">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={tab === "upload" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("upload")}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Ajouter
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
// UPLOAD TAB — Direct: drop image, type Q&A, save
// ═══════════════════════════════════════════════════════════════════════════════

function UploadTab() {
  const systems = useMemo(() => getAllSystems(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backFileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [imageType, setImageType] = useState<string>("ct");
  const [preview, setPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTotal, setSavedTotal] = useState(0);

  // ── File handling ──────────────────────────────────────────────────────

  const handleFile = useCallback((file: File, target: "front" | "back" = "front") => {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target?.result as string;
      if (target === "back") setBackPreview(dataUri);
      else setPreview(dataUri);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file, "front");
    },
    [handleFile]
  );

  const handleBackDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file, "back");
    },
    [handleFile]
  );

  const clearImage = useCallback(() => {
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const clearBackImage = useCallback(() => {
    setBackPreview(null);
    if (backFileInputRef.current) backFileInputRef.current.value = "";
  }, []);

  // ── Paste from clipboard (Ctrl+V / Cmd+V / long-press paste) ────────────

  const makePasteHandler = useCallback(
    (target: "front" | "back" = "front") =>
      (e: React.ClipboardEvent | ClipboardEvent) => {
        const items = (e as ClipboardEvent).clipboardData?.items ??
          (e as React.ClipboardEvent).clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) handleFile(file, target);
            return;
          }
        }
      },
    [handleFile]
  );

  const handlePaste = useMemo(() => makePasteHandler("front"), [makePasteHandler]);
  const handleBackPaste = useMemo(() => makePasteHandler("back"), [makePasteHandler]);

  // Global listener for desktop (Ctrl+V / Cmd+V when no input focused)
  useEffect(() => {
    const listener = (e: ClipboardEvent) => handlePaste(e);
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, [handlePaste]);

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedOrgan || !front.trim()) return;
    if (!preview && !backPreview) return; // need at least one image
    // Back text is optional if there's a back image
    if (!back.trim() && !backPreview) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/save-image-flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organ: selectedOrgan,
          modality: imageType,
          cards: [{
            front: front.trim(),
            back: back.trim() || "(voir image)",
            imageDataUri: preview || undefined,
            backImageDataUri: backPreview || undefined,
          }],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Error ${res.status}`);
      }

      // Success — clear form for next card, keep organ/imageType
      setSavedTotal((n) => n + 1);
      setSaved(true);
      setPreview(null);
      setBackPreview(null);
      setFront("");
      setBack("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (backFileInputRef.current) backFileInputRef.current.value = "";

      // Auto-dismiss success after 2s
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  }, [selectedOrgan, preview, backPreview, front, back, imageType]);

  // Back text optional if back image provided
  const canSave = selectedOrgan && (preview || backPreview) && front.trim() && (back.trim() || backPreview) && !saving;

  return (
    <div className="space-y-4">
      {/* Saved counter */}
      {savedTotal > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle className="h-4 w-4" />
          {savedTotal} carte{savedTotal !== 1 ? "s" : ""} ajoutée{savedTotal !== 1 ? "s" : ""} cette session
          <Link href={`/flashcards${selectedOrgan ? `?organ=${selectedOrgan}` : ""}`} className="ml-auto text-xs underline">
            Réviser
          </Link>
        </div>
      )}

      {/* Success flash */}
      {saved && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          Sauvegardée ! Ajoutez la prochaine image.
        </div>
      )}

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

      {/* Image type selector */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">Type d&apos;image</div>
          <div className="flex flex-wrap gap-2">
            {IMAGE_TYPES.map((m) => (
              <Button
                key={m.key}
                size="sm"
                variant={imageType === m.key ? "default" : "outline"}
                onClick={() => setImageType(m.key)}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Image + Q&A form */}
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Front image (question side) */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Image question (front)</label>
            {preview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Image question"
                  className="w-full max-h-48 object-contain rounded-lg border"
                />
                <button
                  onClick={clearImage}
                  className="absolute top-2 right-2 bg-muted text-muted-foreground rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div
                contentEditable
                suppressContentEditableWarning
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors outline-none caret-transparent"
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onPaste={handlePaste}
                onClick={() => fileInputRef.current?.click()}
                onInput={(e) => { (e.target as HTMLElement).textContent = ""; }}
              >
                <Upload className="h-6 w-6 mx-auto mb-1 text-muted-foreground pointer-events-none" />
                <p className="text-xs text-muted-foreground pointer-events-none">
                  Collez, glissez, ou cliquez
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file, "front");
              }}
            />
          </div>

          {/* Front text */}
          <div>
            <label className="text-sm font-medium">Question (front)</label>
            <textarea
              className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[60px]"
              placeholder="Ex: Quels sont les signes sur ce scanner abdominal ?"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              onPaste={handlePaste}
            />
          </div>

          <div className="border-t pt-4">
            {/* Back image (answer side) — optional */}
            <label className="text-sm font-medium mb-1.5 block">Image réponse (back) — optionnelle</label>
            {backPreview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={backPreview}
                  alt="Image réponse"
                  className="w-full max-h-48 object-contain rounded-lg border"
                />
                <button
                  onClick={clearBackImage}
                  className="absolute top-2 right-2 bg-muted text-muted-foreground rounded-full p-1 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div
                contentEditable
                suppressContentEditableWarning
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors outline-none caret-transparent"
                onDrop={handleBackDrop}
                onDragOver={(e) => e.preventDefault()}
                onPaste={handleBackPaste}
                onClick={() => backFileInputRef.current?.click()}
                onInput={(e) => { (e.target as HTMLElement).textContent = ""; }}
              >
                <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground pointer-events-none" />
                <p className="text-xs text-muted-foreground pointer-events-none">
                  Ajoutez un schéma, diagramme, tableau...
                </p>
              </div>
            )}
            <input
              ref={backFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file, "back");
              }}
            />
          </div>

          {/* Back text */}
          <div>
            <label className="text-sm font-medium">Réponse (back)</label>
            <textarea
              className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[100px]"
              placeholder="Ex: Masse hépatique hypervascularisée au temps artériel avec wash-out au temps portal — HCC typique."
              value={back}
              onChange={(e) => setBack(e.target.value)}
              onPaste={handleBackPaste}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Validation hint */}
      {!canSave && (preview || backPreview || front || back) && (
        <p className="text-xs text-muted-foreground text-center">
          {!selectedOrgan
            ? "Sélectionnez un organe/section ci-dessus"
            : !preview && !backPreview
            ? "Ajoutez au moins une image (front ou back)"
            : !front.trim()
            ? "Ajoutez une question"
            : !back.trim() && !backPreview
            ? "Ajoutez une réponse (texte ou image)"
            : ""}
        </p>
      )}

      {/* Save button */}
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={handleSave}
        disabled={!canSave}
      >
        {saving ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <CheckCircle className="h-5 w-5" />
        )}
        Sauvegarder
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
                    {sys.label} &rarr; {o.label}
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
              {IMAGE_TYPES.map((m) => (
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
          <p className="text-sm mt-1">Ajoutez des images dans l&apos;onglet &quot;Ajouter&quot; pour commencer.</p>
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
                        {IMAGE_TYPES.find((m) => m.key === mod)?.label || mod}
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
