package models.annotation

import models.user.User
import org.bson.types.ObjectId
import models.task.Task
import models.annotation.AnnotationType._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import braingames.util.{FoxImplicits, Fox}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:06
 */
trait AnnotationLike {
  def _name: Option[String]

  def user: Future[Option[User]]

  def content: Fox[AnnotationContent]

  def _user: ObjectId

  def id: String

  def typ: AnnotationType

  def task: Fox[Task]

  def state: AnnotationState

  def restrictions: AnnotationRestrictions

  def review: List[AnnotationReview] = Nil

  def version: Int

  def incrementVersion: AnnotationLike

  def isTrainingsAnnotation() = {
    this.task.map(_.isTraining) getOrElse false
  }

  def annotationInfo(user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(this, user)
}

object AnnotationLike extends FoxImplicits {

  def annotationLikeInfoWrites(a: AnnotationLike, user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      contentJs <- a.content.flatMap(AnnotationContent.writeAsJson(_))
      restrictionsJs <- AnnotationRestrictions.writeAsJson(a.restrictions, user).toFox
      name = a._name.getOrElse("")
    } yield {
      Json.obj(
        "version" -> a.version,
        "id" -> a.id,
        "name" -> name,
        "typ" -> a.typ,
        "content" -> contentJs,
        "restrictions" -> restrictionsJs)
    }
  }

}