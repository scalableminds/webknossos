import path from "node:path";
import { gzipSync } from "node:zlib";
import type { OutputBundle, OutputChunk, Plugin } from "vite";

/**
 * Fails the production build if code that should only load with the annotation viewer ends up
 * in the initial payload of every page, or if that payload grows beyond its budget.
 *
 * The viewer is the only lazy boundary (see viewer/viewer_entry.ts). What keeps the Model, the
 * sagas and three.js out of the login page and the dashboard is not that boundary, but the
 * absence of any static import edge from non-viewer code into them. A single such edge undoes
 * it: one dashboard import of skeletontracing_accessor used to pull all of three.js into every
 * page. Nothing fails and nothing warns, the entry chunk simply gets bigger again.
 *
 * "Initial payload" is what the browser fetches before rendering any page: the entry chunk,
 * every chunk it statically imports (Vite emits a `modulepreload` for each of them) and their
 * CSS. The size of the entry chunk alone that Vite prints is not a useful measure.
 *
 * Three checks, from most to least specific:
 *   1. Each lazy entry must still be emitted as a dynamic chunk outside the initial payload.
 *   2. No forbidden module may be part of the initial payload. A failure names the shortest
 *      static import chain from the entry, which ends at the edge worth cutting.
 *   3. The gzipped initial payload must stay within its budget. This catches creep that no
 *      rule anticipates.
 */

type ForbiddenEntry = readonly [label: string, pattern: RegExp];

export type CodeSplittingOptions = {
  /** Repo-relative path of the application entry, e.g. `frontend/javascripts/main.tsx`. */
  entry: string;
  /** Repo-relative paths of modules that must be loaded via a dynamic `import()`. */
  lazyEntries: ReadonlyArray<string>;
  forbiddenInInitialPayload: ReadonlyArray<ForbiddenEntry>;
  /** Maximum gzipped size of the initial payload (JS + CSS) in kB (1 kB = 1000 bytes). */
  initialPayloadBudgetKb: number;
};

/** Strips the absolute prefix so failures read as repo-relative paths. */
function shorten(moduleId: string): string {
  const normalized = moduleId.split(path.sep).join("/");
  const marker = normalized.lastIndexOf("node_modules/");
  if (marker !== -1) {
    return normalized.slice(marker);
  }
  const relative = normalized.indexOf("frontend/javascripts/");
  return relative === -1 ? normalized : normalized.slice(relative);
}

/** A module is bundled into exactly one chunk. */
function findChunkContaining(bundle: OutputBundle, modulePath: string): OutputChunk | undefined {
  const absolute = path.resolve(modulePath);
  return Object.values(bundle).find(
    (output): output is OutputChunk =>
      output.type === "chunk" && output.moduleIds.includes(absolute),
  );
}

/** The entry chunk plus the closure of its static chunk imports. */
function collectInitialChunks(bundle: OutputBundle, entryChunk: OutputChunk): OutputChunk[] {
  const chunks = new Map<string, OutputChunk>([[entryChunk.fileName, entryChunk]]);
  const queue = [entryChunk];
  while (queue.length > 0) {
    const chunk = queue.shift() as OutputChunk;
    for (const fileName of chunk.imports) {
      const imported = bundle[fileName];
      if (imported?.type === "chunk" && !chunks.has(fileName)) {
        chunks.set(fileName, imported);
        queue.push(imported);
      }
    }
  }
  return [...chunks.values()];
}

