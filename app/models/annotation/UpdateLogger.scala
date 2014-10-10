/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import play.api.libs.json.{JsValue, Json}

case class AnnotationUpdate(typ: String, annotationId: String, version: Int, content: JsValue) {

}

object AnnotationUpdate{
  implicit val annotationUpdateFormat = Json.format[AnnotationUpdate]
}

object AnnotationUpdateService{
  def store(typ: String, id: String, version: Int, content: JsValue)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.insert(AnnotationUpdate(typ, id, version, content))
  }
}

object AnnotationUpdateDAO
  extends SecuredBaseDAO[AnnotationUpdate]
  with FoxImplicits {

  val collectionName = "annotationUpdates"

  val formatter = AnnotationUpdate.annotationUpdateFormat
}
