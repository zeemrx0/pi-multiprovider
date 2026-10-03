import type { Api, Credential, LoginOptions, Provider, ProviderAuthInteraction } from '@earendil-works/pi-ai'
import { initTheme, SettingsManager, type ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loginCredential, showLoginDialog } from '../src/multilogin.ts'

const credential: Credential = { type: 'oauth', access: 'test-access', refresh: 'test-refresh', expires: 60_000 }
const interaction: ProviderAuthInteraction = {
  signal: new AbortController().signal,
  notify() {},
  async prompt() { return 'test-code' },
}

function authProvider(login: (interaction: ProviderAuthInteraction, options?: LoginOptions) => Promise<Credential>) {
  return {
    id: 'openai', name: 'OpenAI',
    auth: { oauth: { login }, apiKey: { login } },
  } as unknown as Provider<Api>
}

function dialogContext(cwd = '/test-project') {
  return {
    cwd,
    ui: {
      custom: vi.fn(async factory => new Promise(resolve => {
        factory({ requestRender() {} } as TUI, {}, {}, resolve)
      })),
    },
  } as unknown as ExtensionContext
}

describe('OAuth login options', () => {
  beforeAll(() => initTheme())
  afterEach(() => vi.restoreAllMocks())

  it('forwards device-ID options unchanged to the OAuth login method', async () => {
    const login = vi.fn(async () => credential)
    const options: LoginOptions = { getDeviceId: () => 'test-device-id' }
    await expect(loginCredential(
      { provider: authProvider(login), authType: 'oauth' }, interaction, options,
    )).resolves.toBe(credential)
    expect(login).toHaveBeenCalledWith(interaction, options)
  })

  it('does not pass OAuth-only options to API-key login methods', async () => {
    const login = vi.fn(async () => ({ type: 'api_key' as const, key: 'test-key' }))
    await expect(loginCredential(
      { provider: authProvider(login), authType: 'api_key' }, interaction,
      { getDeviceId: () => { throw new Error('API-key login must not request a device ID') } },
    )).resolves.toEqual({ type: 'api_key', key: 'test-key' })
    expect(login).toHaveBeenCalledWith(interaction)
  })

  it('supplies a stable Pi device ID lazily when OpenAI requests one', async () => {
    const settings = SettingsManager.inMemory()
    const getDeviceId = vi.spyOn(settings, 'getOrCreateDeviceId').mockReturnValue('test-device-id')
    const create = vi.spyOn(SettingsManager, 'create').mockReturnValue(settings)
    const login = vi.fn(async (_interaction: ProviderAuthInteraction, options?: LoginOptions) => {
      expect(create).not.toHaveBeenCalled()
      expect(options?.getDeviceId?.()).toBe('test-device-id')
      expect(options?.getDeviceId?.()).toBe('test-device-id')
      return credential
    })
    await expect(showLoginDialog(dialogContext(), {
      provider: authProvider(login), authType: 'oauth',
    })).resolves.toEqual({ credential })
    expect(create).toHaveBeenCalledExactlyOnceWith('/test-project')
    expect(getDeviceId).toHaveBeenCalledTimes(2)
  })

  it('does not read settings for OAuth providers that do not request a device ID', async () => {
    const create = vi.spyOn(SettingsManager, 'create')
    await expect(showLoginDialog(dialogContext(), {
      provider: authProvider(async () => credential), authType: 'oauth',
    })).resolves.toEqual({ credential })
    expect(create).not.toHaveBeenCalled()
  })

  it('reports device-ID lookup failures through the existing dialog error result', async () => {
    const error = new Error('device ID unavailable')
    vi.spyOn(SettingsManager, 'create').mockImplementation(() => { throw error })
    await expect(showLoginDialog(dialogContext(), {
      provider: authProvider(async (_interaction, options) => {
        options?.getDeviceId?.()
        return credential
      }), authType: 'oauth',
    })).resolves.toEqual({ error })
  })
})