function gzippedSize(source: string | Uint8Array): number {
  return gzipSync(source, { level: 9 }).length;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })} kB`;
}

export default function assertCodeSplitting(options: CodeSplittingOptions): Plugin {
  return {
    name: "assert-code-splitting",
    apply: "build",
    // Run after Vite has minified the chunks and attached their CSS, so that the measured
    // sizes match what is served.
    enforce: "post",
    generateBundle(_outputOptions, bundle) {
      const entryChunk = findChunkContaining(bundle, options.entry);
      if (entryChunk == null) {
        this.error(`Could not find the chunk of the entry ${options.entry}.`);
      }

      const initialChunks = collectInitialChunks(bundle, entryChunk);
      const initialModules = new Set(initialChunks.flatMap((chunk) => chunk.moduleIds));
      const problems: string[] = [];

      // Shortest static import chains from the entry, so a finding can name the edge that
      // pulled a module in. Dynamic imports are not followed: they are not part of the payload.
      const entryId = path.resolve(options.entry);
      const parents = new Map<string, string | null>([[entryId, null]]);
      const queue = [entryId];
      while (queue.length > 0) {
        const moduleId = queue.shift() as string;
        for (const imported of this.getModuleInfo(moduleId)?.importedIds ?? []) {
          if (!parents.has(imported)) {
            parents.set(imported, moduleId);
            queue.push(imported);
          }
        }
      }
      const chainTo = (moduleId: string): string[] => {
        const chain: string[] = [];
        for (let id: string | null | undefined = moduleId; id != null; id = parents.get(id)) {
          chain.unshift(id);
        }
        return chain;
      };

      // 1. The lazy boundaries still exist.
      const leakedLazyIds = new Set<string>();
      for (const lazyEntry of options.lazyEntries) {
        const lazyId = path.resolve(lazyEntry);
        if (initialModules.has(lazyId)) {
          leakedLazyIds.add(lazyId);
          problems.push(
            `${lazyEntry} is part of the initial payload, imported via:\n      ${chainTo(lazyId)
              .map(shorten)
              .join("\n        -> ")}`,
          );
        } else if (findChunkContaining(bundle, lazyEntry)?.isDynamicEntry !== true) {
          problems.push(`${lazyEntry} is no longer emitted as a dynamically imported chunk.`);
        }
      }

      // 2. No forbidden module in the initial payload. Per rule, report only the module closest
      // to the entry: its chain cannot pass through another match of the same rule, so it ends
      // at the boundary instead of somewhere deep inside, e.g., three.js.
      for (const [label, pattern] of options.forbiddenInInitialPayload) {
        const matches = [...initialModules].filter((moduleId) => pattern.test(moduleId));
        if (matches.length === 0) {
          continue;
        }
        const chains = matches.map(chainTo);
        const shortest = chains.reduce((best, chain) =>
          // Modules that no static chain reaches (chunk merging) have a chain of length 1.
          (chain.length > 1 && chain.length < best.length) || best.length === 1 ? chain : best,
        );
        if (shortest.some((moduleId) => leakedLazyIds.has(moduleId))) {
          // A consequence of a leaked lazy entry, which is already reported above.
          continue;
        }
        const via =
          shortest.length > 1
            ? `imported via:\n      ${shortest.map(shorten).join("\n        -> ")}`
            : `placed into an initial chunk without a static import chain: ${shorten(shortest[0])}`;
        const count = matches.length === 1 ? "1 module" : `${matches.length} modules`;
        problems.push(`${label} (${count}) is part of the initial payload, ${via}`);
      }

      // 3. The budget.
      let jsBytes = 0;
      const cssFiles = new Set<string>();
      for (const chunk of initialChunks) {
        jsBytes += gzippedSize(chunk.code);
        for (const cssFile of chunk.viteMetadata?.importedCss ?? []) {
          cssFiles.add(cssFile);
        }
      }
      let cssBytes = 0;
      for (const cssFile of cssFiles) {
        const asset = bundle[cssFile];
        if (asset?.type === "asset") {
          cssBytes += gzippedSize(asset.source);
        }
      }
      const totalBytes = jsBytes + cssBytes;
      const budgetBytes = options.initialPayloadBudgetKb * 1000;
      const summary =
        `initial payload: ${formatKb(totalBytes)} gzip (${formatKb(jsBytes)} JS in ` +
        `${initialChunks.length} chunks + ${formatKb(cssBytes)} CSS), ` +
        `budget ${formatKb(budgetBytes)}`;

      if (totalBytes > budgetBytes) {
        problems.push(
          `The ${summary}.\n    If the growth is intended (e.g. a new dependency that every ` +
            "page needs), raise `initialPayloadBudgetKb` in vite.config.ts.",
        );
      }

      if (problems.length > 0) {
        this.error(
          `The code splitting regressed.\n\n  ${problems.join("\n\n  ")}\n\n` +
            "Break the import edge shown above rather than relaxing the rules: move the helper " +
            "that non-viewer code needs into a module without heavy dependencies, or import it " +
            "dynamically if the call site is already async and rare. Do not add new lazy routes " +
            "for this. See viewer/viewer_entry.ts.",
        );
      }

      this.info(summary);
    },
  };
}
