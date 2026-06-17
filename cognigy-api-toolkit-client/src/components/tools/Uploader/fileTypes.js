// Eligible upload types. The key is the extension; the value is the Cognigy
// `fileType` the upload endpoint expects — it must match the real file or the
// source is silently rejected. Mirrored server-side in the knowledge-upload
// Edge Function's ALLOWED_FILE_TYPES.
export const UPLOAD_FILE_TYPES = {
  ".ctxt": "ctxt",
  ".txt": "txt",
  ".pdf": "pdf",
};

export const UPLOAD_ACCEPT = Object.keys(UPLOAD_FILE_TYPES).join(",");

const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

// Returns the Cognigy fileType for a filename, or null if unsupported.
export const fileTypeFor = (name) => UPLOAD_FILE_TYPES[extOf(name)] ?? null;
