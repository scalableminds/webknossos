import {
  type BucketAddress,
  BucketJournal,
  bucketAddressOfVoxel,
  type EditContext,
  FakeBackend,
  type Mag,
  MagList,
  type SegmentId,
  type Vector3,
  VolumeEditingSession,
  WorkingDataCube,
} from "prototypes/new_volume_architecture";

/**
 * An intentionally anisotropic pyramid, so the tests exercise per-axis factors
 * rather than a uniform power of two:
 *   mag 0 = 1-1-1, mag 1 = 2-2-1, mag 2 = 4-4-2
 * Adjacent factors are therefore [2,2,1] and then [2,2,2].
 */
export const MAGS = new MagList([
  [1, 1, 1],
  [2, 2, 1],
  [4, 4, 2],
]);

export interface Harness {
  backend: FakeBackend;
  journal: BucketJournal;
  cube: WorkingDataCube;
  session: VolumeEditingSession;
  mags: MagList;
}

export function createHarness(mags: MagList = MAGS): Harness {
  const backend = new FakeBackend();
  const journal = new BucketJournal();
  const cube = new WorkingDataCube(backend, journal);
  const session = new VolumeEditingSession(cube, journal, mags);
  return { backend, journal, cube, session, mags };
}

export function editContext(overrides: Partial<EditContext> = {}): EditContext {
  return {
    sourceMagIndex: 0,
    activeSegmentId: 7n,
    overwriteMode: "overwrite-all",
    editableBoundingBox: null,
    ...overrides,
  };
}

/** Make the given buckets resident so tests can read them back. */
export async function materialize(
  cube: WorkingDataCube,
  addresses: BucketAddress[],
): Promise<void> {
  await Promise.all(addresses.map((address) => cube.materialize(address)));
}

/** Bucket (0,0,0) at each mag — enough for edits confined near the origin. */
export function originBuckets(magCount: number): BucketAddress[] {
  return Array.from({ length: magCount }, (_, magIndex) => [0, 0, 0, magIndex] as BucketAddress);
}

/** Map a finest-mag voxel into the grid of `mag`. */
export function toMagVoxel(voxel: Vector3, mag: Mag): Vector3 {
  return [
    Math.floor(voxel[0] / mag[0]),
    Math.floor(voxel[1] / mag[1]),
    Math.floor(voxel[2] / mag[2]),
  ];
}

/** Every finest-mag voxel in a half-open box. */
export function* voxelsInBox(min: Vector3, max: Vector3): Generator<Vector3> {
  for (let z = min[2]; z < max[2]; z++) {
    for (let y = min[1]; y < max[1]; y++) {
      for (let x = min[0]; x < max[0]; x++) {
        yield [x, y, z];
      }
    }
  }
}

/** Collect the finest-mag voxels currently carrying `value`, within a box. */
export function paintedVoxels(
  cube: WorkingDataCube,
  min: Vector3,
  max: Vector3,
  value: SegmentId,
  magIndex = 0,
): Vector3[] {
  const found: Vector3[] = [];
  for (const voxel of voxelsInBox(min, max)) {
    if (cube.peek(voxel, magIndex) === value) found.push(voxel);
  }
  return found;
}

export function keyOf(voxel: Vector3): string {
  return voxel.join(",");
}

/** The distinct mag indices a transaction's bucket diffs touch. */
export function magIndicesOf(addresses: BucketAddress[]): number[] {
  return [...new Set(addresses.map((address) => address[3]))].sort((a, b) => a - b);
}

export function bucketOf(voxel: Vector3, magIndex: number): BucketAddress {
  return bucketAddressOfVoxel(voxel, magIndex);
}
