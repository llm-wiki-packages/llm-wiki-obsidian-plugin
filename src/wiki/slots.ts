// What a credential slot key means to a person. The manifest says `file`, `dir`, `env.NAME`; the screen never should.

export interface SlotWords {
  /** The noun on a row: "Token or key". */
  label: string
  /** The sentence in the dialog: "a token or key". */
  what: string
  kind: 'value' | 'dir'
  /** The default credential name's tail: `<skill>-token`. */
  suffix: string
}

export function slotWords(slot: string): SlotWords {
  if (slot === 'file') return { label: 'Token or key', what: 'a token or key', kind: 'value', suffix: 'token' }
  if (slot === 'dir') return { label: 'Folder (browser profile or cookie jar)', what: 'a folder on this machine, such as a signed-in browser profile', kind: 'dir', suffix: 'profile' }
  if (slot.startsWith('env.')) {
    const v = slot.slice(4)
    return { label: `${v} variable`, what: `the ${v} variable`, kind: 'value', suffix: v.toLowerCase() }
  }
  return { label: slot, what: `a credential (${slot})`, kind: 'value', suffix: slot }
}
