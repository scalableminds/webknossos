package com.scalableminds.webknossos.tracingstore.annotation

import play.api.libs.json.{JsObject, Json, OFormat}

trait GenericUpdateAction {
  def actionTimestamp: Option[Long]

  def addTimestamp(timestamp: Long): GenericUpdateAction

  def addInfo(info: Option[String]): GenericUpdateAction

  def addAuthorId(authorId: Option[String]): GenericUpdateAction
}

object GenericUpdateAction {
  implicit val jsonFormat: OFormat[GenericUpdateAction] = Json.format[GenericUpdateAction]
}

case class GenericUpdateActionGroup(version: Long,
                                    timestamp: Long,
                                    authorId: Option[String],
                                    actions: List[GenericUpdateAction],
                                    stats: Option[JsObject],
                                    info: Option[String],
                                    transactionId: String,
                                    transactionGroupCount: Int,
                                    transactionGroupIndex: Int) {

  def significantChangesCount: Int = 1 // TODO

  def viewChangesCount: Int = 1 // TODO
}

object GenericUpdateActionGroup {
  implicit val jsonFormat: OFormat[GenericUpdateActionGroup] = Json.format[GenericUpdateActionGroup]
}
