package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.webknossos.datastore.datareaders.precomputed.{
  NeuroglancerPrecomputedShardingUtils,
  ShardingSpecification
}

case class NeuroglancerMesh(meshInfo: NeuroglancerPrecomputedMeshInfo) extends NeuroglancerPrecomputedShardingUtils {
  // Right now, we only support sharded Neuroglancer meshes
  override val shardingSpecification: ShardingSpecification = meshInfo.sharding.getOrElse(ShardingSpecification.empty)

  def transformAsMatrix: Array[Array[Double]] = {
    val transform = meshInfo.transform
    Array(
      Array(transform(0), transform(1), transform(2), transform(3)),
      Array(transform(4), transform(5), transform(6), transform(7)),
      Array(transform(8), transform(9), transform(10), transform(11))
    )
  }
}

object NeuroglancerMesh {
  val FILENAME_INFO = "info"

  val meshName = "mesh"

  val meshEncoding = "draco"

  // The WEBKNOSSOS mesh version that is used for parsing
  val meshInfoVersion = 7
}
