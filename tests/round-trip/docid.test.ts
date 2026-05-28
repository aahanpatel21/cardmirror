/**
 * docId round-trip — the Learn annotation layer's stable document identity
 * survives both formats (.cmir field, .docx docProps/custom.xml), and is
 * absent (null) on files that don't carry it.
 */

import { describe, expect, it } from 'vitest';
import { schema } from '../../src/schema/index.js';
import { serializeNative, parseNative } from '../../src/native/index.js';
import { toDocx } from '../../src/export/index.js';
import { fromDocxFull } from '../../src/import/index.js';

const DOC_ID = '8f3c2a10-0000-4000-8000-aabbccddeeff';

function sampleDoc() {
  return schema.nodes['doc']!.createChecked(null, [
    schema.nodes['paragraph']!.create(null, schema.text('Hello world.')),
  ]);
}

describe('docId — .cmir native', () => {
  it('round-trips when present', () => {
    const bytes = serializeNative(sampleDoc(), { docId: DOC_ID });
    expect(parseNative(bytes).docId).toBe(DOC_ID);
  });
  it('is null when not written', () => {
    expect(parseNative(serializeNative(sampleDoc())).docId).toBeNull();
  });
});

describe('docId — .docx docProps', () => {
  it('round-trips when present', async () => {
    const bytes = await toDocx(sampleDoc(), { docId: DOC_ID });
    expect((await fromDocxFull(bytes)).docId).toBe(DOC_ID);
  });
  it('is null when not written', async () => {
    const bytes = await toDocx(sampleDoc());
    expect((await fromDocxFull(bytes)).docId).toBeNull();
  });
});
