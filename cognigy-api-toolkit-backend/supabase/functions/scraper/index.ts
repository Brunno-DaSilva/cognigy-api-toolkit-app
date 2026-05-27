// scraper
// Stateless scraper. Two input modes:
//   urls[]      — fetch + parse HTML on the server, chunk into .ctxt
//   documents[] — text already extracted in the browser (PDF/DOCX/ODT/TXT),
//                 we just chunk it into .ctxt. No URL fetching.
// Both modes share the same chunking pipeline and produce identical .ctxt
// shape. Nothing persisted server-side — the browser drives the loop and
// assembles the ZIP.
//
// Request body (POST):
//   {
//     urls?: string[],
//     documents?: Array<{ title: string, text: string, source?: string }>,
//     config?: {
//       ignoreTags?: string[],       // tags to strip before HTML extraction
//       maxChunkSize?: number,       // 800-2000, default 1700
//       minChunkSize?: number,       // floor 800,  default 800
//       customTags?: string[],       // injected into .ctxt header tags array
//       delayBetweenUrlsMs?: number  // default 1000 (urls only)
//     }
//   }
//
// Response:
//   {
//     files: Array<{name, content, bytes, chunks, urls}>,
//     errors: Array<{source, message}>,  // source = url or filename
//     stats: {requested, succeeded, filesGenerated}
//   }
//
// Auth: caller must send Authorization: Bearer <Supabase user JWT>.

import { createClient } from "npm:@supabase/supabase-js@2";
import * as cheerio from "npm:cheerio@1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Re-enforced server-side so a misbehaving client can't OOM the function.
const HARD_MAX_URLS_PER_REQUEST = 25;
const HARD_MAX_DOCS_PER_REQUEST = 25;
const HARD_MAX_DOC_TEXT_CHARS = 2_000_000; // ~2 MB of text per document
const HARD_MAX_CHUNK_SIZE = 2000;
const HARD_MIN_CHUNK_SIZE = 800;
const DEFAULT_MAX_CHUNK_SIZE = 1700;
const DEFAULT_MIN_CHUNK_SIZE = 800;
const DEFAULT_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_FILE_SIZE = 60 * 1024;
const MAX_CHUNK_METADATA = 20;
const DEFAULT_IGNORE_TAGS = [
  "script", "style", "nav", "footer", "header",
  "iframe", "aside", "noscript", "svg", "img", "button",
];

type Config = {
  ignoreTags: string[];
  maxChunkSize: number;
  minChunkSize: number;
  customTags: string[];
  delayBetweenUrlsMs: number;
};

type Block = { text: string; urls: string[] };
type ChunkWithUrls = { text: string; urls: string[] };
// `source` is the URL for web mode, the filename for document mode.
// `kind` lets generateFiles pick the right naming/tag strategy.
type Article = {
  kind: "url" | "document";
  source: string;
  title: string;
  chunksWithUrls: ChunkWithUrls[];
};
type DocumentInput = { title: string; text: string; source?: string };
type GeneratedFile = {
  name: string;
  content: string;
  bytes: number;
  chunks: number;
  urls: string[];
};

