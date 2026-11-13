package com.scalableminds.webknossos.datastore.services.mesh

trait MeshFileUtils {

  protected val keyBucketOffsets = "bucket_offsets"
  protected val keyBuckets = "buckets"
  protected val keyNeuroglancer = "neuroglancer"
  protected val keyManifests = "manifests"
  protected val keySegmentMeshMetadata = "segment_mesh_metadata"
  protected val keyMaxSegmentLevelPerChunk = "max_segment_level_per_chunk"
  protected val keyLeaves = "leaves"
  protected def keyInnerNodes(layer: Int): String = s"inner_nodes_$layer"

  protected val attrKeyLodScaleMultiplier = "lod_scale_multiplier"
  protected val attrKeyTransform = "transform"
  protected val attrKeyMeshFormat = "mesh_format"
  protected val attrKeyHashFunction = "hash_function"
  protected val attrKeyNBuckets = "n_buckets"
  protected val attrKeyMappingName = "mapping_name"
  protected val attrKeyNInnerNodeLayers = "n_inner_node_layers"
  protected val attrKeyDataOrderMappings = "data_order_mappings"

}
