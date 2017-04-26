/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.tracing.skeleton.DBTreeDAO._
import play.api.libs.json.{JsValue, Json}
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.indexes.{Index, IndexType}

case class AnnotationUpdate(
                             typ: String,
                             annotationId: String,
                             version: Int,
                             content: JsValue,
                             deleted: Option[Boolean] = None,
                             timestamp: Option[Long] = Some(System.currentTimeMillis)
                           ) {}

object AnnotationUpdate{
  implicit val annotationUpdateFormat = Json.format[AnnotationUpdate]
}

object AnnotationUpdateService{
  def store(typ: String, id: String, version: Int, content: JsValue)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.insert(AnnotationUpdate(typ, id, version, content))
  }

  def retrieveAll(typ: String, id: String, maxVersion: Int = Int.MaxValue, limit: Option[Int] = None)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.retrieveAll(typ, id, maxVersion, limit)
  }
  def removeAll(typ: String, id: String, aboveVersion: Int)(implicit ctx: DBAccessContext) = {
    AnnotationUpdateDAO.removeAll(typ, id, aboveVersion)
  }
}

object AnnotationUpdateDAO
  extends SecuredBaseDAO[AnnotationUpdate]
  with FoxImplicits {

  val collectionName = "annotationUpdates"

  val formatter = AnnotationUpdate.annotationUpdateFormat

  underlying.indexesManager.ensure(Index(Seq("annotationId" -> IndexType.Ascending)))

  underlying.indexesManager.ensure(Index(Seq("version" -> IndexType.Ascending)))

  def retrieveAll(typ: String, annotationId: String, maxVersion: Int = Int.MaxValue, limit: Option[Int])(implicit ctx: DBAccessContext) = {
    find(Json.obj(
      "typ" -> typ,
      "annotationId" -> annotationId,
      "version" -> Json.obj("$lte" -> maxVersion),
      "deleted" -> Json.obj("$ne" -> true))
    ).sort(Json.obj("version" -> 1)).cursor[AnnotationUpdate].collect[List](maxDocs = limit getOrElse Int.MaxValue)
  }

  def removeAll(typ: String, annotationId: String, aboveVersion: Int)(implicit ctx: DBAccessContext) = {
    update(Json.obj("typ" -> typ, "annotationId" -> annotationId, "version" -> Json.obj("$gt" -> aboveVersion)), Json.obj("$set" -> Json.obj("deleted" -> true)), multi = true)

  }
}
