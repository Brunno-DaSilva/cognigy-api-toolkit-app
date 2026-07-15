// Flow Search — pure indexing + search logic (no React, no network).
//
// The Cognigy "chart" response for a flow is:
//   { _id, relations: [...], nodes: [...] }
// where `nodes` is a FLAT array of every node and `relations` is a separate
// graph describing hierarchy:
//   { node, children: [childNodeId, ...], next: nextNodeId | null }
//   - children = nested nodes (e.g. Then/Else under an If)
//   - next     = the sequential successor at the SAME level (a sibling)
//
// flattenFlow() turns one chart into a flat array of searchable node records,
// reconstructing each node's breadcrumb path from `relations` and extracting
// searchable text from the node's label, comment, mock code and (type-dependent)
// `preview`. See docs/flow-search-api-reference.md for the response shape.

// Friendly field name for a node whose `preview` is a bare string.
const PREVIEW_FIELD_BY_TYPE = {
  addToContext: "context path",
  removeFromContext: "context path",
  completeGoal: "goal",
  aiAgentJobTool: "tool",
  aiAgentToolAnswer: "instructions",
  goTo: "reference",
  executeFlow: "reference",
  aiAgentHandover: "reference",
  sleep: "duration",
};

const unique = (arr) => [...new Set(arr)];

// Recursively collect every string/number leaf from an arbitrary value. Used to
// build an exhaustive searchable blob so no configured text is ever missed,
// regardless of how deeply Cognigy nests it (SSML voice config, rule objects…).
function deepStrings(val, out = []) {
  if (val == null) return out;
  const t = typeof val;
  if (t === "string") {
    const s = val.trim();
    if (s) out.push(s);
  } else if (t === "number") {
    out.push(String(val));
  } else if (Array.isArray(val)) {
    for (const v of val) deepStrings(v, out);
  } else if (t === "object") {
    for (const k of Object.keys(val)) deepStrings(val[k], out);
  }
  return out;
}

// Build the per-field breakdown (used to show WHICH field matched) plus the
// cross-flow reference, if any. Returns { fields, refs }.
function extractFields(node) {
  const fields = [];
  const add = (field, text) => {
    if (text == null) return;
    const s = String(text).trim();
    if (s) fields.push({ field, text: s });
  };

  add("name", node.label);
  add("comment", node.comment);
  if (node.mock && node.mock.code) add("mock code", node.mock.code);

  let refs = null;
  const p = node.preview;

  if (typeof p === "string") {
    add(PREVIEW_FIELD_BY_TYPE[node.type] || "value", p);
  } else if (typeof p === "number") {
    add("duration", String(p));
  } else if (p && typeof p === "object") {
    if (Array.isArray(p.text)) add("text", p.text.filter(Boolean).join(" | "));
    if (typeof p.data === "string" && p.data && p.data !== "{}") add("data", p.data);
    if (typeof p.condition === "string" && p.condition) add("condition", p.condition);
    if (p.rule && typeof p.rule === "object") {
      const { left, operand, right } = p.rule;
      if (left != null || right != null) {
        add("rule", `${left ?? ""} ${operand ?? ""} ${right ?? ""}`.trim());
      }
    }
    if (p.flow || p.node) {
      refs = { flow: p.flow || null, node: p.node || null };
      add("reference", `flow:${p.flow || ""}${p.node ? " node:" + p.node : ""}`);
    }
    if (p.aiAgentName || p.keyValue) {
      add("agent", [p.aiAgentName, p.keyValue].filter(Boolean).join(" — "));
    }
    // Voice / SSML channel overrides live under nested _cognigy / _data blobs.
    const voice = unique([...deepStrings(p._cognigy), ...deepStrings(p._data)]);
    if (voice.length) add("voice", voice.join(" | "));
  }

  return { fields, refs };
}

// Turn one node + its computed breadcrumb into a searchable record.
function buildRecord(node, path, meta) {
  const { fields, refs } = extractFields(node);

  // Exhaustive text: the named fields plus a deep sweep of `preview`, so search
  // catches anything the named extractors didn't explicitly pull out.
  const searchableText = unique([
    ...fields.map((f) => f.text),
    ...deepStrings(node.preview),
  ]).join("\n");

  return {
    flowId: meta.flowId ?? null,
    flowName: meta.flowName ?? null,
    nodeId: node._id,
    referenceId: node.referenceId ?? null,
    nodeName: node.label ?? "",
    nodeType: node.type ?? "",
    disabled: !!node.isDisabled,
    isEntryPoint: !!node.isEntryPoint,
    path,
    refs,
    fields,
    searchableText,
    searchableLower: searchableText.toLowerCase(),
  };
}

/**
 * Flatten one Cognigy flow chart into an array of searchable node records.
 *
 * @param {object} chart - the chart response ({ _id, relations, nodes }).
 * @param {object} [meta] - { flowId, flowName } stamped onto every record.
 * @returns {Array<object>} one record per node in `chart.nodes`.
 */
