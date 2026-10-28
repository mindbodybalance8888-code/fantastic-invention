import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import { secretGet, secretSet } from '../api/backend'

// The ElevenLabs API key lives here and not in voiceStore: that store is
// persisted as plain choices and is guarded to hold nothing secret.
//
// Where the key is kept on disk:
//   • Windows / macOS desktop → the OS vault (Credential Manager / Keychain)
//     under the account below, once hydrateApiKey has confirmed the vault
//     works. localStorage then holds no key at all.
//   • Linux desktop and the web build → no vault, so the key stays in
//     localStorage under base64 obfuscation. That is obfuscation, not
//     encryption.
// The same fallback applies for the rest of the session if a vault write fails,
// so a locked or full vault can never silently drop the key.
// In memory the key is always held in the clear.

// The Rust allowlist (commands/secret.rs) is checked against this constant by a
// test, so the account name here and there cannot drift apart.
const ELEVENLABS_ACCOUNT = 'elevenlabs'

let keychainReady = false
let keychainFailed = false

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
  /** Load the key from the OS vault and move an old localStorage key into it. */
  hydrateApiKey: () => Promise<void>
}

export const useElevenLabsStore = create<ElevenLabsState>()(
  persist(
    (set, get) => ({
      apiKey: '',

      setApiKey: (key) => {
        set({ apiKey: key })
        if (!keychainReady) return
        keychainFailed = false
        // An empty value deletes the vault entry (Rust side).
        secretSet(ELEVENLABS_ACCOUNT, key).catch(() => {
          keychainFailed = true
          set((s) => ({ apiKey: s.apiKey })) // re-persist with the fallback retained
        })
      },

      hydrateApiKey: async () => {
        try {
          const stored = await secretGet(ELEVENLABS_ACCOUNT)
          // The first secretGet that RESOLVES (even with null) proves the vault
          // is usable here; a reject means no vault (web build, Linux).
          keychainReady = true
          if (stored) {
            set({ apiKey: stored })
            return
          }
          // Nothing in the vault yet: migrate a key saved by an earlier build.
          const existing = get().apiKey
          if (existing) {
            try {
              await secretSet(ELEVENLABS_ACCOUNT, existing)
            } catch {
              keychainFailed = true // keep the localStorage copy, no loss
            }
          }
          set((s) => ({ apiKey: s.apiKey })) // re-persist in the new mode
        } catch {
          // No vault here: stay on the obfuscated-localStorage path.
        }
      },
    }),
    {
      name: 'locally-uncensored-elevenlabs',
      storage: safeJSONStorage(),
      // With a working vault the key is kept out of localStorage entirely.
      partialize: (state) => ({
        apiKey: keychainReady && !keychainFailed ? '' : obfuscate(state.apiKey),
      }),
      merge: (persisted, current) => ({
        ...current,
        apiKey: deobfuscate((persisted as { apiKey?: string } | undefined)?.apiKey ?? ''),
      }),
    },
  ),
)