// Regex used to surface URLs found inside uploaded document text, so they
// can still appear as `site${i}:` refs in the generated .ctxt.
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const urls: string[] = Array.isArray(body?.urls) ? body.urls : [];
    const documents: DocumentInput[] = Array.isArray(body?.documents)
      ? body.documents
      : [];

    if (urls.length === 0 && documents.length === 0) {
      return json({ error: "urls[] or documents[] is required" }, 400);
    }
    if (urls.length > HARD_MAX_URLS_PER_REQUEST) {
      return json(
        { error: `too many urls: max ${HARD_MAX_URLS_PER_REQUEST} per request` },
        400,
      );
    }
    if (documents.length > HARD_MAX_DOCS_PER_REQUEST) {
      return json(
        { error: `too many documents: max ${HARD_MAX_DOCS_PER_REQUEST} per request` },
        400,
      );
    }

    const config = normalizeConfig(body?.config);

    const files: GeneratedFile[] = [];
    const errors: { source: string; message: string }[] = [];
    let succeeded = 0;

    for (const url of urls) {
      try {
        const article = await fetchAndExtractArticle(url, config);
        if (!article || article.chunksWithUrls.length === 0) {
          errors.push({ source: url, message: "no content extracted" });
          continue;
        }
        const generated = generateFiles(article, config);
        for (const f of generated) files.push(f);
        succeeded++;
      } catch (err) {
        errors.push({ source: url, message: (err as Error).message });
      }
      if (config.delayBetweenUrlsMs > 0) await delay(config.delayBetweenUrlsMs);
    }

    for (const doc of documents) {
      const docId = doc?.source || doc?.title || "document";
      try {
        if (!doc || typeof doc.text !== "string" || !doc.text.trim()) {
          errors.push({ source: docId, message: "document text is empty" });
          continue;
        }
        if (doc.text.length > HARD_MAX_DOC_TEXT_CHARS) {
          errors.push({
            source: docId,
            message: `document exceeds ${HARD_MAX_DOC_TEXT_CHARS} char limit`,
          });
          continue;
        }
        const article = processDocument(doc, config);
        if (!article || article.chunksWithUrls.length === 0) {
          errors.push({ source: docId, message: "no chunks produced" });
          continue;
        }
        const generated = generateFiles(article, config);
        for (const f of generated) files.push(f);
        succeeded++;
      } catch (err) {
        errors.push({ source: docId, message: (err as Error).message });
      }
    }

    return json({
      files,
      errors,
      stats: {
        requested: urls.length + documents.length,
        succeeded,
        filesGenerated: files.length,
      },
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function normalizeConfig(input: any): Config {
  const c = input ?? {};
  const ignoreTags = Array.isArray(c.ignoreTags) ? c.ignoreTags : DEFAULT_IGNORE_TAGS;
  let maxChunkSize = Number(c.maxChunkSize) || DEFAULT_MAX_CHUNK_SIZE;
  let minChunkSize = Number(c.minChunkSize) || DEFAULT_MIN_CHUNK_SIZE;
  if (maxChunkSize > HARD_MAX_CHUNK_SIZE) maxChunkSize = HARD_MAX_CHUNK_SIZE;
  if (maxChunkSize < HARD_MIN_CHUNK_SIZE) maxChunkSize = HARD_MIN_CHUNK_SIZE;
  if (minChunkSize < HARD_MIN_CHUNK_SIZE) minChunkSize = HARD_MIN_CHUNK_SIZE;
  if (minChunkSize >= maxChunkSize) minChunkSize = Math.floor(maxChunkSize * 0.5);
  const customTags = Array.isArray(c.customTags)
    ? c.customTags
        .filter((t: unknown) => typeof t === "string" && (t as string).trim())
        .map((t: string) => t.trim())
    : [];
  const delayBetweenUrlsMs = Number.isFinite(c.delayBetweenUrlsMs)
    ? Math.max(0, Number(c.delayBetweenUrlsMs))
    : DEFAULT_DELAY_MS;
  return { ignoreTags, maxChunkSize, minChunkSize, customTags, delayBetweenUrlsMs };
}

// ---------------------------------------------------------------------------
// Fetch + parse one URL
// ---------------------------------------------------------------------------
async function fetchAndExtractArticle(url: string, config: Config): Promise<Article | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } finally {
    clearTimeout(t);
  }

  const $ = cheerio.load(html);

  if (config.ignoreTags.length > 0) $(config.ignoreTags.join(", ")).remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    $('[class*="h1"], [class*="heading-h1"]').first().text().trim() ||
    basename(url);

  const contentBlocks = extractContentBlocks($, $("body"), url);
  const chunksWithUrls = chunkContentWithUrls(contentBlocks, config);
  return { url, title, chunksWithUrls };
}

function basename(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || u.hostname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
function isValidUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  const u = url.toLowerCase().trim();
  if (u.startsWith("javascript:")) return false;
  if (u.startsWith("#")) return false;
  if (u === "" || u === "/") return false;
  if (u.includes("google-analytics.com")) return false;
  if (u.includes("googletagmanager.com")) return false;
  if (u.includes("facebook.com/tr")) return false;
  if (u.includes("doubleclick.net")) return false;
  if (!u.startsWith("http://") && !u.startsWith("https://") && !u.startsWith("/")) {
    return false;
  }
  return true;
}

