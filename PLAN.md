# PDF Ingestion Overhaul — Plan

## Current Problems
1. **API key error**: "The string did not match the expected pattern" — key format issue in Vercel
2. **Text-only extraction**: pdfjs-dist `getTextContent()` only extracts raw text — no tables, no images
3. **Chapter detection fails**: Regex `CHAPTER X:` doesn't match book's actual format → entire 1,270-page book treated as 1 chapter
4. **50k char truncation**: Even if it worked, only first ~20 pages of text would be sent to Claude
5. **No image analysis**: Radiology images (X-rays, CT, MRI) are completely lost — critical for the subject

## Proposed Solution: Claude Native PDF Ingestion

Claude's API accepts PDF files directly as `document` content blocks. It converts each page to an image internally and can analyze **text + tables + images** together. This is the ideal approach for radiology textbooks.

### Architecture

```
Browser (pdf-lib)          Server (API Route)           Claude API
─────────────────          ──────────────────           ──────────

Upload PDF
    │
    ▼
Split PDF into             Receive chunk
page-range chunks   ──►    (base64 PDF)         ──►    Analyze pages
(~20-30 pages each)        Forward to Claude            (text + images + tables)
    │                          │                            │
    │                          ▼                            ▼
    │                      Parse AI response            Return JSON
    │                      Save to Prisma DB            study materials
    ▼
Show progress
per chunk
```

### Constraints to Work Within

| Constraint | Limit | How We Handle It |
|-----------|-------|-----------------|
| Claude PDF page limit | 100 pages/request | Split into 20-30 page chunks |
| Claude PDF file size | 32 MB/request | Small chunks stay well under |
| Vercel body size | 4.5 MB | 20-30 page chunks as base64 ≈ 2-4 MB |
| Vercel function timeout | 60s (Pro) / 30s (Hobby) | One Claude call per chunk, reasonable |
| Claude input tokens | ~2,000 tokens/page | 30 pages ≈ 60k tokens — fine |
| Cost | ~$3/M input tokens (Sonnet) | Full book ≈ $7-8 one-time cost |

### Implementation Steps

#### Phase 1: Fix Immediate Blocker (API Key)
- [x] Add `export const dynamic = "force-dynamic"` (done)
- [x] Let Anthropic SDK read env var directly (done)
- [ ] User: verify API key value in Vercel has no quotes/spaces, redeploy

#### Phase 2: PDF Splitting + Claude Native PDF (Core Change)
1. **Add `pdf-lib` dependency** — lightweight library to split PDFs into page ranges in the browser
2. **Redesign ingest page**:
   - User uploads PDF
   - Browser uses pdf-lib to get page count
   - User selects page ranges (or auto-detect chapters via table of contents)
   - Each range is extracted as a small standalone PDF (base64)
3. **New API route logic**:
   - Receive base64 PDF chunk (20-30 pages)
   - Send to Claude API using `type: "document"` content block (native PDF support)
   - Claude sees the actual pages — text, tables, images, diagrams
   - Claude generates study materials with image-aware content
   - Save to database
4. **Improved chapter detection**:
   - Use a two-pass approach: first send the table of contents pages (first 5-10 pages) to Claude
   - Claude identifies chapter names and page numbers
   - Then process each chapter's page range

#### Phase 3: Enhanced Study Content (Leveraging Images)
- Update the Claude prompt to reference imaging findings seen in the pages
- Add image descriptions to flashcards and questions (e.g., "What finding is shown in this CT?")
- Use the existing `imageUrl` field in the Question model (already in schema, currently unused)

### What Changes

| File | Change |
|------|--------|
| `package.json` | Add `pdf-lib` dependency |
| `src/app/ingest/page.tsx` | Complete rewrite: PDF splitting UI, page range selection, chunk-based processing |
| `src/app/api/ingest/route.ts` | New handler: accept base64 PDF, send to Claude as document, parse response |
| `prisma/schema.prisma` | Possibly add page range fields to Chapter model |

### What Stays the Same
- All downstream consumers (quiz, flashcards, chapters pages) — unchanged
- Database schema (mostly) — Chapter, Question, Flashcard models stay compatible
- The Anthropic SDK — same package, just using PDF document feature
- Deployment on Vercel — same platform

### Cost Estimate for Full Book
- 1,270 pages × ~2,000 tokens/page = ~2.5M input tokens
- Claude Sonnet: ~$7.50 for the full book (one-time)
- Output tokens for study materials: ~$2-3 additional
- **Total: ~$10 to process the entire textbook with full image analysis**

### Alternative Approaches Considered (and why not)

1. **Google Document AI / AWS Textract**: Adds another service + cost + complexity. Claude already has PDF support built-in.
2. **Render pages to canvas in browser, send as images**: More complex, larger payloads, worse quality than native PDF.
3. **Server-side PDF processing (Poppler/Tesseract)**: Can't run on Vercel serverless. Would need a separate backend.
4. **Keep text-only but improve extraction**: Misses the entire point — radiology needs images.
