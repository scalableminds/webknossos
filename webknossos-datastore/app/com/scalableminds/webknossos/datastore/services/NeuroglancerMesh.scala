package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.datareaders.precomputed.{NeuroglancerPrecomputedShardingUtils, ShardingSpecification}

case class NeuroglancerMesh(meshInfo: NeuroglancerPrecomputedMeshInfo) extends NeuroglancerPrecomputedShardingUtils{
  override val shardingSpecification: ShardingSpecification = meshInfo.sharding.get // TODO: Remove get

}
