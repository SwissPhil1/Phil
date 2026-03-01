"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Brain,
  Layers,
  Star,
  Lightbulb,
  ArrowLeft,
  GraduationCap,
  Merge,
  Loader2,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Library,
  Info,
  Pencil,
  Save,
  ImagePlus,
  StickyNote,
  Plus,
  Trash2,
  X,
  ExternalLink,
  Printer,
  FilePlus,
  Wand2,
} from "lucide-react";
import React, { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

interface RelatedChapter {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  pdfChunkCount: number;
  estimatedPages: number;
}

interface ChapterNote {
  id: number;
  content: string;
  imageUrl: string | null;
  color: string;
  createdAt: string;
}

interface ChapterDetail {
  id: number;
  bookSource: string;
  number: number;
  title: string;
  summary: string | null;
  keyPoints: string | null;
  highYield: string | null;
  mnemonics: string | null;
  studyGuide: string | null;
  pdfChunkCount: number;
  estimatedPages: number;
  relatedChapters: RelatedChapter[];
  questions: Array<{
    id: number;
    questionText: string;
    difficulty: string;
    category: string | null;
  }>;
  flashcards: Array<{
    id: number;
    front: string;
    category: string | null;
  }>;
}

type GenerateStatus =
  | null
  | { phase: "uploading"; message: string }
  | { phase: "processing"; chunk: number; total: number }
  | { phase: "generating-guide"; message: string }
  | { phase: "done"; questionsCreated: number; flashcardsCreated: number }
  | { phase: "error"; message: string };

// ── Helper to extract text content from React children ──────────────
function extractTextContent(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (React.isValidElement(node)) {
    return extractTextContent((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

// ── Custom ReactMarkdown components for colored callouts & rich styling ──
const studyGuideComponents: Components = {
  blockquote: ({ children, ...props }) => {
    const text = extractTextContent(children);
    let classes = "border-l-4 rounded-r-lg py-3 px-4 my-4 ";

    if (text.includes("💡") || text.includes("PEARL")) {
      classes += "border-amber-400 bg-amber-50/80 dark:bg-amber-950/30 [&>p]:text-amber-900 dark:[&>p]:text-amber-200";
    } else if (text.includes("🔴") || text.includes("PITFALL") || text.includes("DANGER") || text.includes("TRAP")) {
      classes += "border-red-400 bg-red-50/80 dark:bg-red-950/30 [&>p]:text-red-900 dark:[&>p]:text-red-200";
    } else if (text.includes("⚡") || text.includes("HIGH YIELD")) {
      classes += "border-orange-400 bg-orange-50/80 dark:bg-orange-950/30 [&>p]:text-orange-900 dark:[&>p]:text-orange-200";
    } else if (text.includes("🧠") || text.includes("MNEMONIC")) {
      classes += "border-purple-400 bg-purple-50/80 dark:bg-purple-950/30 [&>p]:text-purple-900 dark:[&>p]:text-purple-200";
    } else if (text.includes("🎯") || text.includes("STOP & THINK") || text.includes("STOP &amp; THINK")) {
      classes += "border-blue-400 bg-blue-50/80 dark:bg-blue-950/30 [&>p]:text-blue-900 dark:[&>p]:text-blue-200";
    } else if (text.includes("✅") || text.includes("KEY POINT")) {
      classes += "border-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/30 [&>p]:text-emerald-900 dark:[&>p]:text-emerald-200";
    } else if (text.includes("⚖️") || text.includes("VS:")) {
      classes += "border-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/30 [&>p]:text-indigo-900 dark:[&>p]:text-indigo-200";
    } else {
      classes += "border-primary/40 bg-primary/5 [&>p]:text-primary/80";
    }

    return <blockquote className={classes} {...props}>{children}</blockquote>;
  },

  // Render images with proper styling
  img: ({ src, alt, ...props }) => (
    <span className="block my-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ""}
        className="rounded-lg border shadow-sm max-w-full mx-auto"
        style={{ maxHeight: "500px", objectFit: "contain" }}
        {...props}
      />
      {alt && <span className="block text-center text-xs text-muted-foreground mt-2 italic">{alt}</span>}
    </span>
  ),

  // Render links with Radiopaedia icon
  a: ({ href, children, ...props }) => {
    const isRadiopaedia = href?.includes("radiopaedia.org");
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 underline ${isRadiopaedia ? "text-blue-600 dark:text-blue-400 font-medium" : ""}`}
        {...props}
      >
        {children}
        {isRadiopaedia && <ExternalLink className="h-3 w-3 inline" />}
      </a>
    );
  },

  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-6 rounded-lg border border-border shadow-sm">
      <table className="min-w-full text-sm" {...props}>{children}</table>
    </div>
  ),

  thead: ({ children, ...props }) => (
    <thead className="bg-muted/60 dark:bg-muted/20" {...props}>{children}</thead>
  ),

  th: ({ children, ...props }) => (
    <th className="px-3 py-2.5 text-left font-semibold text-foreground border-b border-border text-xs uppercase tracking-wider" {...props}>{children}</th>
  ),

  td: ({ children, ...props }) => (
    <td className="px-3 py-2 text-foreground/80 border-b border-border/50" {...props}>{children}</td>
  ),

  h2: ({ children, ...props }) => (
    <h2 className="text-2xl font-bold mt-12 mb-4 pb-3 border-b-2 border-primary/20 text-foreground flex items-center gap-2" {...props}>{children}</h2>
  ),

  h3: ({ children, ...props }) => (
    <h3 className="text-xl font-semibold mt-8 mb-3 text-foreground/95" {...props}>{children}</h3>
  ),

  hr: (props) => (
    <hr className="my-8 border-t-2 border-dashed border-muted-foreground/20" {...props} />
  ),

  input: ({ ...props }) => (
    <input
      className="mr-2 h-4 w-4 rounded border-2 border-primary/40 accent-primary"
      {...props}
    />
  ),
};

// ── Notes Panel Component ───────────────────────────────────────────
function NotesPanel({ chapterId }: { chapterId: number }) {
  const [notes, setNotes] = useState<ChapterNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [newColor, setNewColor] = useState("yellow");
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadNotes = useCallback(() => {
    fetch(`/api/notes?chapterId=${chapterId}`)
      .then((r) => r.json())
      .then(setNotes)
      .catch(console.error);
  }, [chapterId]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const colorClasses: Record<string, string> = {
    yellow: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    blue: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    green: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
    pink: "bg-pink-50 border-pink-200 dark:bg-pink-950/30 dark:border-pink-800",
  };

  const addNote = async (imageUrl?: string) => {
    if (!newNote.trim() && !imageUrl) return;
    setAdding(true);
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          chapterId,
          content: newNote || (imageUrl ? "Image note" : ""),
          imageUrl,
          color: newColor,
        }),
      });
      setNewNote("");
      loadNotes();
    } catch (e) { console.error(e); }
    setAdding(false);
  };

  const deleteNote = async (id: number) => {
    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    loadNotes();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("chapterId", String(chapterId));
      formData.append("target", "note");

      const res = await fetch("/api/upload-image", { method: "POST", body: formData });
      const data = await res.json();
      if (data.imageUrl) {
        await addNote(data.imageUrl);
      }
    } catch (e) { console.error(e); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <StickyNote className="h-4 w-4" />
          Personal Notes
        </h3>
        <span className="text-xs text-muted-foreground">{notes.length} note{notes.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Add note form */}
      <div className="space-y-2">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a personal note, observation, or reminder..."
          rows={3}
          className="w-full p-2.5 border rounded-lg text-sm bg-background resize-y"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {Object.keys(colorClasses).map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  newColor === c ? "scale-125 ring-2 ring-offset-1 ring-primary" : ""
                } ${colorClasses[c]}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5 text-xs"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
              Image
            </Button>
            <Button
              size="sm"
              onClick={() => addNote()}
              disabled={!newNote.trim() || adding}
              className="gap-1.5 text-xs"
            >
              {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          </div>
        </div>
      </div>

      {/* Notes list */}
      <div className="space-y-2">
        {notes.map((note) => (
          <div key={note.id} className={`rounded-lg border p-3 ${colorClasses[note.color] || colorClasses.yellow}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                {note.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={note.imageUrl}
                    alt="Note attachment"
                    className="mt-2 rounded border max-h-48 object-contain"
                  />
                )}
              </div>
              <button
                onClick={() => deleteNote(note.id)}
                className="text-muted-foreground hover:text-destructive p-1 rounded"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {new Date(note.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChapterDetailPage() {
  const params = useParams();
  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("guide");
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const autoGenerateTriggered = useRef(false);

  // Editor state
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const editorFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingScrollY = useRef<number | null>(null);

  // Flashcard generation state (for chapters with study guide but no flashcards)
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
  const [flashcardGenMessage, setFlashcardGenMessage] = useState("");

  // Question generation state (for chapters with study guide but no questions)
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [questionGenMessage, setQuestionGenMessage] = useState("");

  // Append section state
  const [showAppendPanel, setShowAppendPanel] = useState(false);
  const [appendContent, setAppendContent] = useState("");
  const [appendPosition, setAppendPosition] = useState<string>("end");
  const [appending, setAppending] = useState(false);
  const [appendMessage, setAppendMessage] = useState("");

  // Restructure state
  const [restructuring, setRestructuring] = useState(false);
  const [restructureMessage, setRestructureMessage] = useState("");

  // Parse study guide sections for the position selector
  const guideSections = React.useMemo(() => {
    if (!chapter?.studyGuide) return [];
    const parts = chapter.studyGuide.split(/\n---\n/);
    return parts.map((part, idx) => {
      const headingMatch = part.match(/^#{1,3}\s+(.+)$/m);
      const label = headingMatch ? headingMatch[1].trim() : `Section ${idx + 1}`;
      return { index: idx, label: label.length > 55 ? label.slice(0, 52) + "..." : label };
    });
  }, [chapter?.studyGuide]);

  // Restore scroll position after edit mode toggle re-renders the DOM
  useEffect(() => {
    if (pendingScrollY.current !== null) {
      const target = pendingScrollY.current;
      pendingScrollY.current = null;
      requestAnimationFrame(() => {
        // Auto-size the textarea so the page is tall enough to scroll to the saved position
        if (editing && textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
        }
        requestAnimationFrame(() => {
          window.scrollTo(0, target);
        });
      });
    }
  }, [editing]);

  useEffect(() => {
    if (params.id) {
      fetch(`/api/chapters/${params.id}`)
        .then((r) => r.json())
        .then(setChapter)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  const hasContent = chapter && (chapter.questions.length > 0 || chapter.studyGuide || chapter.summary);
  const hasPdfChunks = (chapter?.pdfChunkCount ?? 0) > 0;
  const isImported = chapter?.bookSource === "notebook_import";
  const isGenerating = !!(generateStatus && generateStatus.phase !== "done" && generateStatus.phase !== "error");

  // Generate ALL content from stored blob URLs
  const generateContent = useCallback(async () => {
    if (!chapter) return;
    setGenerateStatus({ phase: "uploading", message: "Starting..." });
    setGuideError(null);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-content", chapterId: chapter.id }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: Record<string, unknown> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine.slice(6));
            if (data.error) { setGenerateStatus({ phase: "error", message: data.error }); return; }
            if (data.success) { finalResult = data; setGenerateStatus({ phase: "done", questionsCreated: data.questionsCreated || 0, flashcardsCreated: data.flashcardsCreated || 0 }); }
            else if (data.status === "uploading") setGenerateStatus({ phase: "uploading", message: data.message || "Uploading..." });
            else if (data.status === "processing") setGenerateStatus({ phase: "processing", chunk: data.chunk || 0, total: data.total || 0 });
            else if (data.status === "generating-guide") setGenerateStatus({ phase: "generating-guide", message: data.message || "Generating..." });
          } catch { /* partial JSON */ }
        }
      }
      if (finalResult) {
        const refreshed = await (await fetch(`/api/chapters/${chapter.id}`)).json();
        setChapter(refreshed);
      }
    } catch (err) {
      setGenerateStatus({ phase: "error", message: err instanceof Error ? err.message : "Generation failed" });
    }
  }, [chapter]);

  // Generate flashcards for chapters that have a study guide but no flashcards
  const generateFlashcardsOnly = useCallback(async () => {
    if (!chapter) return;
    setGeneratingFlashcards(true);
    setFlashcardGenMessage("Generating flashcards from study guide...");

    try {
      const res = await fetch("/api/generate-flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id, language: "fr" }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine.slice(6));
            if (data.error) {
              setFlashcardGenMessage(`Failed: ${data.error}`);
              setGeneratingFlashcards(false);
              return;
            }
            if (data.success) {
              setFlashcardGenMessage(`Created ${data.flashcardsCreated} flashcards!`);
              // Refresh chapter data
              const refreshed = await (await fetch(`/api/chapters/${chapter.id}`)).json();
              setChapter(refreshed);
              setGeneratingFlashcards(false);
              return;
            }
            if (data.message) {
              setFlashcardGenMessage(data.message);
            }
          } catch { /* partial JSON */ }
        }
      }
      setGeneratingFlashcards(false);
    } catch (err) {
      setFlashcardGenMessage(err instanceof Error ? err.message : "Failed");
      setGeneratingFlashcards(false);
    }
  }, [chapter]);

  // Generate QCM questions for chapters that have a study guide but no questions
  const generateQuestionsOnly = useCallback(async () => {
    if (!chapter) return;
    setGeneratingQuestions(true);
    setQuestionGenMessage("Generating questions from study guide...");

    try {
      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id, language: "fr" }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine.slice(6));
            if (data.error) {
              setQuestionGenMessage(`Failed: ${data.error}`);
              setGeneratingQuestions(false);
              return;
            }
            if (data.success) {
              setQuestionGenMessage(`Created ${data.questionsCreated} questions!`);
              // Refresh chapter data
              const refreshed = await (await fetch(`/api/chapters/${chapter.id}`)).json();
              setChapter(refreshed);
              setGeneratingQuestions(false);
              return;
            }
            if (data.message) {
              setQuestionGenMessage(data.message);
            }
          } catch { /* partial JSON */ }
        }
      }
      setGeneratingQuestions(false);
    } catch (err) {
      setQuestionGenMessage(err instanceof Error ? err.message : "Failed");
      setGeneratingQuestions(false);
    }
  }, [chapter]);

  const regenerateStudyGuide = useCallback(async () => {
    if (!chapter) return;
    setGenerateStatus({ phase: "generating-guide", message: "Regenerating study guide..." });
    setGuideError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-study-guide", chapterId: chapter.id }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { const data = JSON.parse(line.slice(6)); if (data.error) { setGuideError(data.error); setGenerateStatus(null); return; } } catch {}
          }
        }
      }
      const refreshed = await (await fetch(`/api/chapters/${chapter.id}`)).json();
      setChapter(refreshed);
      setGenerateStatus(null);
    } catch (err) { setGuideError(err instanceof Error ? err.message : "Generation failed"); setGenerateStatus(null); }
  }, [chapter]);

  const mergeStudyGuide = useCallback(async () => {
    if (!chapter) return;
    setGenerateStatus({ phase: "generating-guide", message: "Merging study guide from both books..." });
    setGuideError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "merge-study-guide", chapterId: chapter.id }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";
      let receivedSuccess = false;
      let lastMessage = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) { setGuideError(data.error); setGenerateStatus(null); return; }
              if (data.success) receivedSuccess = true;
              if (data.status) { lastMessage = data.message || "Merging..."; setGenerateStatus({ phase: "generating-guide", message: lastMessage }); }
            } catch {}
          }
        }
      }
      if (!receivedSuccess) { setGuideError(`Merge ended without completing. Last: "${lastMessage}"`); setGenerateStatus(null); return; }
      const refreshed = await (await fetch(`/api/chapters/${chapter.id}`)).json();
      setChapter(refreshed);
      setGenerateStatus(null);
    } catch (err) { setGuideError(err instanceof Error ? err.message : "Merge failed"); setGenerateStatus(null); }
  }, [chapter]);

  // Append new content to existing study guide
  const appendSection = useCallback(async () => {
    if (!chapter || !appendContent.trim()) return;
    setAppending(true);
    setAppendMessage("Starting...");
    try {
      const res = await fetch(`/api/chapters/${chapter.id}/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: appendContent,
          position: appendPosition === "start" || appendPosition === "end"
            ? appendPosition
            : parseInt(appendPosition, 10),
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";
      let receivedSuccess = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) { setAppendMessage(`Error: ${data.error}`); setAppending(false); return; }
              if (data.success) { receivedSuccess = true; }
              if (data.message) { setAppendMessage(data.message); }
            } catch { /* partial JSON */ }
          }
        }
      }
      if (receivedSuccess) {
        const refreshed = await (await fetch(`/api/chapters/${chapter.id}`)).json();
        setChapter(refreshed);
        setAppendContent("");
        setShowAppendPanel(false);
        setAppendMessage("");
      }
    } catch (err) {
      setAppendMessage(err instanceof Error ? err.message : "Append failed");
    }
    setAppending(false);
  }, [chapter, appendContent, appendPosition]);

  // Restructure study guide → creates a new chapter with improved content
  const restructureStudyGuide = useCallback(async () => {
    if (!chapter || !chapter.studyGuide) return;
    setRestructuring(true);
    setRestructureMessage("Starting restructure...");

    // Abort after 15 minutes to prevent infinite hangs
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);

    try {
      const res = await fetch(`/api/chapters/${chapter.id}/restructure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "fr" }),
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";
      let receivedSuccess = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                setRestructureMessage(`Error: ${data.error}`);
                setRestructuring(false);
                return;
              }
              if (data.success) {
                receivedSuccess = true;
                setRestructureMessage(data.message || "Restructure complete!");
                setRestructuring(false);
                // Navigate to the new chapter after a short delay
                if (data.newChapterId) {
                  setTimeout(() => {
                    window.location.href = `/chapters/${data.newChapterId}`;
                  }, 2000);
                }
                return;
              }
              if (data.message) {
                setRestructureMessage(data.message);
              }
            } catch { /* partial JSON */ }
          }
        }
      }
      if (!receivedSuccess) {
        setRestructureMessage("Connection to server lost. The study guide may be too large — try again or split it into smaller chapters.");
      }
      setRestructuring(false);
    } catch (err) {
      if (controller.signal.aborted) {
        setRestructureMessage("Restructure timed out after 15 minutes. Please try again with a shorter study guide.");
      } else {
        const msg = err instanceof Error ? err.message : "Restructure failed";
        const isNetwork = msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("network");
        setRestructureMessage(isNetwork
          ? "Network error — connection to server lost. Please check your connection and try again."
          : msg
        );
      }
      setRestructuring(false);
    } finally {
      clearTimeout(timeout);
    }
  }, [chapter]);

  // Auto-generate study guide
  useEffect(() => {
    if (chapter && !chapter.studyGuide && !isGenerating && !guideError && !autoGenerateTriggered.current && activeTab === "guide" && (chapter.questions.length > 0 || chapter.summary) && hasPdfChunks) {
      autoGenerateTriggered.current = true;
      regenerateStudyGuide();
    }
  }, [chapter, isGenerating, guideError, activeTab, hasPdfChunks, regenerateStudyGuide]);

  // ── Editor functions ──────────────────────────────────────────────
  const startEditing = () => {
    pendingScrollY.current = window.scrollY;
    setEditContent(chapter?.studyGuide || "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!chapter) return;
    pendingScrollY.current = window.scrollY;
    setSaving(true);
    try {
      await fetch(`/api/chapters/${chapter.id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyGuide: editContent }),
      });
      setChapter({ ...chapter, studyGuide: editContent });
      setEditing(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = editContent.substring(0, start) + text + editContent.substring(end);
    setEditContent(newContent);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
    }, 0);
  };

  const handleEditorImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("chapterId", String(chapter?.id));
      formData.append("target", "studyGuide");
      const res = await fetch("/api/upload-image", { method: "POST", body: formData });
      const data = await res.json();
      if (data.imageUrl) {
        insertAtCursor(`\n\n![Radiological image](${data.imageUrl})\n\n`);
      }
    } catch (e) { console.error(e); }
    setUploadingImage(false);
    if (editorFileInputRef.current) editorFileInputRef.current.value = "";
  };

  // ── Render helpers ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse bg-muted rounded" />
        <div className="h-96 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Chapter not found</h2>
        <Link href="/chapters"><Button variant="outline" className="mt-4">Back to Chapters</Button></Link>
      </div>
    );
  }

  // Extract Key Points, High Yield, and Mnemonics from the study guide markdown
  // These callouts are embedded inline in the study guide — we gather them here for the dedicated tabs
  const extractCallouts = (guide: string | null, prefix: string): string[] => {
    if (!guide) return [];
    const results: string[] = [];
    // Match blockquote lines starting with the prefix pattern
    const regex = new RegExp(`^>\\s*(?:${prefix})\\s*(.+)$`, "gm");
    let match;
    while ((match = regex.exec(guide)) !== null) {
      // Clean up the extracted text
      const text = match[1].replace(/\*\*/g, "").trim();
      if (text) results.push(text);
    }
    return results;
  };

  const extractMnemonics = (guide: string | null): Array<{ name: string; content: string }> => {
    if (!guide) return [];
    const results: Array<{ name: string; content: string }> = [];
    // Split into lines and find mnemonic blocks
    const lines = guide.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^>\s*🧠\s*\*?\*?MNEMONIC/i.test(line)) {
        // Extract the mnemonic name from the first line
        const nameMatch = line.match(/MNEMONIC:?\s*\*?\*?\s*(?:\[([^\]]+)\]|(.+?))\s*\*?\*?\s*$/i);
        const name = (nameMatch?.[1] || nameMatch?.[2] || "Mnemonic").replace(/\*\*/g, "").trim();
        // Collect all continuation lines of this blockquote
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && /^>\s/.test(lines[i])) {
          const cleaned = lines[i].replace(/^>\s*/, "").trim();
          if (cleaned) contentLines.push(cleaned);
          i++;
        }
        results.push({ name, content: contentLines.join("\n") || name });
      } else {
        i++;
      }
    }
    return results;
  };

  let keyPoints = extractCallouts(chapter.studyGuide, "✅\\s*\\*?\\*?KEY POINT:?\\*?\\*?");
  let highYield = extractCallouts(chapter.studyGuide, "⚡\\s*\\*?\\*?HIGH YIELD:?\\*?\\*?");
  let mnemonics = extractMnemonics(chapter.studyGuide);

  // Also fall back to the separate JSON columns if study guide doesn't have enough
  if (keyPoints.length === 0 && chapter.keyPoints) {
    try { keyPoints = JSON.parse(chapter.keyPoints); } catch {}
  }
  if (highYield.length === 0 && chapter.highYield) {
    try { highYield = JSON.parse(chapter.highYield); } catch {}
  }
  if (mnemonics.length === 0 && chapter.mnemonics) {
    try { mnemonics = JSON.parse(chapter.mnemonics); } catch {}
  }

  const tabs = [
    { key: "guide", label: "Study Guide", icon: GraduationCap },
    { key: "notes", label: "Notes", icon: StickyNote },
    { key: "summary", label: "Summary", icon: BookOpen },
    { key: "keypoints", label: `Key Points (${keyPoints.length})`, icon: Star },
    { key: "highyield", label: `High Yield (${highYield.length})`, icon: Lightbulb },
    { key: "mnemonics", label: `Mnemonics (${mnemonics.length})`, icon: Brain },
  ];

  // ─── Empty States ─────────────────────────────────────────────────
  if (!hasContent && hasPdfChunks && !isGenerating) {
    return (
      <div className="space-y-6">
        <div>
          <Link href="/chapters" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"><ArrowLeft className="h-4 w-4" />Back to Chapters</Link>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={chapter.bookSource === "core_radiology" ? "default" : "secondary"}>{chapter.bookSource === "core_radiology" ? "Core Radiology" : "Crack the Core"}</Badge>
            <span className="text-sm text-muted-foreground">Chapter {chapter.number}</span>
          </div>
          <h1 className="text-3xl font-bold">{chapter.title}</h1>
        </div>
        <Card>
          <CardContent className="p-8 md:p-12 text-center space-y-4">
            <Sparkles className="h-14 w-14 mx-auto text-primary/60" />
            <div><h2 className="text-xl font-semibold">Ready to Generate</h2><p className="text-muted-foreground mt-1 max-w-md mx-auto">This chapter&apos;s PDF pages are stored. Generate a complete study guide, questions, and flashcards.</p></div>
            {generateStatus?.phase === "error" && <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 max-w-md mx-auto"><p className="text-sm text-red-600 dark:text-red-400">{generateStatus.message}</p></div>}
            <Button size="lg" onClick={generateContent} className="gap-2"><Sparkles className="h-5 w-5" />Generate All Content</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasContent && !hasPdfChunks && !isImported && !isGenerating) {
    return (
      <div className="space-y-6">
        <div>
          <Link href="/chapters" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"><ArrowLeft className="h-4 w-4" />Back to Chapters</Link>
          <h1 className="text-3xl font-bold">{chapter.title}</h1>
        </div>
        <Card>
          <CardContent className="p-8 md:p-12 text-center space-y-4">
            <Library className="h-14 w-14 mx-auto text-muted-foreground/40" />
            <div><h2 className="text-xl font-semibold">Upload Source First</h2><p className="text-muted-foreground mt-1">Go to Sources to upload this book&apos;s PDF before generating study materials.</p></div>
            <Link href="/ingest"><Button variant="outline" className="gap-2"><Library className="h-4 w-4" />Go to Sources</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isGenerating) {
    const progressPercent = generateStatus.phase === "processing" && generateStatus.total > 0 ? Math.round((generateStatus.chunk / generateStatus.total) * 70) : generateStatus.phase === "generating-guide" ? 85 : generateStatus.phase === "uploading" ? 10 : 0;
    return (
      <div className="space-y-6">
        <div>
          <Link href="/chapters" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"><ArrowLeft className="h-4 w-4" />Back to Chapters</Link>
          <h1 className="text-3xl font-bold">{chapter.title}</h1>
        </div>
        <Card>
          <CardContent className="p-8 md:p-12 text-center space-y-6">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
            <div>
              <h2 className="text-xl font-semibold">Generating Content...</h2>
              <p className="text-muted-foreground mt-2">
                {generateStatus.phase === "uploading" && (generateStatus.message || "Uploading...")}
                {generateStatus.phase === "processing" && `Processing chunk ${generateStatus.chunk}/${generateStatus.total}...`}
                {generateStatus.phase === "generating-guide" && (generateStatus.message || "Writing study guide...")}
              </p>
            </div>
            <div className="max-w-sm mx-auto space-y-2">
              <div className="w-full bg-muted rounded-full h-2.5"><div className="bg-primary rounded-full h-2.5 transition-all duration-500" style={{ width: `${progressPercent}%` }} /></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Normal View ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/chapters" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"><ArrowLeft className="h-4 w-4" />Back to Chapters</Link>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant={chapter.bookSource === "core_radiology" ? "default" : chapter.bookSource === "notebook_import" ? "outline" : "secondary"} className={chapter.bookSource === "notebook_import" ? "border-purple-400 text-purple-700 dark:text-purple-300" : ""}>
            {chapter.bookSource === "core_radiology" ? "Core Radiology" : chapter.bookSource === "notebook_import" ? "Imported Notes" : "Crack the Core"}
          </Badge>
          <span className="text-sm text-muted-foreground">Chapter {chapter.number}</span>
        </div>
        <h1 className="text-3xl font-bold">{chapter.title}</h1>
      </div>

      {hasPdfChunks && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <span>~{chapter.estimatedPages} pages stored</span>
            {chapter.relatedChapters?.length > 0 && (
              <span>{" "}· Cross-ref:{" "}{chapter.relatedChapters.map((rc, i) => (<span key={rc.id}>{i > 0 && ", "}<Link href={`/chapters/${rc.id}`} className="underline hover:text-foreground">{rc.bookSource === "core_radiology" ? "Core" : "CtC"} Ch.{rc.number}</Link>{" "}(~{rc.estimatedPages}p)</span>))}</span>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href={`/quiz?chapterId=${chapter.id}`}><Button size="sm" className="gap-2"><Brain className="h-4 w-4" />Quiz ({chapter.questions.length})</Button></Link>
        <Link href={`/flashcards?chapterId=${chapter.id}`}><Button size="sm" variant="outline" className="gap-2"><Layers className="h-4 w-4" />Flashcards ({chapter.flashcards.length})</Button></Link>
        {chapter.studyGuide && chapter.flashcards.length === 0 && !generatingFlashcards && (
          <Button size="sm" variant="outline" className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={generateFlashcardsOnly}>
            <Sparkles className="h-4 w-4" />Generate Flashcards
          </Button>
        )}
        {generatingFlashcards && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {flashcardGenMessage}
          </span>
        )}
        {chapter.studyGuide && chapter.questions.length === 0 && !generatingQuestions && (
          <Button size="sm" variant="outline" className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50" onClick={generateQuestionsOnly}>
            <Sparkles className="h-4 w-4" />Generate Questions
          </Button>
        )}
        {generatingQuestions && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {questionGenMessage}
          </span>
        )}
        {hasPdfChunks && (
          <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground" onClick={generateContent}><RefreshCw className="h-4 w-4" />Regenerate All</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {activeTab === "guide" && (
          <Card>
            <CardContent className="p-6 md:p-8">
              {guideError && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 mb-4">
                  <div className="flex items-start gap-2"><AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" /><p className="text-sm text-red-600 dark:text-red-400">{guideError}</p></div>
                </div>
              )}
              {chapter.studyGuide ? (
                <>
                  {/* Toolbar - sticky so it follows user while scrolling */}
                  <div className="sticky top-0 z-20 -mx-6 md:-mx-8 px-6 md:px-8 py-3 bg-card/95 backdrop-blur-sm border-b mb-4">
                    <div className="flex justify-between items-center gap-2 flex-wrap">
                      <div className="flex gap-2">
                        {!editing ? (
                          <Button size="sm" variant="outline" onClick={startEditing} className="gap-1.5">
                            <Pencil className="h-3.5 w-3.5" />Edit
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" onClick={saveEdit} disabled={saving} className="gap-1.5">
                              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { pendingScrollY.current = window.scrollY; setEditing(false); }} className="gap-1.5">
                              <X className="h-3.5 w-3.5" />Cancel
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant={showAppendPanel ? "default" : "outline"} onClick={() => setShowAppendPanel(!showAppendPanel)} className="gap-1.5" disabled={editing}>
                          <FilePlus className="h-3.5 w-3.5" />Add Section
                        </Button>
                        <Button size="sm" variant={showNotes ? "default" : "outline"} onClick={() => setShowNotes(!showNotes)} className="gap-1.5">
                          <StickyNote className="h-3.5 w-3.5" />Notes
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5">
                          <Printer className="h-3.5 w-3.5" />Print
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5 border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950/30" onClick={restructureStudyGuide} disabled={isGenerating || restructuring}>
                          {restructuring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}Restructure
                        </Button>
                        {!isImported && (
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={mergeStudyGuide} disabled={isGenerating}>
                            <Merge className="h-3.5 w-3.5" />Merge
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={regenerateStudyGuide} disabled={isGenerating}>
                          <RefreshCw className="h-3.5 w-3.5" />Regenerate
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Append Section Panel */}
                  {showAppendPanel && (
                    <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-5 mb-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold flex items-center gap-2 text-sm">
                          <FilePlus className="h-4 w-4 text-primary" />
                          Add New Section
                        </h3>
                        <Button size="sm" variant="ghost" onClick={() => { setShowAppendPanel(false); setAppendMessage(""); }} className="h-7 w-7 p-0">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Paste content from NotebookLM or any source. It will be automatically formatted to match this study guide&apos;s style (callouts, tables, mnemonics, etc.) and appended.
                      </p>
                      <textarea
                        value={appendContent}
                        onChange={(e) => setAppendContent(e.target.value)}
                        placeholder="Paste your NotebookLM summary, notes, or any content here..."
                        rows={8}
                        className="w-full p-3 border rounded-lg text-sm bg-background resize-y"
                        disabled={appending}
                      />
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs text-muted-foreground shrink-0">Insert:</span>
                          <select
                            value={appendPosition}
                            onChange={(e) => setAppendPosition(e.target.value)}
                            disabled={appending}
                            className="text-xs h-8 px-2 border rounded-md bg-background text-foreground flex-1 min-w-0 max-w-xs"
                          >
                            <option value="start">At the beginning</option>
                            {guideSections.map((sec) => (
                              <option key={sec.index} value={String(sec.index)}>
                                After: {sec.label}
                              </option>
                            ))}
                            <option value="end">At the end</option>
                          </select>
                        </div>
                        <Button
                          size="sm"
                          onClick={appendSection}
                          disabled={!appendContent.trim() || appending}
                          className="gap-1.5"
                        >
                          {appending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus className="h-3.5 w-3.5" />}
                          {appending ? "Adding..." : "Add to Guide"}
                        </Button>
                      </div>
                      {appendMessage && (
                        <div className={`text-xs px-3 py-2 rounded ${appendMessage.startsWith("Error") ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400" : "bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400"}`}>
                          {appending && <Loader2 className="h-3 w-3 animate-spin inline mr-1.5" />}
                          {appendMessage}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Restructure status message */}
                  {restructureMessage && (
                    <div className={`rounded-lg px-4 py-3 mb-6 flex items-start gap-2 ${
                      restructureMessage.startsWith("Error")
                        ? "bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800"
                        : restructureMessage.includes("complete") || restructureMessage.includes("restructured")
                          ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
                          : "bg-purple-50 border border-purple-200 dark:bg-purple-950/20 dark:border-purple-800"
                    }`}>
                      {restructuring && <Loader2 className="h-4 w-4 animate-spin text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />}
                      {!restructuring && !restructureMessage.startsWith("Error") && <Wand2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />}
                      {restructureMessage.startsWith("Error") && <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />}
                      <div>
                        <p className={`text-sm ${
                          restructureMessage.startsWith("Error")
                            ? "text-red-600 dark:text-red-400"
                            : restructureMessage.includes("complete") || restructureMessage.includes("restructured")
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-purple-600 dark:text-purple-400"
                        }`}>
                          {restructureMessage}
                        </p>
                        {restructureMessage.includes("restructured") && (
                          <p className="text-xs text-muted-foreground mt-1">Redirecting to the new chapter...</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Editor / Preview Layout */}
                  <div className={`${showNotes ? "grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6" : ""}`}>
                    <div>
                      {editing ? (
                        <div className="space-y-2">
                          {/* Editor toolbar */}
                          <div className="flex gap-1 flex-wrap border rounded-lg p-1.5 bg-muted/30">
                            <button onClick={() => insertAtCursor("**bold**")} className="px-2 py-1 text-xs font-bold rounded hover:bg-accent">B</button>
                            <button onClick={() => insertAtCursor("*italic*")} className="px-2 py-1 text-xs italic rounded hover:bg-accent">I</button>
                            <button onClick={() => insertAtCursor("\n## ")} className="px-2 py-1 text-xs font-bold rounded hover:bg-accent">H2</button>
                            <button onClick={() => insertAtCursor("\n### ")} className="px-2 py-1 text-xs font-bold rounded hover:bg-accent">H3</button>
                            <button onClick={() => insertAtCursor("\n| Col 1 | Col 2 |\n|-------|-------|\n| ... | ... |\n")} className="px-2 py-1 text-xs rounded hover:bg-accent">Table</button>
                            <button onClick={() => insertAtCursor("\n> \u{1F4A1} **PEARL:** ")} className="px-2 py-1 text-xs rounded hover:bg-accent bg-amber-100 dark:bg-amber-900/30">Pearl</button>
                            <button onClick={() => insertAtCursor("\n> \u{1F534} **TRAP:** ")} className="px-2 py-1 text-xs rounded hover:bg-accent bg-red-100 dark:bg-red-900/30">Trap</button>
                            <button onClick={() => insertAtCursor("\n> \u26A1 **HIGH YIELD:** ")} className="px-2 py-1 text-xs rounded hover:bg-accent bg-orange-100 dark:bg-orange-900/30">HY</button>
                            <button onClick={() => insertAtCursor("\n> \u{1F9E0} **MNEMONIC:** ")} className="px-2 py-1 text-xs rounded hover:bg-accent bg-purple-100 dark:bg-purple-900/30">Mnem</button>
                            <div className="border-l mx-1" />
                            <input ref={editorFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditorImageUpload} />
                            <button
                              onClick={() => editorFileInputRef.current?.click()}
                              disabled={uploadingImage}
                              className="px-2 py-1 text-xs rounded hover:bg-accent flex items-center gap-1"
                            >
                              {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                              Image
                            </button>
                          </div>
                          <textarea
                            ref={textareaRef}
                            value={editContent}
                            onChange={(e) => {
                              setEditContent(e.target.value);
                              // Auto-resize to fit content
                              e.target.style.height = "auto";
                              e.target.style.height = e.target.scrollHeight + "px";
                            }}
                            className="w-full p-4 border rounded-lg text-sm font-mono bg-background min-h-[600px] overflow-hidden"
                            spellCheck={false}
                          />
                        </div>
                      ) : (
                        <article className="prose prose-sm sm:prose-base max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-th:text-foreground prose-td:text-foreground/80 prose-table:text-sm prose-blockquote:not-italic prose-blockquote:font-normal [&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={studyGuideComponents}>
                            {chapter.studyGuide}
                          </ReactMarkdown>
                        </article>
                      )}
                    </div>

                    {/* Notes sidebar */}
                    {showNotes && (
                      <div className="border-l pl-6 lg:pl-6">
                        <NotesPanel chapterId={chapter.id} />
                      </div>
                    )}
                  </div>
                </>
              ) : guideError ? (
                <div className="text-center py-12 space-y-4">
                  <AlertCircle className="h-10 w-10 mx-auto text-destructive/60" />
                  <p className="text-muted-foreground font-medium">Study guide generation failed</p>
                  <p className="text-sm text-destructive max-w-md mx-auto">{guideError}</p>
                  <Button onClick={regenerateStudyGuide} variant="outline" className="gap-2"><RefreshCw className="h-4 w-4" />Retry</Button>
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground/40" />
                  <p className="text-muted-foreground">
                    {hasPdfChunks ? "Preparing study guide..." : "Upload this book's PDF in Sources to generate a study guide."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "notes" && (
          <Card>
            <CardContent className="p-6">
              <NotesPanel chapterId={chapter.id} />
            </CardContent>
          </Card>
        )}

        {activeTab === "summary" && (
          <Card><CardContent className="p-6 prose prose-sm max-w-none">{chapter.summary ? <div className="whitespace-pre-wrap leading-relaxed">{chapter.summary}</div> : <p className="text-muted-foreground italic">Summary not yet generated.</p>}</CardContent></Card>
        )}

        {activeTab === "keypoints" && (
          <div className="space-y-3">
            {keyPoints.length > 0 ? keyPoints.map((point, i) => (
              <Card key={i}><CardContent className="p-4 flex items-start gap-3"><span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">{i + 1}</span><p className="text-sm leading-relaxed">{point}</p></CardContent></Card>
            )) : <p className="text-muted-foreground italic">Key points not yet generated.</p>}
          </div>
        )}

        {activeTab === "highyield" && (
          <div className="space-y-3">
            {highYield.length > 0 ? highYield.map((item, i) => (
              <Card key={i} className="border-chart-3/30"><CardContent className="p-4 flex items-start gap-3"><Lightbulb className="h-5 w-5 text-chart-3 flex-shrink-0 mt-0.5" /><p className="text-sm leading-relaxed">{item}</p></CardContent></Card>
            )) : <p className="text-muted-foreground italic">High-yield facts not yet generated.</p>}
          </div>
        )}

        {activeTab === "mnemonics" && (
          <div className="space-y-4">
            {mnemonics.length > 0 ? mnemonics.map((m, i) => (
              <Card key={i}><CardContent className="p-5"><h4 className="font-semibold text-primary mb-2">{m.name}</h4><p className="text-sm leading-relaxed">{m.content}</p></CardContent></Card>
            )) : <p className="text-muted-foreground italic">Mnemonics not yet generated.</p>}
          </div>
        )}

      </div>
    </div>
  );
}