export function flattenFlow(chart, meta = {}) {
  if (!chart || !Array.isArray(chart.nodes)) return [];
  const nodes = chart.nodes;
  const relations = Array.isArray(chart.relations) ? chart.relations : [];

  const nodeById = new Map(nodes.map((n) => [n._id, n]));
  const relByNode = new Map(relations.map((r) => [r.node, r]));
  const labelOf = (id) => nodeById.get(id)?.label ?? "";

  // A node is "targeted" if something reaches it via children or next. The roots
  // of the graph are relation nodes nothing points at (the top-level chain heads).
  const targeted = new Set();
  for (const r of relations) {
    if (Array.isArray(r.children)) for (const c of r.children) targeted.add(c);
    if (r.next) targeted.add(r.next);
  }

  const pathById = new Map();
  const visited = new Set();

  // Walk a chain: follow `next` iteratively (same path, avoids deep recursion on
  // long linear flows) and recurse into `children` (one level deeper each time).
  const walk = (startId, path) => {
    let id = startId;
    while (id != null && !visited.has(id)) {
      visited.add(id);
      pathById.set(id, path);
      const r = relByNode.get(id);
      if (!r) break;
      if (Array.isArray(r.children) && r.children.length) {
        const childPath = [...path, labelOf(id)];
        for (const c of r.children) walk(c, childPath);
      }
      id = r.next;
    }
  };

  for (const r of relations) {
    if (!targeted.has(r.node)) walk(r.node, []);
  }
  // Pick up any disconnected sub-chains not reached from a clean root.
  for (const r of relations) if (!visited.has(r.node)) walk(r.node, []);

  return nodes.map((n) => buildRecord(n, pathById.get(n._id) || [], meta));
}

// ── Search ──────────────────────────────────────────────────────────────────

// Locate the first match of `query` (already lowercased) or `re` in `text`.
function findFirst(text, query, re) {
  if (re) {
    re.lastIndex = 0;
    const m = re.exec(text);
    return m ? { index: m.index, length: m[0].length } : null;
  }
  const idx = text.toLowerCase().indexOf(query);
  return idx === -1 ? null : { index: idx, length: query.length };
}

// Build a { before, match, after } snippet (~45 chars either side) preserving
// the ORIGINAL casing, with ellipses when the text is clipped.
function snippetAround(text, index, length, radius = 45) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, end) + (end < text.length ? "…" : ""),
  };
}

/**
 * Search flattened records.
 *
 * @param {Array<object>} records - output of flattenFlow (across flows).
 * @param {string} rawQuery
 * @param {object} [opts] - { regex, nodeTypes: string[], flowIds: string[] }
 * @returns {{ groups: Array, total: number, error: string|null }}
 *   groups are per-flow: { flowId, flowName, results: [record + fieldMatches] }
 */
export function searchRecords(records, rawQuery, opts = {}) {
  const query = (rawQuery || "").trim();
  if (!query) return { groups: [], total: 0, error: null };

  const { regex = false, nodeTypes = null, flowIds = null } = opts;

  let re = null;
  if (regex) {
    try {
      re = new RegExp(query, "gi");
    } catch (e) {
      return { groups: [], total: 0, error: e.message };
    }
  }
  const q = query.toLowerCase();
  const typeSet = nodeTypes && nodeTypes.length ? new Set(nodeTypes) : null;
  const flowSet = flowIds && flowIds.length ? new Set(flowIds) : null;

  const matched = [];
  for (const rec of records) {
    if (typeSet && !typeSet.has(rec.nodeType)) continue;
    if (flowSet && !flowSet.has(rec.flowId)) continue;

    const fieldMatches = [];
    for (const f of rec.fields) {
      const hit = findFirst(f.text, q, re);
      if (hit) {
        fieldMatches.push({
          field: f.field,
          snippet: snippetAround(f.text, hit.index, hit.length),
        });
      }
    }
    // Matched somewhere in the deep content but not in a named field.
    if (!fieldMatches.length) {
      const hit = findFirst(rec.searchableText, q, re);
      if (hit) {
        fieldMatches.push({
          field: "content",
          snippet: snippetAround(rec.searchableText, hit.index, hit.length),
        });
      }
    }
    if (fieldMatches.length) matched.push({ ...rec, fieldMatches });
  }

  const groupsMap = new Map();
  for (const m of matched) {
    const key = m.flowId || m.flowName || "unknown";
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { flowId: m.flowId, flowName: m.flowName, results: [] });
    }
    groupsMap.get(key).results.push(m);
  }
  const groups = [...groupsMap.values()].sort((a, b) =>
    (a.flowName || "").localeCompare(b.flowName || ""),
  );

  return { groups, total: matched.length, error: null };
}

/**
 * Distinct node types + flows present in an index, for filter UIs.
 * @returns {{ nodeTypes: Array<{type,count}>, flows: Array<{flowId,flowName,count}> }}
 */
export function indexFacets(records) {
  const types = new Map();
  const flows = new Map();
  for (const r of records) {
    types.set(r.nodeType, (types.get(r.nodeType) || 0) + 1);
    if (r.flowId) {
      const cur = flows.get(r.flowId);
      flows.set(r.flowId, {
        flowId: r.flowId,
        flowName: r.flowName,
        count: (cur?.count || 0) + 1,
      });
    }
  }
  return {
    nodeTypes: [...types.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    flows: [...flows.values()].sort((a, b) =>
      (a.flowName || "").localeCompare(b.flowName || ""),
    ),
  };
}
