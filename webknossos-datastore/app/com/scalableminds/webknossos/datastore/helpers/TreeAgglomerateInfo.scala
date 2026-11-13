package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.SkeletonTracing.TreeAgglomerateInfoProto

case class TreeAgglomerateInfo(
    agglomerateId: UnsignedLong,
    tracingId: Option[String] = None,
    mappingName: Option[String] = None,
    layerName: Option[String] = None,
    clickedPosition: Option[Vec3Int] = None
) extends ProtoGeometryConversions derives JsonAutoFormat {
  def toProto: TreeAgglomerateInfoProto = TreeAgglomerateInfoProto(
    agglomerateId.toLong,
    tracingId,
    mappingName,
    layerName,
    vec3IntOptToProto(clickedPosition)
  )
}

object TreeAgglomerateInfo extends ProtoGeometryConversions {
  def fromProto(propertyProto: TreeAgglomerateInfoProto): TreeAgglomerateInfo =
    TreeAgglomerateInfo(
      UnsignedLong(propertyProto.agglomerateId),
      propertyProto.tracingId,
      propertyProto.mappingName,
      propertyProto.layerName,
      propertyProto.clickedPosition.map(vec3IntFromProto)
    )
}
