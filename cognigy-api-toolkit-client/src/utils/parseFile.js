// Client-side file → plain text. Each parser returns the raw text; the
// scraper Edge Function does the chunking + .ctxt generation. Anything that
// fails throws — the caller surfaces the error in the UI.
//
// Supported extensions: .pdf, .docx, .odt, .txt
// Skipped intentionally: .doc (binary Word; browser-side parsing is fragile).

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import JSZip from "jszip";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

const titleFromName = (name) => {
  const i = name.lastIndexOf(".");
  return (i > 0 ? name.slice(0, i) : name).replace(/[_\-]+/g, " ").trim() || name;
};

const parsePdf = async (file) => {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    verbosity: 0,
  }).promise;

  const parts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // Reassemble lines using vertical position — PDF text items don't carry
    // newlines, so we infer them from y-coordinate jumps.
    let pageText = "";
    let lastY = null;
    for (const item of tc.items) {
      const currentY = item.transform?.[5];
      if (lastY !== null && currentY != null && Math.abs(currentY - lastY) > 2) {
        pageText += "\n";
      }
      pageText += (item.str ?? "") + " ";
      lastY = currentY;
    }
    parts.push(pageText.trim());
  }
  await pdf.destroy();
  return parts.join("\n\n");
};

const parseDocx = async (file) => {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || "";
};

const parseOdt = async (file) => {
  // .odt is a zip with content.xml inside. Pull the text nodes out; paragraphs
  // / headings become newlines.
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const contentEntry = zip.file("content.xml");
  if (!contentEntry) throw new Error("content.xml missing from .odt");
  const xml = await contentEntry.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const parts = [];
  // text:p = paragraph, text:h = heading. Both should be newline-separated.
  const blocks = doc.getElementsByTagName("*");
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    const tag = el.tagName || "";
    if (tag.endsWith(":p") || tag.endsWith(":h")) {
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (txt) parts.push(txt);
    }
  }
  return parts.join("\n\n");
};

const parseTxt = async (file) => {
  return await file.text();
};

export const SUPPORTED_FILE_EXTS = [".pdf", ".docx", ".odt", ".txt"];
export const SUPPORTED_FILE_ACCEPT = SUPPORTED_FILE_EXTS.join(",");

export async function parseFileToDocument(file) {
  const ext = extOf(file.name);
  let text;
  switch (ext) {
    case ".pdf":
      text = await parsePdf(file);
      break;
    case ".docx":
      text = await parseDocx(file);
      break;
    case ".odt":
      text = await parseOdt(file);
      break;
    case ".txt":
      text = await parseTxt(file);
      break;
    default:
      throw new Error(`Unsupported file type: ${ext || file.name}`);
  }

  text = (text || "").trim();
  if (!text) throw new Error("No text could be extracted from this file");

  return {
    title: titleFromName(file.name),
    text,
    source: file.name,
  };
}
