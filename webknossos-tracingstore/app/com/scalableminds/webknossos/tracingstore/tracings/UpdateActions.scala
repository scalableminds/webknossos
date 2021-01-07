package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import scalapb.{GeneratedMessage, Message}
import play.api.libs.json._

trait UpdateAction[T <: GeneratedMessage with Message[T]] {

  def actionTimestamp: Option[Long]

  def applyOn(tracing: T): T = tracing

  def addTimestamp(timestamp: Long): UpdateAction[T] = this

  def addInfo(info: Option[String]): UpdateAction[T] = this

  def transformToCompact: UpdateAction[T] = this
}

object UpdateAction {
  type SkeletonUpdateAction = UpdateAction[SkeletonTracing]
  type VolumeUpdateAction = UpdateAction[VolumeTracing]
}

case class UpdateActionGroup[T <: GeneratedMessage with Message[T]](
    version: Long,
    timestamp: Long,
    actions: List[UpdateAction[T]],
    stats: Option[JsObject],
    info: Option[String],
    transactionId: Option[String],
    transactionGroupCount: Option[Int],
    transactionGroupIndex: Option[Int]
)

object UpdateActionGroup {

  implicit def updateActionGroupReads[T <: GeneratedMessage with Message[T]](
      implicit fmt: Reads[UpdateAction[T]]): Reads[UpdateActionGroup[T]] = new Reads[UpdateActionGroup[T]] {

    override def reads(json: JsValue): JsResult[UpdateActionGroup[T]] =
      for {
        version <- json.validate((JsPath \ "version").read[Long])
        timestamp <- json.validate((JsPath \ "timestamp").read[Long])
        actions <- json.validate((JsPath \ "actions").read[List[UpdateAction[T]]])
        stats <- json.validate((JsPath \ "stats").readNullable[JsObject])
        info <- json.validate((JsPath \ "info").readNullable[String])
        transactionId <- json.validate((JsPath \ "transactionId").readNullable[String])
        transactionGroupCount <- json.validate((JsPath \ "transactionGroupCount").readNullable[Int])
        transactionGroupIndex <- json.validate((JsPath \ "transactionGroupIndex").readNullable[Int])
      } yield {
        UpdateActionGroup[T](version,
                             timestamp,
                             actions,
                             stats,
                             info,
                             transactionId,
                             transactionGroupCount,
                             transactionGroupIndex)
      }
  }

  implicit def updateActionGroupWrites[T <: GeneratedMessage with Message[T]](
      implicit fmt: Writes[UpdateAction[T]]): Writes[UpdateActionGroup[T]] = new Writes[UpdateActionGroup[T]] {

    override def writes(value: UpdateActionGroup[T]): JsValue =
      Json.obj(
        "version" -> value.version,
        "timestamp" -> value.timestamp,
        "actions" -> Json.toJson(value.actions),
        "stats" -> value.stats,
        "info" -> value.info,
        "transactionId" -> value.transactionId,
        "transactionGroupCount" -> value.transactionGroupCount,
        "transactionGroupIndex" -> value.transactionGroupIndex
      )
  }

}
