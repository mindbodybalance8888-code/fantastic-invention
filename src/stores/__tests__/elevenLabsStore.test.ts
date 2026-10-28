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

// The vault paths. keychainReady/keychainFailed are module-level, so every test
// loads a fresh copy of the store against its own mock of the backend wrappers.
describe('elevenLabsStore with an OS vault', () => {
  async function load(vault: { get: () => Promise<string | null>; set: (a: string, v: string) => Promise<void> }) {
    vi.resetModules()
    const secretGet = vi.fn((_account: string) => vault.get())
    const secretSet = vi.fn((account: string, value: string) => vault.set(account, value))
    vi.doMock('../../api/backend', () => ({ secretGet, secretSet }))
    const { useElevenLabsStore } = await import('../elevenLabsStore')
    const persisted = () =>
      (useElevenLabsStore.persist.getOptions().partialize!(useElevenLabsStore.getState()) as { apiKey: string }).apiKey
    return { store: useElevenLabsStore, secretGet, secretSet, persisted }
  }

  it('takes the key from the vault and keeps it out of localStorage', async () => {
    const { store, secretGet, persisted } = await load({ get: async () => 'vault_key', set: async () => {} })
    await store.getState().hydrateApiKey()
    expect(secretGet).toHaveBeenCalledWith('elevenlabs')
    expect(store.getState().apiKey).toBe('vault_key')
    expect(persisted()).toBe('')
  })

  it('moves a key saved by an earlier build into the vault', async () => {
    const { store, secretSet, persisted } = await load({ get: async () => null, set: async () => {} })
    store.setState({ apiKey: 'old_local_key' })
    await store.getState().hydrateApiKey()
    expect(secretSet).toHaveBeenCalledWith('elevenlabs', 'old_local_key')
    expect(persisted()).toBe('')
    expect(store.getState().apiKey).toBe('old_local_key')
  })

  it('writes a new key to the vault, not to localStorage', async () => {
    const { store, secretSet, persisted } = await load({ get: async () => null, set: async () => {} })
    await store.getState().hydrateApiKey()
    store.getState().setApiKey('new_key')
    expect(secretSet).toHaveBeenCalledWith('elevenlabs', 'new_key')
    expect(persisted()).toBe('')
    expect(store.getState().apiKey).toBe('new_key')
  })

  it('keeps the obfuscated fallback when a vault write fails, so the key is not lost', async () => {
    const { store, persisted } = await load({ get: async () => null, set: async () => { throw new Error('locked') } })
    await store.getState().hydrateApiKey()
    store.getState().setApiKey('keep_me')
    await new Promise((r) => setTimeout(r, 0)) // let the rejected write settle
    expect(store.getState().apiKey).toBe('keep_me')
    expect(atob(persisted()).split('').reverse().join('')).toBe('keep_me')
  })

  it('stays on the obfuscated fallback when there is no vault', async () => {
    const { store, secretSet, persisted } = await load({ get: async () => { throw new Error('keychain unavailable') }, set: async () => {} })
    await store.getState().hydrateApiKey()
    store.getState().setApiKey('local_only')
    expect(secretSet).not.toHaveBeenCalled()
    expect(atob(persisted()).split('').reverse().join('')).toBe('local_only')
  })
})
