import loadable from "libs/lazy_loader";
import { document } from "libs/window";
import { useEffect, useState } from "react";
import type { CommandPaletteProps } from "./command_palette";

const LazyCommandPalette = loadable<CommandPaletteProps>(() =>
  import("./command_palette").then((module) => ({ default: module.CommandPalette })),
);

// The palette is reachable only through ctrl+p / cmd+p, but react-command-palette, dompurify and
// the command definitions themselves add well over 100 kB to the bundle, and RootLayout renders
// the palette on every page. So only the shortcut stays in the initial payload; the palette is
// fetched the first time it is pressed and mounted with `openOnMount`, so that first press still
// opens it. From then on the palette binds the shortcut itself and this listener detaches.

type ShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

/**
 * Whether a keydown should open the command palette. The form-field check mirrors mousetrap's
 * default stopCallback, so that ctrl+p keeps its normal meaning while the user is typing -
 * exactly as it behaved when the palette was still mounted eagerly.
 */
export function shouldOpenCommandPalette(event: ShortcutEvent): boolean {
  const isPaletteShortcut =
    event.key.toLowerCase() === "p" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey;

  if (!isPaletteShortcut) {
    return false;
  }

  // Duck-typed rather than using instanceof, so this stays testable outside a DOM.
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (target?.isContentEditable) {
    return false;
  }

  return !["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName ?? "");
}

export function CommandPaletteLoader() {
  const [shouldMountPalette, setShouldMountPalette] = useState(false);

  useEffect(() => {
    if (shouldMountPalette) {
      // The palette itself now owns the shortcut.
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldOpenCommandPalette(event)) {
        return;
      }

      // Without this, the browser opens its print dialog instead.
      event.preventDefault();
      setShouldMountPalette(true);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shouldMountPalette]);

  if (!shouldMountPalette) {
    return null;
  }

  return <LazyCommandPalette openOnMount />;
}
