package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.tracingstore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import scalapb.{GeneratedMessage, Message}
import play.api.libs.json._

trait UpdateAction[T <: GeneratedMessage with Message[T]] {

  def actionTimestamp: Option[Long]

  def applyOn(tracing: T): T = tracing

  def addTimestamp(timestamp: Long): UpdateAction[T] = this

  def transformToCompact: UpdateAction[T] = this
}

object UpdateAction {
  type SkeletonUpdateAction = UpdateAction[SkeletonTracing]
  type VolumeUpdateAction = UpdateAction[VolumeTracing]
}

case class UpdateActionGroup[T <: GeneratedMessage with Message[T]](version: Long,
                                                                    timestamp: Long,
                                                                    actions: List[UpdateAction[T]],
                                                                    stats: Option[JsObject])

object UpdateActionGroup {

  implicit def updateActionGroupReads[T <: GeneratedMessage with Message[T]](
      implicit fmt: Reads[UpdateAction[T]]): Reads[UpdateActionGroup[T]] = new Reads[UpdateActionGroup[T]] {

    def reads(json: JsValue): JsResult[UpdateActionGroup[T]] =
      for {
        version <- json.validate((JsPath \ "version").read[Long])
        timestamp <- json.validate((JsPath \ "timestamp").read[Long])
        actions <- json.validate((JsPath \ "actions").read[List[UpdateAction[T]]])
        stats <- json.validate((JsPath \ "stats").readNullable[JsObject])
      } yield {
        UpdateActionGroup[T](version, timestamp, actions, stats)
      }
  }
}
