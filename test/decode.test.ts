import test from 'node:test';
import assert from 'node:assert';
import {fromJson, toBinary} from '@bufbuild/protobuf';
import type {JsonValue} from '@bufbuild/protobuf';
import {AnnotatedPageContentSchema, ContentAttributeType} from '../src/proto/common_quality_data_pb.js';
import {decodeAnnotatedPageContent, convertToMarkdown} from '../src/decode.ts';
import type {ConvertToMarkdownOptions, DOMSnapshot} from '../src/decode.ts';

const {
  CONTENT_ATTRIBUTE_TEXT,
  CONTENT_ATTRIBUTE_IMAGE,
  CONTENT_ATTRIBUTE_IFRAME,
  CONTENT_ATTRIBUTE_MATH,
  CONTENT_ATTRIBUTE_CONTAINER,
  CONTENT_ATTRIBUTE_PARAGRAPH,
} = ContentAttributeType;

function getMarkdown(payload: JsonValue, options?: ConvertToMarkdownOptions): string {
  const buffer = toBinary(AnnotatedPageContentSchema, fromJson(AnnotatedPageContentSchema, payload));
  const base64 = Buffer.from(buffer).toString('base64');
  const decoded = decodeAnnotatedPageContent(base64);
  return convertToMarkdown(decoded, options);
}

test('Decoding base64 string into AnnotatedPageContent object', () => {
  const payload: JsonValue = {
    version: 1,
    rootNode: {},
  };

  const buffer = toBinary(AnnotatedPageContentSchema, fromJson(AnnotatedPageContentSchema, payload));
  const base64 = Buffer.from(buffer).toString('base64');

  const decoded = decodeAnnotatedPageContent(base64);

  assert.strictEqual(decoded.version, 1);
  assert.ok(decoded.rootNode !== undefined);
});

test('convertToMarkdown skips nodes and children if isAdRelated is true', () => {
  const payload: JsonValue = {
    rootNode: {
      childrenNodes: [
        {
          contentAttributes: {
            attributeType: CONTENT_ATTRIBUTE_TEXT,
            textData: {textContent: 'Non-ad content.'},
          },
        },
        {
          contentAttributes: {
            attributeType: ContentAttributeType.CONTENT_ATTRIBUTE_CONTAINER,
            isAdRelated: true,
          },
          childrenNodes: [
            {
              contentAttributes: {
                attributeType: CONTENT_ATTRIBUTE_TEXT,
                textData: {textContent: 'Buy cheap things now!'},
              },
            },
          ],
        },
      ],
    },
  };
  const md = getMarkdown(payload);
  assert.strictEqual(md, 'Non-ad content.');
});

test('convertToMarkdown replaces a failed CodePen iframe with a link', () => {
  const payload: JsonValue = {
    rootNode: {
      childrenNodes: [
        {
          contentAttributes: {
            attributeType: CONTENT_ATTRIBUTE_IFRAME,
            iframeData: {
              frameData: {
                url: 'https://codepen.io/example/embed/preview/bJOrK?editable=true',
                title: 'codepen.io',
              },
            },
          },
          childrenNodes: [
            {
              contentAttributes: {
                attributeType: CONTENT_ATTRIBUTE_IMAGE,
                imageData: {},
              },
            },
            {
              contentAttributes: {
                attributeType: CONTENT_ATTRIBUTE_TEXT,
                textData: {textContent: 'codepen.io'},
              },
            },
            {
              contentAttributes: {
                attributeType: CONTENT_ATTRIBUTE_TEXT,
                textData: {textContent: ' refused to connect.'},
              },
            },
          ],
        },
      ],
    },
  };

  assert.strictEqual(
    getMarkdown(payload),
    '[Link to codepen.io embed](https://codepen.io/example/embed/preview/bJOrK?editable=true)',
  );
});

test('convertToMarkdown emits strippedMathml and skips fallback text descendants', () => {
  const payload: JsonValue = {
    rootNode: {
      childrenNodes: [
        {
          contentAttributes: {
            attributeType: CONTENT_ATTRIBUTE_MATH,
            mathData: {
              strippedMathml: '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
              isBlock: false,
            },
          },
          childrenNodes: [
            {
              contentAttributes: {
                attributeType: CONTENT_ATTRIBUTE_TEXT,
                textData: {textContent: 'ab'},
              },
            },
          ],
        },
      ],
    },
  };

  assert.strictEqual(getMarkdown(payload), '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>');
});

