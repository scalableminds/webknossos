package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.datareaders.precomputed.{
  NeuroglancerPrecomputedShardingUtils,
  ShardingSpecification
}

case class NeuroglancerMesh(meshInfo: NeuroglancerPrecomputedMeshInfo) extends NeuroglancerPrecomputedShardingUtils {
  // Right now, we only support sharded Neuroglancer meshes
  override val shardingSpecification: ShardingSpecification = meshInfo.sharding.getOrElse(ShardingSpecification.empty)

}

object NeuroglancerMesh {
  val FILENAME_INFO = "info"

  val meshTypeName = "neuroglancerPrecomputed"

  val meshName = "mesh"

  val meshEncoding = "draco"

  // The WEBKNOSSOS mesh version that is used for parsing
  val meshInfoVersion = 7
}
