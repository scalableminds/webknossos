package com.scalableminds.webknossos.datastore.services.mesh

trait MeshFileUtils {

  protected val keyBucketOffsets = "bucket_offsets"
  protected val keyBuckets = "buckets"
  protected val keyNeuroglancer = "neuroglancer"
  protected val keyManifests = "manifests"
  protected val keyRows = "rows"
  protected val keyRowLevelSummary = "row_level_summary"
  protected val keyIdIndex = "id_index"
  protected def keyFence(level: Int): String = s"fence_$level"

  protected val attrKeyLodScaleMultiplier = "lod_scale_multiplier"
  protected val attrKeyTransform = "transform"
  protected val attrKeyMeshFormat = "mesh_format"
  protected val attrKeyHashFunction = "hash_function"
  protected val attrKeyNBuckets = "n_buckets"
  protected val attrKeyMappingName = "mapping_name"
  protected val attrKeyNFenceLevels = "n_fence_levels"
  protected val attrKeyDataOrderMappings = "data_order_mappings"

}
