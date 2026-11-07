import { afterEach, describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { applySetup, missingSetup, nothingMissing, vaultMissing } from '../src/vault/editorSetup'
import { DEFAULT_LAYOUT, setLayout } from '../src/wiki/layout'

afterEach(() => setLayout(DEFAULT_LAYOUT))

describe('the wiki’s Obsidian settings on an older vault (#6)', () => {
  it('finds the raw tree missing from the excluded files, with or without its slash', () => {
    expect(missingSetup(['*.json'], () => 'checkbox').raw).toBe(true)
    expect(missingSetup(['*.json', '_raw/'], () => 'checkbox').raw).toBe(false)
    expect(missingSetup(['_raw'], () => 'checkbox').raw).toBe(false)
    expect(missingSetup(undefined, () => 'checkbox').raw).toBe(true)
    setLayout({ raw: 'captures' })
    expect(missingSetup(['_raw/'], () => 'checkbox').raw).toBe(true)
  })

  it('types only the boxes no one typed: a key a person made text stays text', () => {
    const types: Record<string, string> = { Draft: 'text' }
    expect(missingSetup(['_raw/'], (k) => types[k]).boxes).toEqual(['Archive', 'done'])
    expect(nothingMissing(missingSetup(['_raw/'], () => 'checkbox'))).toBe(true)
  })

  it('adds the raw tree and the checkbox types through Obsidian, keeping what is there', () => {
    const config: Record<string, unknown> = { userIgnoreFilters: ['*.json'] }
    const set: Record<string, string> = { done: 'checkbox' }
    const app = {
      vault: { getConfig: (k: string) => config[k], setConfig: (k: string, v: unknown) => (config[k] = v) },
      metadataTypeManager: { getAssignedType: (k: string) => set[k] ?? null, setType: (k: string, t: string) => (set[k] = t) },
    } as unknown as App
    expect(vaultMissing(app)).toEqual({ raw: true, boxes: ['Draft', 'Archive'] })
    expect(applySetup(app)).toBe('_raw/ excluded from search and the graph; Draft, Archive shown as checkboxes')
    expect(config.userIgnoreFilters).toEqual(['*.json', '_raw/'])
    expect(set).toEqual({ done: 'checkbox', Draft: 'checkbox', Archive: 'checkbox' })
    expect(nothingMissing(vaultMissing(app)!)).toBe(true)
  })

  it('offers nothing where Obsidian exposes neither part', () => {
    expect(vaultMissing({ vault: {} } as unknown as App)).toBeNull()
  })
})
