import fs from "node:fs";
import path from "node:path";
import type { Vector3 } from "viewer/constants";

// ---------------------------------------------------------------------------
// .env loading
// ---------------------------------------------------------------------------

export function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed
        .substring(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file is optional; fall back to process.env set by the caller
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const N_COLLAB_USERS = 6;

export const MbpsFactor = (1000 * 1024) / 8;
// Set to null to disable network throttling.
export const ENABLE_THROTTLING = false;
export const NETWORK_THROTTLE: {
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
} | null = ENABLE_THROTTLING
  ? {
      downloadThroughput: 1 * MbpsFactor,
      uploadThroughput: 1 * MbpsFactor,
      latency: 250,
    }
  : null;

export const ORG_NAME = "sample_organization";

// Localhost
// export const DATASET_NAME = "l4_v2_sample";
// export const HDF5_MAPPING_NAME = "agglomerate_view_5";
// export const MERGE_SOURCE_AGGLOMERATE_ID = 8465;
// export const MERGE_SOURCE_POSITION = [1462, 1535, 1536] as Vector3;
// export const MERGE_TARGET_POSITION: [number, number, number] = [1429, 1578, 1536];

// DEV Instance
export const DATASET_NAME = "l4dense_motta_et_al_dev";
export const HDF5_MAPPING_NAME = "agglomerate_view_30";
export const MERGE_SOURCE_AGGLOMERATE_ID = 3681595;
export const MERGE_SOURCE_POSITION = [2918, 4316, 1770] as Vector3;
// Position (in voxel coordinates) where the target segment is located.
// Used by the proofreading saga to look up the segment under the cursor.
export const MERGE_TARGET_POSITION: [number, number, number] = [2826, 4318, 1770];

// Additional per-user merge/split operations performed during the parallel phase.
// Each entry describes what one collaborating user should do.
export const PARALLEL_USER_OPERATIONS: Array<{
  sourceAgglomerateId: number;
  sourcePosition: [number, number, number];
  targetPosition: [number, number, number];
}> = [
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [1431, 1585, 1536],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [2668, 4656, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3064, 4655, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3092, 4614, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3092, 4614, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3145, 4618, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3145, 4618, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3231, 4601, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3296, 4573, 1770],
  },
  {
    sourceAgglomerateId: 8465,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3315, 4512, 1770],
  },
];

// ---------------------------------------------------------------------------
// Credentials (read from .env or environment)
// ---------------------------------------------------------------------------

export const { WK_AUTH_TOKEN } = process.env;
export const BASE_URL = (() => {
  let url = process.env.URL ?? "https://master.webknossos.xyz/";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
})();

if (!WK_AUTH_TOKEN) throw new Error("WK_AUTH_TOKEN must be set (see .env).");
