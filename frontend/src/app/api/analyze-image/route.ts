import { NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, callClaudeWithRetry } from "@/lib/claude";

export const dynamic = "force-dynamic";

const MODALITY_LABELS: Record<string, string> = {
  xr: "radiographie standard (X-ray)",
  ct: "scanner (CT)",
  mri: "IRM (MRI)",
  us: "échographie (ultrasound)",
};

function buildImageAnalysisPrompt(
  organ: string,
  modality: string,
  language: string,
  context?: string
): string {
  const lang =
    language === "fr"
      ? "Réponds ENTIÈREMENT en FRANÇAIS. Utilise la terminologie médicale française avec les équivalents anglais entre parenthèses si utile."
      : "Respond in English.";

  const modalityLabel = MODALITY_LABELS[modality] || modality;
  const contextLine = context ? `\nContexte clinique : ${context}` : "";

  return `Tu es un assistant d'enseignement en radiologie qui aide un résident à préparer l'examen FMH2 en Suisse.

Analyse cette image de ${modalityLabel} de la région ${organ}.${contextLine}

${lang}

Génère des flashcards pour l'apprentissage par répétition espacée. Pour chaque trouvaille distincte dans l'image, crée une flashcard avec :
- "front": Une question de style examen demandant d'identifier les trouvailles. Mentionne toujours la modalité et la région anatomique. Exemple : "Quels sont les signes sur cette radiographie thoracique ?"
- "back": Une réponse structurée contenant :
  1. Diagnostic principal / trouvaille
  2. Signes radiologiques clés (liste à puces)
  3. Principaux diagnostics différentiels (2-3)
  4. Un point d'enseignement à haut rendement pour l'examen
- "findings": Tableau des descriptions individuelles des trouvailles (pour l'indexation)

Si l'image montre plusieurs pathologies distinctes, crée des flashcards séparées pour chacune.
Si tu ne peux pas identifier clairement l'image, génère quand même une flashcard descriptive basée sur ce que tu observes, et note l'incertitude.

Retourne UNIQUEMENT un tableau JSON valide. Exemple :
[{"front":"...","back":"...","findings":["trouvaille1","trouvaille2"]}]`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("images") as File[];
    const organ = (formData.get("organ") as string) || "unknown";
    const modality = (formData.get("modality") as string) || "xr";
    const language = (formData.get("language") as string) || "fr";
    const context = formData.get("context") as string | null;

    if (files.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const client = getClaudeClient();
    const results: Array<{
      cards: Array<{ front: string; back: string; findings: string[] }>;
      imageDataUri: string;
      fileName: string;
    }> = [];

    for (const file of files) {
      // Validate
      if (!file.type.startsWith("image/")) {
        results.push({ cards: [], imageDataUri: "", fileName: file.name });
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        results.push({ cards: [], imageDataUri: "", fileName: file.name });
        continue;
      }

      // Convert to base64
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const dataUri = `data:${file.type};base64,${base64}`;

      // Determine media type for Claude API
      const mediaType = file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      // Call Claude Vision
      const prompt = buildImageAnalysisPrompt(organ, modality, language, context || undefined);

      const response = await callClaudeWithRetry(
        () =>
          client.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 4000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: mediaType, data: base64 },
                  },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        2,
        120_000
      );

      // Extract text from response
      let text = "";
      for (const block of response.content) {
        if (block.type === "text") text += block.text;
      }

      // Parse JSON — handle markdown code fences
      let cleaned = text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      let cards: Array<{ front: string; back: string; findings: string[] }> = [];
      try {
        cards = JSON.parse(cleaned);
        if (!Array.isArray(cards)) cards = [cards];
      } catch {
        // If parsing fails, create a single card from the raw text
        cards = [{ front: `Décrivez les trouvailles sur cette ${MODALITY_LABELS[modality] || modality}`, back: text, findings: [] }];
      }

      results.push({ cards, imageDataUri: dataUri, fileName: file.name });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Analyze image error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
