package com.scalableminds.webknossos.datastore.services.mesh

trait MeshFileUtils {

  protected val keyBucketOffsets = "bucket_offsets"
  protected val keyBuckets = "buckets"
  protected val keyNeuroglancer = "neuroglancer"

  // B-tree arrays (v10+)
  protected val keyBtreeLeaves = "btree_leaves"
  protected val keyBtreeInternal = "btree_internal"
  // Number of concurrent workers pulling btree leaf nodes in the bulk lookup path
  protected val btreeLeafReadParallelity = 32
  // Bulk reads of the neuroglancer array are grouped into runs: manifest ranges closer together
  // than this gap share a read, and no single read spans more than the max below.
  protected val bulkNeuroglancerMaxGapBytes = 1L * 1024 * 1024
  protected val bulkNeuroglancerMaxSpanBytes = 128L * 1024 * 1024

  protected val attrKeyLodScaleMultiplier = "lod_scale_multiplier"
  protected val attrKeyTransform = "transform"
  protected val attrKeyMeshFormat = "mesh_format"
  protected val attrKeyHashFunction = "hash_function"
  protected val attrKeyNBuckets = "n_buckets"
  protected val attrKeyMappingName = "mapping_name"
  protected val attrKeyBtreeHeight = "btree_height"
  protected val attrKeyBtreeLevelOffsets = "btree_level_offsets"
  protected val attrKeyBtreeNodeBytes = "btree_node_bytes"

}
