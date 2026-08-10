import { Router, type IRouter } from "express";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";

/**
 * The legal documents, served as plain pages.
 *
 * These are mounted OUTSIDE /api and before the SPA fallback, because they have
 * to be reachable by someone who has not signed in and may never sign in — a
 * regulator, a chamber's own counsel, a prospective customer reading the terms
 * before deciding. Putting them behind the app would defeat the point of having
 * them.
 *
 * Markdown is rendered by the small converter below rather than a dependency.
 * The input is four files in this repository, not user content, and the
 * converter escapes HTML before it does anything else — so even if one of those
 * files were edited to contain markup, it renders as text.
 */

const DOCS: Record<string, { file: string; title: string }> = {
  terms: { file: "terms-of-service.md", title: "Terms of Service" },
  privacy: { file: "privacy-policy.md", title: "Privacy Policy" },
  notice: { file: "dpdp-notice.md", title: "Data Protection Notice" },
  dpa: { file: "data-processing-agreement.md", title: "Data Processing Agreement" },
};

/**
 * Where the .md files are.
 *
 * The bundle lands in artifacts/api-server/dist, so the repo copy is four
 * levels up. A deployment that ships only the bundle can point LEGAL_DOCS_DIR
 * somewhere else instead.
 */
function docsDir(): string {
  const configured = process.env["LEGAL_DOCS_DIR"]?.trim();
  if (configured) return resolve(configured);
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "legal");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline markup, applied to already-escaped text. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, '<a href="$2">$1</a>');
}

/**
 * Enough markdown for these four documents: headings, paragraphs, lists,
 * blockquotes, tables and horizontal rules. Anything it does not recognise is
 * emitted as an escaped paragraph, so nothing is silently dropped.
 */
function render(md: string): string {
  const out: string[] = [];
  const lines = escapeHtml(md).split("\n");
  let i = 0;

  const flushList = (tag: "ul" | "ol", items: string[]) => {
    if (items.length) out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join("")}</${tag}>`);
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Table: a header row, a separator row of dashes, then body rows.
    if (line.trim().startsWith("|") && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        body.push(cells(lines[i]!));
        i++;
      }
      out.push(
        `<div class="tablewrap"><table><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (line.trimStart().startsWith("&gt; ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("&gt;")) {
        quote.push(lines[i]!.trimStart().replace(/^&gt;\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(inline(lines[i]!.replace(/^\s*[-*]\s+/, "")));
        i++;
      }
      flushList("ul", items);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(inline(lines[i]!.replace(/^\s*\d+\.\s+/, "")));
        i++;
      }
      flushList("ol", items);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i]!)
    ) {
      para.push(lines[i]!.trim());
      i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    else i++;
  }

  return out.join("\n");
}

/**
 * Self-contained, system fonts, readable on a phone, and legible printed —
 * counsel will print these. No stylesheet request, so the page works under the
 * strictest CSP the deployment cares to set.
 */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — LEX Practice</title>
<meta name="color-scheme" content="light dark">
<style>
  :root{--ink:#1b1b1b;--ink2:#4a4a4a;--bg:#fbfaf8;--line:#e0dcd4;--accent:#5b3a1c;--soft:#f2eee7}
  @media (prefers-color-scheme:dark){
    :root{--ink:#eee8e0;--ink2:#b9b0a4;--bg:#1a1714;--line:#37312a;--accent:#d9a45a;--soft:#242019}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.65 ui-serif,Georgia,"Times New Roman",serif;
    -webkit-text-size-adjust:100%}
  .wrap{max-width:44rem;margin:0 auto;padding:2rem 1.25rem 5rem}
  nav{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;padding-bottom:1rem;margin-bottom:2rem;
    border-bottom:1px solid var(--line);
    font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
  nav a{color:var(--ink2);text-decoration:none}
  nav a:hover,nav a[aria-current]{color:var(--accent)}
  h1{font-size:1.9rem;line-height:1.2;margin:0 0 .4rem}
  h2{font-size:1.3rem;margin:2.4rem 0 .6rem;padding-top:.6rem;border-top:1px solid var(--line)}
  h3{font-size:1.05rem;margin:1.6rem 0 .4rem}
  p,li{color:var(--ink2)}
  strong{color:var(--ink)}
  ul,ol{padding-left:1.3rem}
  li{margin:.3rem 0}
  a{color:var(--accent)}
  code{font:.87em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:.1em .35em;border-radius:3px}
  blockquote{margin:1.2rem 0;padding:.9rem 1.1rem;background:var(--soft);
    border-left:3px solid var(--accent);border-radius:0 4px 4px 0}
  blockquote p{margin:0}
  hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
  .tablewrap{overflow-x:auto;margin:1.2rem 0}
  table{border-collapse:collapse;width:100%;font-size:.92rem}
  th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
  th{font:600 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;
    letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);white-space:nowrap}
  footer{margin-top:3rem;padding-top:1.2rem;border-top:1px solid var(--line);
    font-size:.82rem;color:var(--ink2)}
  @media print{body{background:#fff;color:#000}nav,footer{display:none}.wrap{max-width:none}}
</style>
</head>
<body>
<div class="wrap">
<nav>
  <a href="/">LEX Practice</a>
  <a href="/legal/terms">Terms</a>
  <a href="/legal/privacy">Privacy</a>
  <a href="/legal/notice">Notice</a>
  <a href="/legal/dpa">Processing</a>
</nav>
${body}
<footer>These documents are also maintained in the source repository under <code>docs/legal/</code>.</footer>
</div>
</body>
</html>`;
}

/** Rendered HTML by slug. Read once; these do not change without a redeploy. */
const cache = new Map<string, string>();

const router: IRouter = Router();

router.get("/legal", (_req, res) => {
  res.redirect(302, "/legal/terms");
});

router.get("/legal/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params["slug"]).toLowerCase();
  const doc = DOCS[slug];
  if (!doc) {
    res
      .status(404)
      .type("html")
      .send(page("Not found", "<h1>Not found</h1><p>No such document.</p>"));
    return;
  }

  const cached = cache.get(slug);
  if (cached) {
    res.type("html").send(cached);
    return;
  }

  try {
    const md = await readFile(join(docsDir(), doc.file), "utf8");
    const html = page(doc.title, render(md));
    cache.set(slug, html);
    res.type("html").send(html);
  } catch (err) {
    logger.error({ err, slug, dir: docsDir() }, "Legal document could not be read");
    res
      .status(500)
      .type("html")
      .send(
        page(
          doc.title,
          `<h1>${doc.title}</h1><p>This document is temporarily unavailable. Please contact us and we will send it to you directly.</p>`,
        ),
      );
  }
});

export default router;
