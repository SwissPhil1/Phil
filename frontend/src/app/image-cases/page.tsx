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

  // Form state
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [modality, setModality] = useState<string>("ct");
  const [preview, setPreview] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTotal, setSavedTotal] = useState(0);

  // ── File handling ──────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const clearImage = useCallback(() => {
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Paste from clipboard (Ctrl+V / Cmd+V) ─────────────────────────────

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleFile(file);
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedOrgan || !preview || !front.trim() || !back.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/save-image-flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organ: selectedOrgan,
          modality,
          cards: [{ front: front.trim(), back: back.trim(), imageDataUri: preview }],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Error ${res.status}`);
      }

      // Success — clear form for next card, keep organ/modality
      setSavedTotal((n) => n + 1);
      setSaved(true);
      setPreview(null);
      setFront("");
      setBack("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Auto-dismiss success after 2s
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  }, [selectedOrgan, preview, front, back, modality]);

  const canSave = selectedOrgan && preview && front.trim() && back.trim() && !saving;

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

      {/* Image + Q&A form */}
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Drop zone / preview */}
          {preview ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Image uploadée"
                className="w-full max-h-64 object-contain rounded-lg border"
              />
              <button
                onClick={clearImage}
                className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:opacity-80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Collez (Ctrl+V), glissez, ou cliquez pour parcourir
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                JPEG, PNG, WebP — max 5MB
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
              if (file) handleFile(file);
            }}
          />

          {/* Front / Back text */}
          <div>
            <label className="text-sm font-medium">Question (front)</label>
            <textarea
              className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[60px]"
              placeholder="Ex: Quels sont les signes sur ce scanner abdominal ?"
              value={front}
              onChange={(e) => setFront(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Réponse (back)</label>
            <textarea
              className="w-full mt-1 p-2 text-sm border rounded-md bg-background resize-y min-h-[100px]"
              placeholder="Ex: Masse hépatique hypervascularisée au temps artériel avec wash-out au temps portal — HCC typique."
              value={back}
              onChange={(e) => setBack(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
          {error}
        </div>
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
