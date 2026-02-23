# RadioRevise - FMH2 Radiology Study App

Study app for the Swiss FMH2 radiology specialty exam. Uses active recall, spaced repetition (SM-2), mnemonics, and memory palaces based on Core Radiology and Crack the Core.

## Architecture

- **Frontend**: Next.js 15 + TypeScript + Prisma/SQLite + Tailwind CSS + shadcn/ui
- **Ingestion Pipeline**: Python (PyMuPDF) + Claude API (Sonnet) for content generation

## Quick Start

```bash
cd frontend
npm install
npm run db:push     # Create SQLite database
npm run db:seed     # Seed with sample radiology content
npm run dev         # Start dev server at http://localhost:3000
```

## PDF Ingestion

To ingest your own radiology textbook PDFs:

```bash
cd scripts
pip install -r requirements.txt

# Set your Anthropic API key in frontend/.env
# ANTHROPIC_API_KEY=sk-ant-...

python ingest.py --pdf /path/to/core-radiology.pdf --book core_radiology
python ingest.py --pdf /path/to/crack-the-core.pdf --book crack_the_core
```

## Features

- Chapter summaries with key points and high-yield facts
- QCM quiz system (RadPrimer-style questions)
- Flashcard system with SM-2 spaced repetition algorithm
- Mnemonics and memory palace descriptions
- Progress tracking dashboard
- PDF extraction pipeline with AI content generation
