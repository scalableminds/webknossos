import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { AgglomerateMapping } from "./agglomerate_mapping_helper";

type RenderFormat = "dot" | "svg" | "png";

interface RenderOptions {
  outputPath?: string;
  format?: RenderFormat;
  rankdir?: "TB" | "LR";
}

export class MappingVisualizer {
  constructor(private readonly mapping: AgglomerateMapping) {}

  renderVersion(version: number, options: RenderOptions = {}): void {
    const { outputPath = `mapping_v${version}.svg`, format = "svg", rankdir = "LR" } = options;

    const dot = this.buildDot(version, rankdir);

    const outDir = path.dirname(outputPath);
    if (outDir && outDir !== ".") {
      mkdirSync(outDir, { recursive: true });
    }

    if (format === "dot") {
      writeFileSync(outputPath, dot, "utf8");
      return;
    }

    const dotPath = outputPath.replace(/\.(svg|png)$/, ".dot");
    writeFileSync(dotPath, dot, "utf8");

    execSync(`dot -T${format} "${dotPath}" -o "${outputPath}" && rm "${dotPath}"`);
  }

  /* ---------------- internal ---------------- */

  private buildDot(version: number, rankdir: "TB" | "LR"): string {
    const versionMap = this.mapping.getMap(version);

    const adjacencyList: Map<number, Set<number>> = this.mapping.getAdjacencyList(version);

    if (!adjacencyList) {
      throw new Error("MappingVisualizer requires access to adjacencyList (test-only).");
    }

    // group segmentIds by componentId
    const components = new Map<number, number[]>();
    for (const [segmentId, componentId] of versionMap.entries()) {
      if (!components.has(componentId)) components.set(componentId, []);
      components.get(componentId)!.push(segmentId);
    }

    const lines: string[] = [];

    lines.push("digraph G {");
    lines.push(`  rankdir=${rankdir};`);
    lines.push("  compound=true;");
    lines.push("  node [shape=circle, fontsize=10];");
    lines.push("  edge [fontsize=9];");
    lines.push("");

    // clusters per component
    for (const [componentId, segmentIds] of components.entries()) {
      lines.push(`  subgraph cluster_${componentId} {`);
      lines.push(`    label="Agglomerate ${componentId}";`);
      lines.push("    fontsize=12;");
      lines.push("    style=rounded;");

      for (const segmentId of segmentIds) {
        lines.push(`    ${segmentId};`);
      }

      lines.push("  }");
      lines.push("");
    }

    // directed edges (deduplicated)
    const seenEdges = new Set<string>();
    for (const [from, neighbors] of adjacencyList.entries()) {
      for (const to of neighbors) {
        const key = `${from}->${to}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        lines.push(`  ${from} -> ${to};`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }
}
