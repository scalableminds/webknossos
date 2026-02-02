import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BackendMock } from "test/sagas/proofreading/proofreading_test_utils";
import { serializeAdjacencyList, type AgglomerateMapping } from "./agglomerate_mapping_helper";
import DiffableMap from "libs/diffable_map";

type RenderFormat = "dot" | "json";

interface RenderOptions {
  outputPath?: string;
  format?: RenderFormat;
  rankdir?: "TB" | "LR";
}

export class MappingVisualizer {
  private readonly mapping: AgglomerateMapping;
  constructor(private readonly backendMock: BackendMock) {
    this.mapping = backendMock.agglomerateMapping;
  }

  renderVersion(version: number, options: RenderOptions = {}): void {
    const { outputPath = `version_${version}.json`, format = "json", rankdir = "LR" } = options;

    const outDir = path.dirname(outputPath);
    if (outDir && outDir !== ".") {
      mkdirSync(outDir, { recursive: true });
    }
    if (format === "json") {
      const json = this.buildJson(version);
      writeFileSync("./visualizer/data/" + outputPath, json, "utf8");
      return;
    } else {
      const dot = this.buildDot(version, rankdir);

      const dotPath = outputPath.replace(/\.(svg|png)$/, ".dot");
      writeFileSync(dotPath, dot, "utf8");
      execSync(`dot -Tsvg "${dotPath}" -o "${outputPath}" && rm "${dotPath}"`);
    }
  }

  /* ---------------- internal ---------------- */

  private buildJson(version: number): string {
    const versionMap = this.mapping.getMap(version);

    const adjacencyList: Map<number, Set<number>> = this.mapping.getAdjacencyList(version);

    if (!adjacencyList) {
      throw new Error("MappingVisualizer requires access to adjacencyList (test-only).");
    }

    const storeState = this.backendMock.getState(version);

    return JSON.stringify(
      {
        version,
        versionMap: Object.fromEntries(Array.from(versionMap.entries())),
        adjacencyList: serializeAdjacencyList(adjacencyList),
        storeState,
      },
      (key, value) => {
        if (value instanceof DiffableMap) {
          return { entries: Array.from(value.entries()), _isDiffableMap: true };
        }
        return value;
      },
    );
  }

  private buildDot(version: number, rankdir: "TB" | "LR"): string {
    const versionMap = this.mapping.getMap(version);
    const storeState = this.backendMock.getState(version);
    const adjacencyList: Map<number, Set<number>> = this.mapping.getAdjacencyList(version);

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
    lines.push("  node [shape=circle, fontsize=10, style=filled];");
    lines.push("  edge [fontsize=9];");
    lines.push("");

    // clusters per component
    for (const [componentId, segmentIds] of components.entries()) {
      const segmentItem = storeState.annotation.volumes[0].segments.getNullable(componentId);
      const color = segmentItem != null ? "#7ce468" : "#000000";
      lines.push(`  subgraph cluster_${componentId} {`);
      lines.push(`    label="Agglomerate ${componentId}";`);
      lines.push(`    fontcolor="${color}";`);
      lines.push("    fontsize=12;");
      lines.push("    style=rounded;");

      for (const segmentId of segmentIds) {
        // lines.push(`    ${segmentId};`);
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
