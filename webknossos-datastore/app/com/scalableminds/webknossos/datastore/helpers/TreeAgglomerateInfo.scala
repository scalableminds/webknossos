package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.SkeletonTracing.TreeAgglomerateInfoProto

case class TreeAgglomerateInfo(
    agglomerateId: UnsignedLong,
    tracingId: Option[String] = None,
    mappingName: Option[String] = None
) derives AutoJsonFormat {
  def toProto: TreeAgglomerateInfoProto = TreeAgglomerateInfoProto(
    agglomerateId.toLong,
    tracingId,
    mappingName
  )
}

object TreeAgglomerateInfo {
  def fromProto(propertyProto: TreeAgglomerateInfoProto): TreeAgglomerateInfo =
    TreeAgglomerateInfo(
      UnsignedLong(propertyProto.agglomerateId),
      propertyProto.tracingId,
      propertyProto.mappingName
    )
}
