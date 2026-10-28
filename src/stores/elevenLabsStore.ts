import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'

// The ElevenLabs API key lives here and not in voiceStore: that store is
// persisted as plain choices and is guarded to hold nothing secret. This one
// keeps the key in memory in the clear and in localStorage only in the same
// base64 obfuscation the provider keys use when no OS vault is available. It is
// obfuscation, not encryption.

function obfuscate(key: string): string {
  if (!key) return ''
  try {
    return btoa(key.split('').reverse().join(''))
  } catch {
    return key
  }
}

function deobfuscate(encoded: string): string {
  if (!encoded) return ''
  try {
    return atob(encoded).split('').reverse().join('')
  } catch {
    return encoded
  }
}

interface ElevenLabsState {
  apiKey: string
  setApiKey: (key: string) => void
}

export const useElevenLabsStore = create<ElevenLabsState>()(
  persist(
    (set) => ({
      apiKey: '',
      setApiKey: (key) => set({ apiKey: key }),
    }),
    {
      name: 'locally-uncensored-elevenlabs',
      storage: safeJSONStorage(),
      partialize: (state) => ({ apiKey: obfuscate(state.apiKey) }),
      merge: (persisted, current) => ({
        ...current,
        apiKey: deobfuscate((persisted as { apiKey?: string } | undefined)?.apiKey ?? ''),
      }),
    },
  ),
)
