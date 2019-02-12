// @flow

// Primarily, the contents of this file were extracted here
// to avoid circular dependencies.

// By subtracting and adding 1 (extraBucketPerEdge) to the bounds of y and x, we move
// one additional bucket on each edge of the viewport to the GPU. This decreases the
// chance of showing gray data, when moving the viewport. However, it might happen that
// we do not have enough capacity to move these additional buckets to the GPU.
// That's why, we are using a priority queue which orders buckets by manhattan distance to
// the center bucket. We only consume that many items from the PQ, which we can handle on the
// GPU.
export const extraBucketPerEdge = 1;
export const extraBucketsPerDim = 2 * extraBucketPerEdge;
