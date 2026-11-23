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

export interface DomSnapshotIndex {
  getOutermostPreId(backendNodeId: number | undefined): number | undefined;
  getPreLanguage(preBackendNodeId: number): string | undefined;
  isInlineCode(backendNodeId: number | undefined): boolean;
  getBlockquoteIds(backendNodeId: number | undefined): readonly number[];
}

interface NodeSemantics {
  outermostPreId: number | undefined;
  inCode: boolean;
  blockquoteIds: readonly number[];
}

const EMPTY_IDS: readonly number[] = [];
const LANGUAGE_CLASS_RE = /\b(?:language|lang)-([a-zA-Z0-9_+#.-]+)\b/i;

function extractLanguageFromAttributes(
  attrPairs: number[] | undefined,
  strings: string[],
): string | undefined {
  if (!attrPairs) return undefined;
  for (let i = 0; i < attrPairs.length; i += 2) {
    const name = strings[attrPairs[i]];
    if (name === 'class') {
      const value = strings[attrPairs[i + 1]] ?? '';
      const match = LANGUAGE_CLASS_RE.exec(value);
      if (match) return match[1].toLowerCase();
    }
  }
  return undefined;
}

export function buildDomSnapshotIndex(snapshot: DOMSnapshot): DomSnapshotIndex {
  const strings = snapshot.strings ?? [];
  const byBackendId = new Map<number, NodeSemantics>();
  const codeLangByPreId = new Map<number, string>();
  const preLangByPreId = new Map<number, string>();
  let syntheticIdCounter = -1;

  for (const doc of snapshot.documents ?? []) {
    const nodes = doc.nodes;
    if (!nodes) continue;

    const nodeNames = nodes.nodeName ?? [];
    const parentIndices = nodes.parentIndex ?? [];
    const backendNodeIds = nodes.backendNodeId ?? [];
    const attributes = nodes.attributes ?? [];
    const count = nodeNames.length;
    const resolved = new Array<NodeSemantics | undefined>(count);
    const visiting = new Uint8Array(count);

    const resolve = (idx: number): NodeSemantics => {
      const cached = resolved[idx];
      if (cached) return cached;
      if (visiting[idx]) {
        return {outermostPreId: undefined, inCode: false, blockquoteIds: EMPTY_IDS};
      }
      visiting[idx] = 1;

      const parentIdx = parentIndices[idx];
      const parent: NodeSemantics =
        parentIdx !== undefined && parentIdx >= 0 && parentIdx < count
          ? resolve(parentIdx)
          : {outermostPreId: undefined, inCode: false, blockquoteIds: EMPTY_IDS};

      const tag = (strings[nodeNames[idx]] ?? '').toUpperCase();
      const bid = backendNodeIds[idx];

      let outermostPreId = parent.outermostPreId;
      if (outermostPreId === undefined && tag === 'PRE') {
        outermostPreId = bid && bid > 0 ? bid : syntheticIdCounter--;
      }

      const inCode = parent.inCode || tag === 'CODE';

      let blockquoteIds = parent.blockquoteIds;
      if (tag === 'BLOCKQUOTE') {
        const bqId = bid && bid > 0 ? bid : syntheticIdCounter--;
        blockquoteIds = [...parent.blockquoteIds, bqId];
      }

      const sem: NodeSemantics = {outermostPreId, inCode, blockquoteIds};
      resolved[idx] = sem;
      visiting[idx] = 0;

      if (outermostPreId !== undefined && (tag === 'CODE' || tag === 'PRE')) {
        const lang = extractLanguageFromAttributes(attributes[idx], strings);
        if (lang) {
          if (tag === 'CODE' && !codeLangByPreId.has(outermostPreId)) {
            codeLangByPreId.set(outermostPreId, lang);
          } else if (tag === 'PRE' && !preLangByPreId.has(outermostPreId)) {
            preLangByPreId.set(outermostPreId, lang);
          }
        }
      }

      if (bid && bid > 0 && (outermostPreId !== undefined || inCode || blockquoteIds.length > 0)) {
        byBackendId.set(bid, sem);
      }

      return sem;
    };

    for (let i = 0; i < count; i++) {
      resolve(i);
    }
  }

  return {
    getOutermostPreId(backendNodeId) {
      if (backendNodeId === undefined) return undefined;
      return byBackendId.get(backendNodeId)?.outermostPreId;
    },
    getPreLanguage(preBackendNodeId) {
      return codeLangByPreId.get(preBackendNodeId) ?? preLangByPreId.get(preBackendNodeId);
    },
    isInlineCode(backendNodeId) {
      if (backendNodeId === undefined) return false;
      const sem = byBackendId.get(backendNodeId);
      return !!sem && sem.inCode && sem.outermostPreId === undefined;
    },
    getBlockquoteIds(backendNodeId) {
      if (backendNodeId === undefined) return EMPTY_IDS;
      return byBackendId.get(backendNodeId)?.blockquoteIds ?? EMPTY_IDS;
    },
  };
}
