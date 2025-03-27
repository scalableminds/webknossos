package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.datareaders.precomputed.{
  NeuroglancerPrecomputedShardingUtils,
  ShardingSpecification
}

case class NeuroglancerMesh(meshInfo: NeuroglancerPrecomputedMeshInfo) extends NeuroglancerPrecomputedShardingUtils {
  // Right now, we only support sharded Neuroglancer meshes
  override val shardingSpecification: ShardingSpecification = meshInfo.sharding.getOrElse(ShardingSpecification.empty)

}
