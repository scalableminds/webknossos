package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import play.api.libs.json._
import scalapb.GeneratedMessage

trait UpdateAction[T <: GeneratedMessage] {

  def actionTimestamp: Option[Long]

  def actionAuthorId: Option[String]

  def applyOn(tracing: T): T = tracing

  def addTimestamp(timestamp: Long): UpdateAction[T] = this

  def addInfo(info: Option[String]): UpdateAction[T] = this

  def addAuthorId(authorId: Option[String]): UpdateAction[T] = this

  def transformToCompact: UpdateAction[T] = this

  // For analytics we wan to know how many changes are view only (e.g. move camera, toggle tree visibility)
  // Overridden in subclasses
  def isViewOnlyChange: Boolean = false
}

case class UpdateActionGroup[T <: GeneratedMessage](
    version: Long,
    timestamp: Long,
    authorId: Option[String],
    actions: List[UpdateAction[T]],
    stats: Option[JsObject],
    info: Option[String],
    transactionId: String,
    transactionGroupCount: Int,
    transactionGroupIndex: Int
) {
  def significantChangesCount: Int = actions.count(!_.isViewOnlyChange)
  def viewChangesCount: Int = actions.count(_.isViewOnlyChange)
}

object UpdateActionGroup {

  implicit def updateActionGroupReads[T <: GeneratedMessage](
      implicit fmt: Reads[UpdateAction[T]]): Reads[UpdateActionGroup[T]] =
    (json: JsValue) =>
      for {
        version <- json.validate((JsPath \ "version").read[Long])
        timestamp <- json.validate((JsPath \ "timestamp").read[Long])
        authorId <- json.validate((JsPath \ "authorId").readNullable[String])
        actions <- json.validate((JsPath \ "actions").read[List[UpdateAction[T]]])
        stats <- json.validate((JsPath \ "stats").readNullable[JsObject])
        info <- json.validate((JsPath \ "info").readNullable[String])
        transactionId <- json.validate((JsPath \ "transactionId").read[String])
        transactionGroupCount <- json.validate((JsPath \ "transactionGroupCount").read[Int])
        transactionGroupIndex <- json.validate((JsPath \ "transactionGroupIndex").read[Int])
      } yield {
        UpdateActionGroup[T](version,
                             timestamp,
                             authorId,
                             actions,
                             stats,
                             info,
                             transactionId,
                             transactionGroupCount,
                             transactionGroupIndex)
    }

  implicit def updateActionGroupWrites[T <: GeneratedMessage](
      implicit fmt: Writes[UpdateAction[T]]): Writes[UpdateActionGroup[T]] =
    (value: UpdateActionGroup[T]) =>
      Json.obj(
        "version" -> value.version,
        "timestamp" -> value.timestamp,
        "authorId" -> value.authorId,
        "actions" -> Json.toJson(value.actions),
        "stats" -> value.stats,
        "info" -> value.info,
        "transactionId" -> value.transactionId,
        "transactionGroupCount" -> value.transactionGroupCount,
        "transactionGroupIndex" -> value.transactionGroupIndex
    )

}
