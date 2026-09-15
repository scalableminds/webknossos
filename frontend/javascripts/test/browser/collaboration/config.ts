import { range } from "lodash-es";
import type { Vector3 } from "viewer/constants";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const N_COLLAB_USERS = 4;

export const MbpsFactor = (1000 * 1024) / 8;
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
export const KEEP_ALIVE_FOR_DEBUGGING = false;
export const KEEP_ALIVE_WAITING_DURATION = 1_000_000;
export const BROWSER_SPEC_TIMEOUT = KEEP_ALIVE_FOR_DEBUGGING
  ? KEEP_ALIVE_WAITING_DURATION
  : 5 * 60 * 1000;

export const ORG_NAME = "sample_organization";

export const DATASET_NAME = "l4dense_motta_et_al_dev";
export const HDF5_MAPPING_NAME = "agglomerate_view_30";
export const MERGE_SOURCE_AGGLOMERATE_ID = 3681595n;
export const MERGE_SOURCE_POSITION = [2918, 4316, 1770] as Vector3;
// Position (in voxel coordinates) where the target segment is located.
// Used by the proofreading saga to look up the segment under the cursor.
export const MERGE_TARGET_POSITION: [number, number, number] = [2826, 4318, 1770];

// Additional per-user merge/split operations performed during the parallel phase.
// Each entry describes what one collaborating user should do.
export const PARALLEL_USER_OPERATIONS: Array<{
  userIndex: number;
  sourceAgglomerateId: bigint;
  sourcePosition: [number, number, number];
  targetPosition: [number, number, number];
}> = [
  {
    userIndex: 0,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [1431, 1585, 1536],
  },
  {
    userIndex: 1,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [2668, 4656, 1770],
  },
  {
    userIndex: 2,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3064, 4655, 1770],
  },
  {
    userIndex: 3,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3092, 4614, 1770],
  },
  {
    userIndex: 0,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3092, 4614, 1770],
  },
  {
    userIndex: 1,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3145, 4618, 1770],
  },
  {
    userIndex: 2,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3145, 4618, 1770],
  },
  {
    userIndex: 3,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3231, 4601, 1770],
  },
  {
    userIndex: 0,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3296, 4573, 1770],
  },
  {
    userIndex: 1,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536],
    targetPosition: [3315, 4512, 1770],
  },
  ...range(0, 50).map((idx) => ({
    userIndex: idx % N_COLLAB_USERS,
    sourceAgglomerateId: 8465n,
    sourcePosition: [1462, 1535, 1536] as Vector3,
    targetPosition: [
      3315 + (idx + 1) * 10,
      4512 + (idx + 1) * 10,
      1770 + (idx + 1) * 10,
    ] as Vector3,
  })),
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
