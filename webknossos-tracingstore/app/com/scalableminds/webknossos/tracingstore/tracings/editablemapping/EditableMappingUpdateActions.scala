package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.helpers.UnsignedLongJson
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction}
import play.api.libs.json._

trait EditableMappingUpdateAction extends LayerUpdateAction {
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class SplitAgglomerateUpdateAction(
    agglomerateId: Option[Long], // Unused, we now look this up by position/segment
    segmentPosition1: Option[Vec3Int],
    segmentPosition2: Option[Vec3Int],
    segmentId1: Option[Long],
    segmentId2: Option[Long],
    mag: Option[Vec3Int],
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object SplitAgglomerateUpdateAction {
  private val baseFormat: OFormat[SplitAgglomerateUpdateAction] = Json.format[SplitAgglomerateUpdateAction]
  implicit val jsonFormat: OFormat[SplitAgglomerateUpdateAction] =
    UnsignedLongJson.patchOptionalField(
      UnsignedLongJson.patchOptionalField(
        UnsignedLongJson.patchOptionalField(baseFormat, "agglomerateId")(
          _.agglomerateId,
          (a, v) => a.copy(agglomerateId = v)),
        "segmentId1"
      )(_.segmentId1, (a, v) => a.copy(segmentId1 = v)),
      "segmentId2"
    )(_.segmentId2, (a, v) => a.copy(segmentId2 = v))
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class MergeAgglomerateUpdateAction(
    agglomerateId1: Option[Long], // Unused, we now look this up by position/segment
    agglomerateId2: Option[Long], // Unused, we now look this up by position/segment
    segmentPosition1: Option[Vec3Int],
    segmentPosition2: Option[Vec3Int],
    segmentId1: Option[Long],
    segmentId2: Option[Long],
    mag: Option[Vec3Int],
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object MergeAgglomerateUpdateAction {
  private val baseFormat: OFormat[MergeAgglomerateUpdateAction] = Json.format[MergeAgglomerateUpdateAction]
  implicit val jsonFormat: OFormat[MergeAgglomerateUpdateAction] =
    UnsignedLongJson.patchOptionalField(
      UnsignedLongJson.patchOptionalField(
        UnsignedLongJson.patchOptionalField(
          UnsignedLongJson.patchOptionalField(baseFormat, "agglomerateId1")(
            _.agglomerateId1,
            (a, v) => a.copy(agglomerateId1 = v)),
          "agglomerateId2"
        )(_.agglomerateId2, (a, v) => a.copy(agglomerateId2 = v)),
        "segmentId1"
      )(_.segmentId1, (a, v) => a.copy(segmentId1 = v)),
      "segmentId2"
    )(_.segmentId2, (a, v) => a.copy(segmentId2 = v))
}
