// The plugin calls `window.setTimeout`, as Obsidian asks for popout windows. Node has no window;
// here it is the global object, so the timers are Node's and the tests' fake timers still apply.
;(globalThis as { window?: unknown }).window ??= globalThis
