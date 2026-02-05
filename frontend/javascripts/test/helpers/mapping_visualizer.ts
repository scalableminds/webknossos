/*
 * This module can be used to serialize the individual versions
 * that a BackendMock received via update actions.
 * Each version will be written to DEBUG_OUTPUT_DIR as a json file.
 *
 * These serialized versions can then be visualized and inspected in
 * the browser by running
 *   node tools/debugging/version-visualizer/server.js
 *
 * To actually write out the json files, put this at the end of
 * the test you want to analyze:
 *
 *   publishDebuggingState(backendMock)
 *
 * Note that you need to pass Store.getState() in your test when constructing
 * the backendMock:
 *   const backendMock = mockInitialBucketAndAgglomerateData(..., Store.getState())
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { readdir, unlink } from "fs/promises";
import DiffableMap from "libs/diffable_map";
import range from "lodash-es/range";
import type { BackendMock } from "test/sagas/proofreading/proofreading_test_utils";
import { type AgglomerateMapping, serializeAdjacencyList } from "./agglomerate_mapping_helper";

const DEBUG_OUTPUT_DIR = "./tools/debugging/version-visualizer/data";

export async function publishDebuggingState(backendMock: BackendMock): Promise<void> {
  await deleteOldFiles();
  const viz = new MappingVisualizer(backendMock);
  viz.serializeAllVersions();
}

export class MappingVisualizer {
  private readonly mapping: AgglomerateMapping;
  constructor(private readonly backendMock: BackendMock) {
    this.mapping = backendMock.agglomerateMapping;
  }

  serializeAllVersions() {
    for (const version of range(this.backendMock.agglomerateMapping.currentVersion + 1)) {
      this.serializeVersion(version);
    }
  }

  serializeVersion(version: number): void {
    const json = this.buildJson(version);
    const outputPath = DEBUG_OUTPUT_DIR + `/version_${version}.json`;
    writeFileSync(outputPath, json, "utf8");
  }

  private buildJson(version: number): string {
    const versionMap = this.mapping.getMap(version);

    const adjacencyList: Map<number, Set<number>> = this.mapping.getAdjacencyList(version);

    if (!adjacencyList) {
      throw new Error("MappingVisualizer requires access to adjacencyList (test-only).");
    }

    const storeState = this.backendMock.getState(version);
    const saveRequests = this.backendMock.getLocalUpdateActionLog(version, false);

    return JSON.stringify(
      {
        version,
        versionMap: Object.fromEntries(Array.from(versionMap.entries())),
        adjacencyList: serializeAdjacencyList(adjacencyList),
        storeState,
        saveRequests,
      },
      (_key, value) => {
        if (value instanceof DiffableMap) {
          return { entries: Array.from(value.entries()), _isDiffableMap: true };
        }
        return value;
      },
    );
  }
}

async function deleteOldFiles() {
  const entries = await readdir(DEBUG_OUTPUT_DIR, { withFileTypes: true });

  const files = entries.filter((entry) => entry.isFile());

  for (const file of files) {
    const filePath = path.join(DEBUG_OUTPUT_DIR, file.name);
    await unlink(filePath);
  }
}
