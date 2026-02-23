#!/usr/bin/env python3
"""
RadioRevise PDF Ingestion Pipeline

Extracts text from radiology textbook PDFs chapter by chapter,
then uses Claude API to generate study content:
- Chapter summaries
- Key points
- High-yield facts
- Mnemonics
- Memory palaces
- Quiz questions (QCM format)
- Flashcards

Usage:
    python scripts/ingest.py --pdf path/to/book.pdf --book core_radiology
    python scripts/ingest.py --pdf path/to/book.pdf --book crack_the_core

Requires:
    - ANTHROPIC_API_KEY environment variable
    - PyMuPDF (fitz) for PDF extraction
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

import fitz  # PyMuPDF
from dotenv import load_dotenv

# Load environment from frontend/.env
env_path = Path(__file__).parent.parent / "frontend" / ".env"
load_dotenv(env_path)

try:
    import anthropic
except ImportError:
    print("Error: anthropic package not installed. Run: pip install anthropic")
    sys.exit(1)


def get_db_path():
    """Get the SQLite database path from the frontend .env file."""
    db_url = os.getenv("DATABASE_URL", "file:./dev.db")
    # Parse "file:./dev.db" format
    db_file = db_url.replace("file:", "")
    if db_file.startswith("./"):
        # Relative to frontend directory
        return str(Path(__file__).parent.parent / "frontend" / "prisma" / db_file[2:])
    return db_file


def extract_chapters_from_pdf(pdf_path: str) -> list[dict]:
    """
    Extract text from a PDF, splitting by chapter headings.
    Returns a list of {number, title, text} dicts.
    """
    doc = fitz.open(pdf_path)
    full_text = ""

    print(f"Extracting text from {pdf_path} ({len(doc)} pages)...")

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text()
        full_text += f"\n--- PAGE {page_num + 1} ---\n{text}"

    doc.close()

    # Try to split by chapter headings
    # Common patterns: "Chapter 1:", "CHAPTER 1", "1. Title", etc.
    chapter_pattern = re.compile(
        r"(?:^|\n)\s*(?:CHAPTER|Chapter)\s+(\d+)[:\s.]*([^\n]+)",
        re.MULTILINE,
    )

    matches = list(chapter_pattern.finditer(full_text))

    if not matches:
        # Fallback: treat as a single chapter
        print("  No chapter headings found, treating as single document")
        return [{"number": 1, "title": "Full Document", "text": full_text[:50000]}]

    chapters = []
    for i, match in enumerate(matches):
        chapter_num = int(match.group(1))
        chapter_title = match.group(2).strip()

        # Get text from this chapter heading to the next one
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        chapter_text = full_text[start:end]

        # Truncate very long chapters to avoid API limits
        if len(chapter_text) > 50000:
            chapter_text = chapter_text[:50000] + "\n[... truncated for processing ...]"

        chapters.append({
            "number": chapter_num,
            "title": chapter_title,
            "text": chapter_text,
        })
        print(f"  Found Chapter {chapter_num}: {chapter_title} ({len(chapter_text)} chars)")

    print(f"  Total: {len(chapters)} chapters extracted")
    return chapters


def generate_study_content(client: anthropic.Anthropic, chapter_text: str, chapter_title: str) -> dict:
    """
    Use Claude API to generate study content for a chapter.
    Returns dict with summary, keyPoints, highYield, mnemonics, memoryPalace, questions, flashcards.
    """
    prompt = f"""You are an expert radiology educator helping a resident prepare for the Swiss FMH2 radiology specialty exam.

Based on the following chapter content, generate comprehensive study materials in JSON format.

Chapter: {chapter_title}

Content:
{chapter_text}

Generate a JSON object with exactly these fields:

{{
  "summary": "A detailed summary of the chapter (2-3 paragraphs) covering the main concepts, focusing on what's most likely to appear on the FMH2 exam.",

  "keyPoints": [
    "List of 8-12 key points that a radiology resident must know from this chapter"
  ],

  "highYield": [
    "List of 5-8 high-yield facts that are commonly tested and worth the most points"
  ],

  "mnemonics": [
    {{"name": "Mnemonic name/acronym", "content": "Explanation of what each letter stands for and how to remember it"}}
  ],

  "memoryPalace": "A vivid memory palace description that walks through a familiar location, placing key concepts at specific stations. Make it visual and engaging with radiology-specific imagery.",

  "questions": [
    {{
      "questionText": "A multiple-choice question in the style of RadPrimer (intermediate level)",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Detailed explanation of why this answer is correct and why others are wrong",
      "difficulty": "medium",
      "category": "topic category"
    }}
  ],

  "flashcards": [
    {{
      "front": "Question or concept to recall",
      "back": "Answer or explanation",
      "category": "topic category"
    }}
  ]
}}

Important:
- Generate 8-15 questions per chapter, varying difficulty (easy/medium/hard)
- Generate 15-25 flashcards per chapter covering key facts
- Generate 3-5 mnemonics per chapter
- Questions should mimic RadPrimer intermediate level format
- Focus on diagnostic imaging findings, differential diagnoses, and clinical correlations
- Use proper medical terminology

