import { describe, it, expect, vi } from 'vitest'
import { useElevenLabsStore } from '../elevenLabsStore'
import { useVoiceStore } from '../voiceStore'

describe('elevenLabsStore', () => {
  it('persists the key obfuscated, never in the clear', () => {
    useElevenLabsStore.getState().setApiKey('sk_test_123')
    const kept = useElevenLabsStore.persist.getOptions().partialize!(useElevenLabsStore.getState()) as { apiKey: string }
    expect(kept.apiKey).not.toBe('sk_test_123')
    expect(kept.apiKey).not.toContain('sk_test')
    expect(atob(kept.apiKey).split('').reverse().join('')).toBe('sk_test_123')
  })

  it('keeps the key out of the voice store', () => {
    const state = useVoiceStore.getState() as unknown as Record<string, unknown>
    expect(Object.keys(state).filter((k) => /apikey/i.test(k))).toEqual([])
    const kept = useVoiceStore.persist.getOptions().partialize!(useVoiceStore.getState()) as Record<string, unknown>
    expect(Object.keys(kept).filter((k) => /token|key|secret|session/i.test(k))).toEqual([])
  })
})

describe('elevenLabsStore failure paths', () => {
  it('merge survives a missing or corrupt stored value', () => {
    const merge = useElevenLabsStore.persist.getOptions().merge!
    const current = useElevenLabsStore.getState()
    expect(merge(undefined, current).apiKey).toBe('')
    expect(merge({ apiKey: '%%%not-base64%%%' }, current).apiKey).toBe('%%%not-base64%%%')
    expect(merge({}, current).apiKey).toBe('')
  })

  it('setting the key does not throw when localStorage is full', () => {
    const full = {
      getItem: () => null,
      removeItem: () => {},
      key: () => null,
      length: 0,
      clear: () => {},
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    }
    vi.stubGlobal('localStorage', full)
    try {
      expect(() => useElevenLabsStore.getState().setApiKey('k')).not.toThrow()
      expect(useElevenLabsStore.getState().apiKey).toBe('k')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