function makeAbsoluteUrl(url: string, baseUrl: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) {
    try {
      const base = new URL(baseUrl);
      return `${base.protocol}//${base.host}${trimmed}`;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Content extraction — block-per-heading, with inline URL capture.
// ---------------------------------------------------------------------------
const HEADING_SELECTORS = 'h1, h2, h3, h4, h5, h6, dt.h3, [class*="heading"]';

function extractContentBlocks($: any, $root: any, baseUrl: string): Block[] {
  const blocks: Block[] = [];
  const $headings = $root.find(HEADING_SELECTORS);

  $headings.each((_: number, heading: any) => {
    const $heading = $(heading);
    const headingText = $heading.text().trim();
    if (!headingText) return;

    const urls = new Set<string>();
    const content = collectContentAfterHeading($, $heading, baseUrl, urls);
    if (!content) return;

    const block = `${headingText}\n${content}`.trim();
    if (block.split("\n").filter((l: string) => l.trim()).length > 1) {
      blocks.push({ text: block, urls: Array.from(urls) });
    }
  });

  if (blocks.length === 0) {
    const urls = new Set<string>();
    const paragraphs = extractParagraphs($, $root, baseUrl, urls);
    if (paragraphs) blocks.push({ text: paragraphs, urls: Array.from(urls) });
  }

  return blocks;
}

function collectContentAfterHeading(
  $: any,
  $heading: any,
  baseUrl: string,
  urls: Set<string>,
): string {
  const content: string[] = [];
  let $next = $heading.next();
  while ($next.length > 0) {
    if ($next.is(HEADING_SELECTORS)) break;
    const text = extractTextFromElement($, $next, baseUrl, urls, false);
    if (text) content.push(text);
    $next = $next.next();
  }
  if (content.length === 0) {
    const text = extractTextFromElement($, $heading.parent(), baseUrl, urls, true);
    if (text) content.push(text);
  }
  return content.join("\n").trim();
}

function extractTextFromElement(
  $: any,
  $element: any,
  baseUrl: string,
  urls: Set<string>,
  skipHeading: boolean,
): string {
  const lines: string[] = [];

  if ($element.is("p, div, span, article, section, dd")) {
    $element.contents().each((_: number, child: any) => {
      const $child = $(child);
      if (!skipHeading && $child.is(HEADING_SELECTORS)) return;

      if (child.type === "text") {
        const text = $(child).text().trim();
        if (text && text.length > 3) lines.push(text);
      } else if (child.type === "tag") {
        if ($child.is("a")) {
          const href = $child.attr("href");
          const linkText = $child.text().trim();
          if (href && isValidUrl(href)) {
            const abs = makeAbsoluteUrl(href, baseUrl);
            if (abs) {
              urls.add(abs);
              lines.push(linkText ? `${linkText} - ${abs}` : abs);
            } else if (linkText) {
              lines.push(linkText);
            }
          } else if (linkText) {
            lines.push(linkText);
          }
        } else {
          const text = extractTextFromElement($, $child, baseUrl, urls, skipHeading);
          if (text) lines.push(text);
        }
      }
    });
  } else if ($element.is("ul, ol")) {
    $element.find("li").each((_: number, li: any) => {
      const $li = $(li);
      let liText = "";
      $li.contents().each((__: number, child: any) => {
        const $child = $(child);
        if (child.type === "text") {
          const text = $(child).text().trim();
          if (text) liText += (liText ? " " : "") + text;
        } else if ($child.is("a")) {
          const href = $child.attr("href");
          const linkText = $child.text().trim();
          if (href && isValidUrl(href)) {
            const abs = makeAbsoluteUrl(href, baseUrl);
            if (abs) {
              urls.add(abs);
              liText += (liText ? " " : "") + (linkText ? `${linkText} - ${abs}` : abs);
            } else if (linkText) {
              liText += (liText ? " " : "") + linkText;
            }
          } else if (linkText) {
            liText += (liText ? " " : "") + linkText;
          }
        } else if ($child.is("strong, em, b, i, code, span")) {
          const text = $child.text().trim();
          if (text) liText += (liText ? " " : "") + text;
        } else {
          const nested = extractTextFromElement($, $child, baseUrl, urls, false);
          if (nested) liText += (liText ? " " : "") + nested;
        }
      });
      if (liText) lines.push(`• ${liText}`);
    });
  } else if ($element.is("a")) {
    const href = $element.attr("href");
    const linkText = $element.text().trim();
    if (href && isValidUrl(href)) {
      const abs = makeAbsoluteUrl(href, baseUrl);
      if (abs) {
        urls.add(abs);
        return linkText ? `${linkText} - ${abs}` : abs;
      }
    }
    return linkText;
  } else if ($element.is("strong, em, b, i")) {
    const text = $element.text().trim();
    if (text) return text;
  } else {
    const text = $element.text().trim();
    if (text && text.length > 3) lines.push(text);
  }

  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function extractParagraphs(
  $: any,
  $root: any,
  baseUrl: string,
  urls: Set<string>,
): string {
  const paragraphs: string[] = [];
  $root
    .find('p, div[class*="content"], div[class*="text"], article')
    .each((_: number, el: any) => {
      const $el = $(el);
      $el.find("a").each((__: number, link: any) => {
        const href = $(link).attr("href");
        if (href && isValidUrl(href)) {
          const abs = makeAbsoluteUrl(href, baseUrl);
          if (abs) urls.add(abs);
        }
      });
      const text = extractTextFromElement($, $el, baseUrl, urls, false);
      if (text && text.length > 50) paragraphs.push(text);
    });
  return paragraphs.join("\n\n");
}

// ---------------------------------------------------------------------------
// Chunking — split blocks into <= maxChunkSize pieces, keep URL associations.
// ---------------------------------------------------------------------------
function chunkContentWithUrls(blocks: Block[], config: Config): ChunkWithUrls[] {
  const chunks: ChunkWithUrls[] = [];

  for (const block of blocks) {
    const text = block.text;
    const blockUrls = block.urls || [];

    if (text.length <= config.maxChunkSize) {
      chunks.push({ text, urls: blockUrls });
      continue;
    }

    const lines = text.split("\n");
    const title = lines[0];
    const contentText = lines.slice(1).join("\n");
    const numChunks = Math.ceil(text.length / config.maxChunkSize);
    const target = Math.floor(text.length / numChunks);

    const split = splitContentSemantically(title, contentText, target, config);

    const allValid = split.length > 0 && split.every((c) => c.length <= config.maxChunkSize);
    const finalChunks = allValid ? split : splitBySentences(title, contentText, config);

    for (const ct of finalChunks) chunks.push({ text: ct, urls: blockUrls });
  }

  return chunks;
}

function splitContentSemantically(
  title: string,
  content: string,
  _targetSize: number,
  config: Config,
): string[] {
  const chunks: string[] = [];
  const titleWithNewline = title + "\n";

  let sections = content.split("\n\n").filter((s) => s.trim());
  if (
    sections.length < 3 ||
    sections.some((s) => s.length > config.maxChunkSize * 0.8)
  ) {
    sections = content.split("\n").filter((s) => s.trim());
  }
  const separator = content.includes("\n\n") ? "\n\n" : "\n";

  let current: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const isLast = i === sections.length - 1;
    const testText = titleWithNewline + [...current, section].join(separator);

    if (testText.length > config.maxChunkSize && current.length > 0) {
      const chunkText = titleWithNewline + current.join(separator);
      if (chunkText.length > config.maxChunkSize) return []; // signal failure
      chunks.push(chunkText.trim());
      current = [section];
    } else {
      current.push(section);
    }

    if (isLast && current.length > 0) {
      const chunkText = titleWithNewline + current.join(separator);
      if (chunks.length > 0 && chunkText.length < config.minChunkSize) {
        const prev = chunks.pop()!;
        const merged = prev + separator + current.join(separator);
        if (merged.length <= config.maxChunkSize) {
          chunks.push(merged.trim());
        } else {
          chunks.push(prev);
          if (chunkText.length > config.maxChunkSize) return [];
          chunks.push(chunkText.trim());
        }
      } else {
        if (chunkText.length > config.maxChunkSize) return [];
        chunks.push(chunkText.trim());
      }
    }
  }

  return chunks;
}

function splitBySentences(title: string, content: string, config: Config): string[] {
  const chunks: string[] = [];
  const titleWithNewline = title + "\n";
  const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
  let current: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();

    // Single sentence too large — character-level fallback
    if (sentence.length > config.maxChunkSize - titleWithNewline.length) {
      if (current.length > 0) {
        const chunkText = titleWithNewline + current.join(" ");
        if (chunkText.length <= config.maxChunkSize) chunks.push(chunkText.trim());
        current = [];
      }
      const maxContentSize = config.maxChunkSize - titleWithNewline.length - 10;
      let remaining = sentence;
      while (remaining.length > 0) {
        const piece = remaining.substring(0, maxContentSize);
        const chunkText = titleWithNewline + piece;
        if (chunkText.length <= config.maxChunkSize) chunks.push(chunkText.trim());
        remaining = remaining.substring(maxContentSize);
      }
      continue;
    }

    const isLast = i === sentences.length - 1;
    const testText = titleWithNewline + [...current, sentence].join(" ");

    if (testText.length > config.maxChunkSize && current.length > 0) {
      const chunkText = titleWithNewline + current.join(" ");
      if (chunkText.length <= config.maxChunkSize) chunks.push(chunkText.trim());
      current = [sentence];
    } else {
      current.push(sentence);
    }

    if (isLast && current.length > 0) {
      const chunkText = titleWithNewline + current.join(" ");
      if (chunks.length > 0 && chunkText.length < config.minChunkSize) {
        const prev = chunks.pop()!;
        const merged = prev + " " + current.join(" ");
        if (merged.length <= config.maxChunkSize) {
          chunks.push(merged.trim());
        } else {
          chunks.push(prev);
          if (chunkText.length <= config.maxChunkSize) chunks.push(chunkText.trim());
        }
      } else if (chunkText.length <= config.maxChunkSize) {
        chunks.push(chunkText.trim());
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// File assembly — splits into multiple .ctxt parts if metadata cap or file
// size limit would be exceeded. Returns the generated contents in-memory.
// ---------------------------------------------------------------------------
function generateFiles(article: Article, config: Config): GeneratedFile[] {
  const u = new URL(article.url);
  const domain = u.hostname.replace(/^www\./, "");
  const siteName = domain.split(".")[0];
  const urlParts = u.pathname.split("/").filter(Boolean);
  let lastPart = urlParts[urlParts.length - 1] || "index";
  lastPart = lastPart.replace(/-[a-f0-9]{6,}$/i, "");

  const baseTitle = `${siteName}_${lastPart}`;
  const tags = [siteName, lastPart, ...config.customTags];

  const parts = splitByFileSize(article.chunksWithUrls, tags, baseTitle, article.url);
  const out: GeneratedFile[] = [];

  for (const part of parts) {
    const version = "version: 1";
    const metadata =
      `\`${version}\`\n` +
      `\`title: ${part.title}\`\n` +
      `\`url: ${article.url}\`\n` +
      `\`tags: [${tags.join(", ")}]\`\n\n`;

    let content = "";
    const collectedUrls = new Set<string>();

    for (let i = 0; i < part.chunks.length; i++) {
      const chunk = part.chunks[i];
      content += chunk.text;

      if (chunk.urls && chunk.urls.length > 0) {
        const uniq = [...new Set(chunk.urls)];
        for (let j = 0; j < uniq.length; j++) {
          content += `\n\`site${j + 1}: ${uniq[j]}\``;
          collectedUrls.add(uniq[j]);
        }
      }
      content += `\n\`url: ${article.url}\``;
      if (i < part.chunks.length - 1) content += "\n\n";
    }
    content += `\n\nFor more information, please visit:\n• ${article.url}`;

    const full = metadata + content;
    out.push({
      name: `${part.title}.ctxt`,
      content: full,
      bytes: new TextEncoder().encode(full).length,
      chunks: part.chunks.length,
      urls: Array.from(collectedUrls),
    });
  }

  return out;
}

type FilePart = { chunks: ChunkWithUrls[]; title: string };

function splitByFileSize(
  chunks: ChunkWithUrls[],
  tags: string[],
  baseTitle: string,
  articleUrl: string,
): FilePart[] {
  const fileParts: FilePart[] = [];
  let current: ChunkWithUrls[] = [];
  let part = 1;
  let urlCount = 0;

  for (const chunk of chunks) {
    const chunkUrlCount = chunk.urls ? chunk.urls.length : 0;
    const wouldExceedMeta = urlCount + chunkUrlCount > MAX_CHUNK_METADATA;

    const test = [...current, chunk];
    const title = fileParts.length > 0 ? `${baseTitle}-part-${part}` : baseTitle;
    const size = calculateFileSize(test, tags, title, articleUrl);

    if ((size > MAX_FILE_SIZE || wouldExceedMeta) && current.length > 0) {
      fileParts.push({
        chunks: current,
        title: fileParts.length > 0 ? `${baseTitle}-part-${part}` : baseTitle,
      });
      part++;
      current = [chunk];
      urlCount = chunkUrlCount;
    } else {
      current.push(chunk);
      urlCount += chunkUrlCount;
    }
  }

  if (current.length > 0) {
    fileParts.push({
      chunks: current,
      title: fileParts.length > 0 ? `${baseTitle}-part-${part}` : baseTitle,
    });
  }

  return fileParts;
}

function calculateFileSize(
  chunks: ChunkWithUrls[],
  tags: string[],
  title: string,
  articleUrl: string,
): number {
  const version = "version: 1";
  const metadata =
    `\`${version}\`\n` +
    `\`title: ${title}\`\n` +
    `\`url: ${articleUrl}\`\n` +
    `\`tags: [${tags.join(", ")}]\`\n\n`;

  let content = "";
  let urlMetadataCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    content += chunk.text;
    if (chunk.urls && chunk.urls.length > 0) {
      for (const url of chunk.urls) {
        if (urlMetadataCount < MAX_CHUNK_METADATA) {
          content += `\n\`url: ${url}\``;
          urlMetadataCount++;
        }
      }
    }
    if (i < chunks.length - 1) content += "\n\n";
  }
  return new TextEncoder().encode(metadata + content).length;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