Return ONLY valid JSON, no markdown formatting."""

    print(f"    Generating study content for: {chapter_title}...")

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
    )

    # Parse the JSON response
    response_text = response.content[0].text.strip()

    # Remove any markdown code fences if present
    if response_text.startswith("```"):
        response_text = re.sub(r"^```(?:json)?\n?", "", response_text)
        response_text = re.sub(r"\n?```$", "", response_text)

    try:
        content = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"    WARNING: Failed to parse JSON response: {e}")
        print(f"    Raw response (first 500 chars): {response_text[:500]}")
        content = {
            "summary": response_text[:2000],
            "keyPoints": [],
            "highYield": [],
            "mnemonics": [],
            "memoryPalace": "",
            "questions": [],
            "flashcards": [],
        }

    return content


def save_to_database(db_path: str, book_source: str, chapter_num: int, chapter_title: str, raw_text: str, content: dict):
    """Save chapter and generated content to SQLite database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    # Upsert chapter
    cursor.execute(
        """INSERT INTO Chapter (bookSource, number, title, rawText, summary, keyPoints, highYield, mnemonics, memoryPalace, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(bookSource, number) DO UPDATE SET
             title=excluded.title, rawText=excluded.rawText, summary=excluded.summary,
             keyPoints=excluded.keyPoints, highYield=excluded.highYield,
             mnemonics=excluded.mnemonics, memoryPalace=excluded.memoryPalace, updatedAt=excluded.updatedAt""",
        (
            book_source,
            chapter_num,
            chapter_title,
            raw_text[:100000],  # limit raw text size
            content.get("summary", ""),
            json.dumps(content.get("keyPoints", []), ensure_ascii=False),
            json.dumps(content.get("highYield", []), ensure_ascii=False),
            json.dumps(content.get("mnemonics", []), ensure_ascii=False),
            content.get("memoryPalace", ""),
            now,
            now,
        ),
    )

    # Get chapter ID
    cursor.execute(
        "SELECT id FROM Chapter WHERE bookSource = ? AND number = ?",
        (book_source, chapter_num),
    )
    chapter_id = cursor.fetchone()[0]

    # Delete existing questions and flashcards for this chapter (regeneration)
    cursor.execute("DELETE FROM QuestionAttempt WHERE questionId IN (SELECT id FROM Question WHERE chapterId = ?)", (chapter_id,))
    cursor.execute("DELETE FROM Question WHERE chapterId = ?", (chapter_id,))
    cursor.execute("DELETE FROM FlashcardReview WHERE flashcardId IN (SELECT id FROM Flashcard WHERE chapterId = ?)", (chapter_id,))
    cursor.execute("DELETE FROM Flashcard WHERE chapterId = ?", (chapter_id,))

    # Insert questions
    for q in content.get("questions", []):
        cursor.execute(
            """INSERT INTO Question (chapterId, questionText, options, correctAnswer, explanation, difficulty, category, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chapter_id,
                q.get("questionText", ""),
                json.dumps(q.get("options", []), ensure_ascii=False),
                q.get("correctAnswer", 0),
                q.get("explanation", ""),
                q.get("difficulty", "medium"),
                q.get("category"),
                now,
            ),
        )

    # Insert flashcards
    for f in content.get("flashcards", []):
        cursor.execute(
            """INSERT INTO Flashcard (chapterId, front, back, category, createdAt)
               VALUES (?, ?, ?, ?, ?)""",
            (
                chapter_id,
                f.get("front", ""),
                f.get("back", ""),
                f.get("category"),
                now,
            ),
        )

    conn.commit()
    conn.close()

    q_count = len(content.get("questions", []))
    f_count = len(content.get("flashcards", []))
    print(f"    Saved: {q_count} questions, {f_count} flashcards")


def main():
    parser = argparse.ArgumentParser(description="RadioRevise PDF Ingestion Pipeline")
    parser.add_argument("--pdf", required=True, help="Path to the PDF file")
    parser.add_argument(
        "--book",
        required=True,
        choices=["core_radiology", "crack_the_core"],
        help="Book source identifier",
    )
    parser.add_argument(
        "--chapters",
        type=str,
        default=None,
        help="Comma-separated chapter numbers to process (e.g., '1,2,5'). Default: all",
    )
    parser.add_argument(
        "--skip-generation",
        action="store_true",
        help="Skip AI content generation (extract text only)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.pdf):
        print(f"Error: PDF file not found: {args.pdf}")
        sys.exit(1)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key and not args.skip_generation:
        print("Error: ANTHROPIC_API_KEY not set. Set it in frontend/.env or as environment variable.")
        print("Use --skip-generation to extract text without AI content generation.")
        sys.exit(1)

    db_path = get_db_path()
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        print("Run 'cd frontend && npx prisma db push' first to create the database.")
        sys.exit(1)

    print(f"Database: {db_path}")
    print(f"Book source: {args.book}")
    print()

    # Step 1: Extract chapters from PDF
    chapters = extract_chapters_from_pdf(args.pdf)

    # Filter chapters if specified
    if args.chapters:
        selected = set(int(x) for x in args.chapters.split(","))
        chapters = [ch for ch in chapters if ch["number"] in selected]
        print(f"Processing {len(chapters)} selected chapters")

    # Step 2: Generate content and save
    client = None
    if not args.skip_generation:
        client = anthropic.Anthropic(api_key=api_key)

    for ch in chapters:
        print(f"\nProcessing Chapter {ch['number']}: {ch['title']}")

        if args.skip_generation:
            content = {
                "summary": "",
                "keyPoints": [],
                "highYield": [],
                "mnemonics": [],
                "memoryPalace": "",
                "questions": [],
                "flashcards": [],
            }
        else:
            content = generate_study_content(client, ch["text"], ch["title"])
            # Rate limit: wait between API calls
            time.sleep(2)

        save_to_database(db_path, args.book, ch["number"], ch["title"], ch["text"], content)

    print(f"\nDone! Processed {len(chapters)} chapters.")
    print(f"You can now run the app: cd frontend && npm run dev")


if __name__ == "__main__":
    main()
