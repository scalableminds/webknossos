import path from "node:path";
import type { Plugin } from "vite";

/**
 * Fails the production build if a web worker bundles main-thread UI code.
 *
 * This is not hypothetical: `async_get_maximum_zoom_for_all_mags.worker` used to ship
 * ~350 kB of react-dom, antd, @ant-design/cssinjs, stylis and @airbrake/browser - roughly
 * half its size - pulled in by a single static import edge:
 *
 *   worker -> flycam_accessor -> dataset_accessor -> libs/error_handling -> libs/toast -> antd
 *
 * Nothing failed and nothing warned. The worker just quietly got five times bigger, and a
 * pure-math worker paid for a UI framework it can never use (there is no DOM in a worker).
 *
 * Registered under `worker.plugins` rather than `plugins` in vite.config.ts, because Vite
 * bundles workers in a separate rolldown pass that top-level plugins never observe. Every
 * chunk in that pass belongs to a worker, so this does not need to filter by file name.
 */

type ForbiddenEntry = readonly [label: string, pattern: RegExp];

const FORBIDDEN_IN_WORKERS: ReadonlyArray<ForbiddenEntry> = [
  // UI frameworks. `react` is not listed separately: anything that drags in React also
  // drags in react-dom or antd, while matching bare `react/` would also flag the
  // react/jsx-runtime that tooling injects into any file containing JSX.
  ["antd", /node_modules\/(antd|@ant-design|@rc-component)\//],
  ["react-dom", /node_modules\/react-dom\//],
  // The repo-side boundary, and what actually leaked. Failing on these names the real
  // mistake one edge earlier than "somehow antd is in your worker": both modules exist to
  // show something to a user, so a worker importing either is already wrong.
  ["libs/toast", /[\\/]libs[\\/]toast\.[jt]sx?$/],
  ["libs/error_handling", /[\\/]libs[\\/]error_handling\.[jt]sx?$/],
];

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

/**
 * Walks the static import graph backwards from an offending module to the worker entry
 * that reaches it. Breadth-first, so the reported chain is the shortest one - which is
 * both the easiest to read and usually the edge worth cutting.
 */
function findImportChain(
  getModuleInfo: (id: string) => { importers: readonly string[] } | null,
  offendingModuleId: string,
): string[] {
  const queue: string[][] = [[offendingModuleId]];
  const visited = new Set<string>([offendingModuleId]);

  while (queue.length > 0) {
    const chain = queue.shift() as string[];
    const head = chain[0];

    if (/\.worker\.[jt]sx?$/.test(head)) {
      return chain;
    }

    for (const importer of getModuleInfo(head)?.importers ?? []) {
      if (visited.has(importer)) {
        continue;
      }
      visited.add(importer);
      queue.push([importer, ...chain]);
    }
  }

  // No path back to a worker entry (e.g. the module is only dynamically imported).
  // Reporting the module on its own is still actionable.
  return [offendingModuleId];
}

/**
 * Cuts the chain at the point it first enters the forbidden package. Without this, a leak
 * of antd reports whichever of its ~500 modules happened to be scanned first, ending in
 * something like `icons-svg/lib/asn/RightOutlined.js` - technically true, useless to read.
 */
function truncateAtBoundary(chain: string[], pattern: RegExp): string[] {
  const boundary = chain.findIndex((moduleId) => pattern.test(moduleId));
  return boundary === -1 ? chain : chain.slice(0, boundary + 1);
}

export default function assertWorkerPurity(): Plugin {
  return {
    name: "assert-worker-purity",
    apply: "build",
    generateBundle(_options, bundle) {
      // Grouped per worker per forbidden package: antd alone contributes hundreds of
      // modules, and repeating the same finding for each of them buries the diagnosis.
      const matches = new Map<
        string,
        { fileName: string; label: string; pattern: RegExp; moduleIds: string[] }
      >();

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") {
          continue;
        }

        for (const moduleId of chunk.moduleIds) {
          for (const [label, pattern] of FORBIDDEN_IN_WORKERS) {
            if (!pattern.test(moduleId)) {
              continue;
            }

            const key = `${chunk.fileName}|${label}`;
            const existing = matches.get(key);
            if (existing == null) {
              matches.set(key, { fileName: chunk.fileName, label, pattern, moduleIds: [moduleId] });
            } else {
              existing.moduleIds.push(moduleId);
            }
          }
        }
      }

      const findings = [...matches.values()].map(({ fileName, label, pattern, moduleIds }) => {
        // Of all the ways into the forbidden package, report the shortest - it is the one
        // whose edges a reader can actually act on.
        const chains = moduleIds.map((moduleId) =>
          truncateAtBoundary(
            findImportChain((id) => this.getModuleInfo(id), moduleId),
            pattern,
          ),
        );
        const shortest = chains.reduce((best, chain) =>
          chain.length < best.length ? chain : best,
        );
        return { fileName, label, chain: shortest };
      });

      // Shallowest first, so the outermost boundary - the edge actually worth cutting -
      // is the first thing printed rather than the deepest consequence of it.
      findings.sort((a, b) => a.chain.length - b.chain.length);

      const problems = findings.map(
        ({ fileName, label, chain }) =>
          `${fileName} bundles ${label}, imported via:\n      ${chain
            .map(shorten)
            .join("\n        -> ")}`,
      );

      if (problems.length > 0) {
        this.error(
          `Web workers must not bundle main-thread UI code.\n\n  ${problems.join("\n\n  ")}\n\n` +
            "Break the import edge shown above rather than widening the allowlist. If the code " +
            "is genuinely needed on both sides, split the part the worker needs into its own " +
            "module - see gpu_capability_check and libs/assertion for two worked examples.",
        );
      }
    },
  };
}
