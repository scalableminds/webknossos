package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction}
import play.api.libs.json._

trait EditableMappingUpdateAction extends LayerUpdateAction {
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class SplitAgglomerateUpdateAction(agglomerateId: Long, // Unused, we now look this up by position/segment
                                        segmentPosition1: Option[Vec3Int],
                                        segmentPosition2: Option[Vec3Int],
                                        segmentId1: Option[Long],
                                        segmentId2: Option[Long],
                                        mag: Vec3Int,
                                        actionTracingId: String,
                                        actionTimestamp: Option[Long] = None,
                                        actionAuthorId: Option[String] = None,
                                        info: Option[String] = None)
    extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object SplitAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[SplitAgglomerateUpdateAction] = Json.format[SplitAgglomerateUpdateAction]
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class MergeAgglomerateUpdateAction(agglomerateId1: Long, // Unused, we now look this up by position/segment
                                        agglomerateId2: Long, // Unused, we now look this up by position/segment
                                        segmentPosition1: Option[Vec3Int],
                                        segmentPosition2: Option[Vec3Int],
                                        segmentId1: Option[Long],
                                        segmentId2: Option[Long],
                                        mag: Vec3Int,
                                        actionTracingId: String,
                                        actionTimestamp: Option[Long] = None,
                                        actionAuthorId: Option[String] = None,
                                        info: Option[String] = None)
    extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object MergeAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[MergeAgglomerateUpdateAction] = Json.format[MergeAgglomerateUpdateAction]
}