test('convertToMarkdown falls back to math descendants when strippedMathml is unset', () => {
  const payload: JsonValue = {
    rootNode: {
      childrenNodes: [
        {
          contentAttributes: {
            attributeType: CONTENT_ATTRIBUTE_MATH,
            mathData: {
              isBlock: true,
            },
          },
          childrenNodes: [
            {
              contentAttributes: {
                attributeType: CONTENT_ATTRIBUTE_TEXT,
                textData: {textContent: 'x + y'},
              },
            },
          ],
        },
      ],
    },
  };

  assert.strictEqual(getMarkdown(payload), 'x + y');
});

test('convertToMarkdown uses domSnapshot for inline code, fenced pre with language, and nested blockquotes', () => {
  // Synthetic DOMSnapshot matching CDP DOMSnapshot.captureSnapshot structure:
  // 0: MAIN (bid=1)
  // 1: P (bid=2) -> 2: #text (bid=3), 3: CODE (bid=4) -> 4: #text (bid=5)
  // 5: PRE (bid=6) -> 6: CODE.language-typescript (bid=7) -> 7: #text (bid=8), 8: #text (bid=9)
  // 9: PRE (bid=10) -> 10: #text (bid=11)  [second adjacent pre]
  // 11: BLOCKQUOTE (bid=12) -> 12: P (bid=13) -> 13: #text (bid=14)
  //                         -> 14: P (bid=15) -> 15: #text (bid=16)
  //                         -> 16: BLOCKQUOTE (bid=17) -> 17: P (bid=18) -> 18: #text (bid=19)
  const strings = ['MAIN', 'P', '#text', 'CODE', 'PRE', 'class', 'language-typescript', 'BLOCKQUOTE'];
  const domSnapshot: DOMSnapshot = {
    strings,
    documents: [{
      nodes: {
        parentIndex: [-1, 0, 1, 1, 3, 0, 5, 6, 6, 0, 9, 0, 11, 12, 11, 14, 11, 16, 17],
        nodeName:    [ 0, 1, 2, 3, 2, 4, 3, 2, 2, 4, 2, 7,  1,  2,  1,  2,  7,  1,  2],
        backendNodeId: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        attributes:  [[], [], [], [], [], [], [5, 6], [], [], [], [], [], [], [], [], [], [], [], []],
      },
    }],
  };

  // Deliberately collapse the CODE, PRE, and outer BLOCKQUOTE wrappers in APC
  // (matching what Chromium's AIPageContentAgent does in practice).
  const payload: JsonValue = {
    rootNode: {
      contentAttributes: {attributeType: CONTENT_ATTRIBUTE_CONTAINER, commonAncestorDomNodeId: 1},
      childrenNodes: [
        {
          contentAttributes: {attributeType: CONTENT_ATTRIBUTE_PARAGRAPH, commonAncestorDomNodeId: 2},
          childrenNodes: [
            {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 3, textData: {textContent: 'Use '}}},
            {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 5, textData: {textContent: 'domSnapshot'}}},
          ],
        },
        {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 8, textData: {textContent: 'const x = 1;\n'}}},
        {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 9, textData: {textContent: 'const y = 2;'}}},
        {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 11, textData: {textContent: '```nested```'}}},
        {
          contentAttributes: {attributeType: CONTENT_ATTRIBUTE_PARAGRAPH, commonAncestorDomNodeId: 13},
          childrenNodes: [
            {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 14, textData: {textContent: 'First quote.'}}},
          ],
        },
        {
          contentAttributes: {attributeType: CONTENT_ATTRIBUTE_PARAGRAPH, commonAncestorDomNodeId: 15},
          childrenNodes: [
            {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 16, textData: {textContent: 'Second quote.'}}},
          ],
        },
        {
          contentAttributes: {attributeType: CONTENT_ATTRIBUTE_PARAGRAPH, commonAncestorDomNodeId: 18},
          childrenNodes: [
            {contentAttributes: {attributeType: CONTENT_ATTRIBUTE_TEXT, commonAncestorDomNodeId: 19, textData: {textContent: 'Nested quote.'}}},
          ],
        },
      ],
    },
  };

  const md = getMarkdown(payload, {domSnapshot});
  assert.strictEqual(
    md,
    [
      'Use `domSnapshot`',
      '',
      '```typescript',
      'const x = 1;',
      'const y = 2;',
      '```',
      '',
      '````',
      '```nested```',
      '````',
      '',
      '> First quote.',
      '>',
      '> Second quote.',
      '>',
      '> > Nested quote.',
    ].join('\n'),
  );
});
