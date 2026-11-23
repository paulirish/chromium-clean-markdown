export interface DOMSnapshotNodeTree {
  parentIndex?: number[];
  nodeType?: number[];
  nodeName?: number[];
  nodeValue?: number[];
  backendNodeId?: number[];
  attributes?: number[][];
}

export interface DOMSnapshotDocument {
  nodes: DOMSnapshotNodeTree;
}

export interface DOMSnapshot {
  documents: DOMSnapshotDocument[];
  strings: string[];
}

export interface PreSemantics {
  language?: string;
  hasCodeLang?: boolean;
}

export interface NodeSemantics {
  pre?: PreSemantics;
  inlineCode: boolean;
  blockquoteIds: readonly number[];
}

const ROOT_SEMANTICS: NodeSemantics = {inlineCode: false, blockquoteIds: []};
const LANGUAGE_CLASS_RE = /\b(?:language|lang)-([a-zA-Z0-9_+#.-]+)\b/i;

function extractLanguage(attrPairs: number[] | undefined, strings: string[]): string | undefined {
  if (!attrPairs) return undefined;
  for (let i = 0; i < attrPairs.length; i += 2) {
    if (strings[attrPairs[i]] === 'class') {
      const match = LANGUAGE_CLASS_RE.exec(strings[attrPairs[i + 1]] ?? '');
      if (match) return match[1].toLowerCase();
    }
  }
  return undefined;
}

export function indexDomSnapshot(snapshot: DOMSnapshot): ReadonlyMap<number, NodeSemantics> {
  const strings = snapshot.strings ?? [];
  const byBackendId = new Map<number, NodeSemantics>();
  let nextBlockquoteId = 1;

  for (const doc of snapshot.documents ?? []) {
    const {nodes} = doc;
    if (!nodes) continue;

    const nodeNames = nodes.nodeName ?? [];
    const parentIndices = nodes.parentIndex ?? [];
    const backendNodeIds = nodes.backendNodeId ?? [];
    const attributes = nodes.attributes ?? [];
    const count = nodeNames.length;
    const resolved = new Array<NodeSemantics | undefined>(count);

    const resolve = (idx: number): NodeSemantics => {
      const cached = resolved[idx];
      if (cached) return cached;

      const parentIdx = parentIndices[idx];
      const parent =
        parentIdx !== undefined && parentIdx >= 0 && parentIdx < count
          ? resolve(parentIdx)
          : ROOT_SEMANTICS;

      const tag = (strings[nodeNames[idx]] ?? '').toUpperCase();
      const pre = parent.pre ?? (tag === 'PRE' ? {} : undefined);
      const inlineCode = !pre && (parent.inlineCode || tag === 'CODE');
      const blockquoteIds =
        tag === 'BLOCKQUOTE' ? [...parent.blockquoteIds, nextBlockquoteId++] : parent.blockquoteIds;

      if (pre && (tag === 'CODE' || tag === 'PRE')) {
        const lang = extractLanguage(attributes[idx], strings);
        if (lang && (tag === 'CODE' ? !pre.hasCodeLang : !pre.language)) {
          pre.language = lang;
          if (tag === 'CODE') pre.hasCodeLang = true;
        }
      }

      const sem: NodeSemantics = {pre, inlineCode, blockquoteIds};
      resolved[idx] = sem;

      const bid = backendNodeIds[idx];
      if (bid && bid > 0 && (pre || inlineCode || blockquoteIds.length > 0)) {
        byBackendId.set(bid, sem);
      }
      return sem;
    };

    for (let i = 0; i < count; i++) resolve(i);
  }

  return byBackendId;
}
