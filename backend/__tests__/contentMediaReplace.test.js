const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pathFromPublicUrl } = require('../src/services/contentService');

describe('pathFromPublicUrl', () => {
  it('extracts gallery object path from public URL', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/gallery/folder/hero.jpg?token=1';
    assert.equal(pathFromPublicUrl(url, 'gallery'), 'folder/hero.jpg');
  });

  it('returns null for other buckets or non-storage URLs', () => {
    assert.equal(pathFromPublicUrl('https://cdn.example/x.jpg', 'gallery'), null);
    assert.equal(
      pathFromPublicUrl(
        'https://abc.supabase.co/storage/v1/object/public/sponsors/a.png',
        'gallery',
      ),
      null,
    );
  });
});
