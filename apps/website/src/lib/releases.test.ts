import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseRelease } from './releases'

describe('GitHub release data', () => {
  test('keeps published asset links for this repository', () => {
    const result = parseRelease({
      tag_name: 'v1.2.3',
      assets: [
        {
          name: 'agent-terminal-amd64.AppImage',
          browser_download_url:
            'https://github.com/DaniAkash/agent-terminal/releases/download/v1.2.3/agent-terminal-amd64.AppImage',
        },
        { name: 'other', browser_download_url: 'https://example.com/other' },
      ],
    })
    assert.equal(result?.version, 'v1.2.3')
    assert.equal(result?.assets.length, 1)
  })

  test('rejects malformed releases', () => {
    assert.equal(parseRelease(null), null)
    assert.equal(parseRelease({ tag_name: '', assets: [] }), null)
    assert.equal(parseRelease({ tag_name: 'v1', assets: null }), null)
  })
})
