/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import play.api.libs.json.{JsValue, Json}
import play.api.libs.concurrent.Execution.Implicits._

case class AnnotationUpdate(typ: String, annotationId: String, version: Int, content: JsValue, deleted: Option[Boolean] = None) {

}

object AnnotationUpdate{
  implicit val annotationUpdateFormat = Json.format[AnnotationUpdate]
}

object AnnotationUpdateService{
  def store(typ: String, id: String, version: Int, content: JsValue)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.insert(AnnotationUpdate(typ, id, version, content))
  }

  def retrieveAll(typ: String, id: String, maxVersion: Int = Int.MaxValue)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.retrieveAll(typ, id, maxVersion).map{ updates =>
      updates.sortBy(_.version)
    }
  }
  def removeAll(typ: String, id: String)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.removeAll(typ, id)
  }
}

object AnnotationUpdateDAO
  extends SecuredBaseDAO[AnnotationUpdate]
  with FoxImplicits {

  val collectionName = "annotationUpdates"

  val formatter = AnnotationUpdate.annotationUpdateFormat

  def retrieveAll(typ: String, annotationId: String, maxVersion: Int = Int.MaxValue)(implicit ctx: DBAccessContext) = {
    find(Json.obj("typ" -> typ, "annotationId" -> annotationId, "version" -> Json.obj("$lte" -> maxVersion), "deleted" -> Json.obj("$ne" -> true))).cursor[AnnotationUpdate].collect[List]()
  }

  def removeAll(typ: String, annotationId: String)(implicit ctx: DBAccessContext) = {
    update(Json.obj("typ" -> typ, "annotationId" -> annotationId), Json.obj("$set" -> Json.obj("deleted" -> true)), multi = true)
  }
}
