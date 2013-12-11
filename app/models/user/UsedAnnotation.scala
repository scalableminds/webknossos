package models.user

import models.context._
import models.basics.SecuredBaseDAO
import oxalis.annotation.AnnotationIdentifier
import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import braingames.reactivemongo.DBAccessContext
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._

case class UsedAnnotation(user: BSONObjectID, annotationId: AnnotationIdentifier, _id: BSONObjectID = BSONObjectID.generate)

object UsedAnnotation{
  implicit val usedAnnotationFormat = Json.format[UsedAnnotation]
}

object UsedAnnotationDAO extends SecuredBaseDAO[UsedAnnotation] {
  val collectionName = "usedAnnotations"

  val formatter = UsedAnnotation.usedAnnotationFormat

  def use(user: User, annotationId: AnnotationIdentifier)(implicit ctx: DBAccessContext): Unit = {
    removeAll(user).flatMap {
      _ =>
        insert(UsedAnnotation(user._id, annotationId))
    }
  }

  def by(user: User)(implicit ctx: DBAccessContext) =
    find("user", user._id).collect[List]().map(_.map(_.annotationId))

  def oneBy(user: User)(implicit ctx: DBAccessContext) =
    findOne("user", user._id).map(_.map(_.annotationId))

  def removeAll(user: User)(implicit ctx: DBAccessContext) = {
    remove("user", user._id)
  }

  def removeAll(tracing: String)(implicit ctx: DBAccessContext) = {
    remove("tracing", tracing)
  }
}