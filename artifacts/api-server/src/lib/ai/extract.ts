import mammoth from "mammoth";

/**
 * Getting readable text out of a filing.
 *
 * A chamber's documents are PDFs and Word files, and a model cannot draft from
 * bytes. This is the narrow layer that turns one into the other, and it is
 * deliberately conservative about what it claims to be able to read.
 *
 * ── What it cannot do, and says so ──────────────────────────────────────
 *
 * **Scanned pages come out empty.** A large share of what an Indian court
 * actually hands back is a scan — a photocopied order stamped and re-scanned —
 * and no text extractor will get a word out of it. There is no OCR here.
 *
 * The failure mode that matters is not the empty string; it is an empty string
 * that nobody notices, so a draft is written without the order it was supposed
 * to be based on and reads plausibly anyway. Hence `ExtractedText.empty`: the
 * caller is told, the advocate is told on screen, and a document that
 * contributed nothing is never silently counted as context.
 */

/** Hard ceiling per document, in characters. Roughly 25k tokens. */
const MAX_CHARS = 100_000;

export type ExtractedText = {
  text: string;
  /** Nothing readable came out — almost always a scan. */
  empty: boolean;
  /** Text was cut at the ceiling. */
  truncated: boolean;
  /** Pages read, where the format has pages. */
  pages: number | null;
  /** Why nothing could be read, when that is knowable. */
  note: string | null;
};

const EMPTY: ExtractedText = {
  text: "",
  empty: true,
  truncated: false,
  pages: null,
  note: null,
};

function finish(raw: string, pages: number | null, note: string | null = null): ExtractedText {
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const truncated = text.length > MAX_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    empty: text.length === 0,
    truncated,
    pages,
    note,
  };
}

/**
 * Extract text from one stored document.
 *
 * Takes the DECRYPTED bytes — decryption stays in `blob-store.ts`, above this,
 * so nothing here ever sees a key. Never throws for an unreadable file: an
 * advocate who ticked a scan should get "this one had no readable text", not a
 * failed request that loses the eight documents they ticked alongside it.
 */
export async function extractText(bytes: Buffer, mime: string): Promise<ExtractedText> {
  const type = mime.split(";")[0]!.trim().toLowerCase();

  try {
    if (type === "application/pdf") {
      // Imported here rather than at the top of the file, deliberately. The
      // package pulls in a build of pdf.js that touches browser globals as it
      // loads; keeping that inside the one branch that needs it means a server
      // which never reads a PDF never evaluates any of it.
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: bytes });
      try {
        const result = await parser.getText();
        const out = finish(result.text ?? "", result.pages?.length ?? null);
        return out.empty
          ? {
              ...out,
              note:
                "No readable text — this is almost certainly a scanned document. " +
                "It was not sent, and did not contribute to the draft.",
            }
          : out;
      } finally {
        // The parser holds a worker; not destroying it leaks one per document.
        await parser.destroy().catch(() => {});
      }
    }

    if (
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      type === "application/msword"
    ) {
      // mammoth reads .docx. A legacy .doc is a different, binary format it
      // cannot open, and it throws — caught below and reported honestly rather
      // than presented as an empty document.
      const result = await mammoth.extractRawText({ buffer: bytes });
      return finish(result.value ?? "", null);
    }

    if (type === "text/plain" || type === "text/csv") {
      return finish(bytes.toString("utf8"), null);
    }

    return {
      ...EMPTY,
      note: `Text cannot be read from a ${type} file. Images and spreadsheets are not supported as drafting context.`,
    };
  } catch (err) {
    return {
      ...EMPTY,
      note: `This document could not be read (${err instanceof Error ? err.message : String(err)}). It was not sent.`,
    };
  }
}

/** Which stored MIME types this can actually read. Drives the picker's UI. */
export function isExtractable(mime: string): boolean {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  return (
    type === "application/pdf" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type === "text/plain" ||
    type === "text/csv"
  );
}
