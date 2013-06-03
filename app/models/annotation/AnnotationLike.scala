package models.annotation

import models.user.User
import org.bson.types.ObjectId
import models.task.Task
import models.annotation.AnnotationType._
import play.api.libs.json._
import play.api.libs.functional.syntax._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:06
 */
trait AnnotationLike {
  def _name: Option[String]

  def user: Option[User]

  def content: Option[AnnotationContent]

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

  def annotationInfo(user: User): JsObject =
    AnnotationLike.annotationLikeInfoWrites(user).writes(this)
}

object AnnotationLike {

  import models.annotation.AnnotationContent.annotationContentWrites

  def annotationLikeInfoWrites(user: User): OWrites[AnnotationLike] =
    ((__ \ 'version).write[Int] and
    (__ \ 'name).write[String] and
    (__ \ 'typ).write[String] and
    (__ \ 'content).write[Option[AnnotationContent]] and
    (__ \ 'restrictions).write[AnnotationRestrictions](
      AnnotationRestrictions.writeFor(user)))(a =>
      (a.version, a._name getOrElse "", a.typ, a.content, a.restrictions))

}