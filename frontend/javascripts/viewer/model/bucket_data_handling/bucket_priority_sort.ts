// Sorts picked buckets by priority with a counting sort and writes them to an ArrayBuffer in the
// same layout as the bucket picker worker's priority queue output: [x, y, z, zoomStep, priority]
// as uint32 per bucket, smallest priority first.
//
// This only works for integer priorities with a small range. The oblique bucket picker's
// priorities qualify: a Manhattan distance plus 1000 per fallback level (see
// getPriorityWeightForZoomStepDiff). Buckets with equal priority keep their insertion order.
export function countingSortToArrayBuffer(
  addresses: ArrayLike<number>,
  priorities: ArrayLike<number>,
): ArrayBuffer {
  const itemCount = priorities.length;
  const intsPerItem = 5;
  const buffer = new ArrayBuffer(itemCount * intsPerItem * 4);
  if (itemCount === 0) {
    return buffer;
  }

  let minPriority = priorities[0];
  let maxPriority = priorities[0];
  for (let i = 1; i < itemCount; i++) {
    const priority = priorities[i];
    if (priority < minPriority) minPriority = priority;
    if (priority > maxPriority) maxPriority = priority;
  }

  // nextIndex[p - minPriority] is the output index of the next bucket with priority p.
  const nextIndex = new Uint32Array(maxPriority - minPriority + 1);
  for (let i = 0; i < itemCount; i++) {
    nextIndex[priorities[i] - minPriority]++;
  }
  let start = 0;
  for (let p = 0; p < nextIndex.length; p++) {
    const count = nextIndex[p];
    nextIndex[p] = start;
    start += count;
  }

  const output = new Uint32Array(buffer);
  for (let i = 0; i < itemCount; i++) {
    const priority = priorities[i];
    const offset = intsPerItem * nextIndex[priority - minPriority]++;
    output[offset] = addresses[4 * i];
    output[offset + 1] = addresses[4 * i + 1];
    output[offset + 2] = addresses[4 * i + 2];
    output[offset + 3] = addresses[4 * i + 3];
    output[offset + 4] = priority;
  }
  return buffer;
}
