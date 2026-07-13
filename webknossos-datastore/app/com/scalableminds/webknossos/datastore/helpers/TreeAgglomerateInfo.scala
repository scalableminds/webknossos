package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.webknossos.datastore.SkeletonTracing.TreeAgglomerateInfoProto
import play.api.libs.json.{Json, OFormat}

case class TreeAgglomerateInfo(
    agglomerateId: Long,
    tracingId: Option[String] = None,
    mappingName: Option[String] = None
) {
  def toProto: TreeAgglomerateInfoProto = TreeAgglomerateInfoProto(
    agglomerateId,
    tracingId,
    mappingName
  )
}

object TreeAgglomerateInfo {
  def fromProto(propertyProto: TreeAgglomerateInfoProto): TreeAgglomerateInfo =
    TreeAgglomerateInfo(
      propertyProto.agglomerateId,
      propertyProto.tracingId,
      propertyProto.mappingName
    )

  implicit val jsonFormat: OFormat[TreeAgglomerateInfo] =
    UnsignedLongJson.patchRequiredField(Json.format[TreeAgglomerateInfo], "agglomerateId")(
      _.agglomerateId,
      (a, v) => a.copy(agglomerateId = v)
    )
}
