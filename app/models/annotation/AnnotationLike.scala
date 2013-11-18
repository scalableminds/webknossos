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

  def task: Option[Task]

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

object AnnotationLike extends FoxImplicits{

  import models.annotation.AnnotationContent._

  def annotationLikeInfoWrites(a: AnnotationLike, user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    a.content.flatMap(writeAnnotationContent(_)).getOrElse(Json.obj()).map {
      js =>
        ((__ \ 'version).write[Int] and
          (__ \ 'id).write[String] and
          (__ \ 'name).write[String] and
          (__ \ 'typ).write[String] and
          (__ \ 'content).write[JsObject] and
          (__ \ 'restrictions).write[AnnotationRestrictions](
            AnnotationRestrictions.writeFor(user)))
          .tupled
          .writes(
          (a.version, a.id, a._name getOrElse "", a.typ, js, a.restrictions))
    }
  }

}