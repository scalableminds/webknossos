package models.annotation

import models.user.User
import models.task.Task
import models.annotation.AnnotationType._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import braingames.util.{FoxImplicits, Fox}
import reactivemongo.bson.BSONObjectID
import play.api.Logger
import models.tracing.skeleton.AnnotationStatistics
import oxalis.view.{ResourceActionCollection, ResourceAction}
import play.api.libs.json.Json.JsValueWrapper
import oxalis.mvc.FilterableJson

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:06
 */
trait AnnotationLike extends AnnotationStatistics {
  def _name: Option[String]

  def user: Fox[User]

  def team: String

  def muta: AnnotationMutationsLike

  def content: Fox[AnnotationContent]

  def _user: BSONObjectID

  def id: String

  def typ: AnnotationType

  def task: Fox[Task]

  def state: AnnotationState

  def restrictions: AnnotationRestrictions

  def review: List[AnnotationReview] = Nil

  def version: Int

  // def incrementVersion: AnnotationLike

  def dataSetName = content.map(_.dataSetName) getOrElse ""


  def isTrainingsAnnotation =
    typ == AnnotationType.Training

  def annotationInfo(user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(this, user, Nil)

  def actions(user: Option[User]): ResourceActionCollection
}

object AnnotationLike extends FoxImplicits with FilterableJson{

  def stateLabel(annotation: AnnotationLike, user: Option[User]) = {
    val lastReviewer = annotation.review.headOption.map(_._reviewer)
    annotation.state match {
      case s if s.isFinished =>
        "Finished"
      case s if lastReviewer != user.map(_._id) && s.isInReview =>
        "Under Review"
      case _ =>
        "In Progress"
    }
  }

  def annotationLikeInfoWrites(a: AnnotationLike, user: Option[User], exclude: List[String])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    JsonObjectWithFilter(exclude)(
      "version" +> a.version,
      "user" +> a.user.toFox.map(u => JsString(u.name)).getOrElse(JsNull),
      "lastEdit" +> a.content.map(_.timestamp).getOrElse(0L),
      "stateLabel" +> stateLabel(a, user),
      "state" +> a.state,
      "id" +> a.id,
      "name" +> a._name.getOrElse(""),
      "typ" +> a.typ,
      "task" +> a.task.flatMap(t => Task.transformToJson(t)).getOrElse(JsNull),
      "stats" +> a.statisticsForAnnotation().map(s => Json.toJson(s)).getOrElse(JsNull),
      "content" +> a.content.flatMap(AnnotationContent.writeAsJson(_)).getOrElse(JsNull),
      "restrictions" +> AnnotationRestrictions.writeAsJson(a.restrictions, user),
      "review" +> a.review,
      "actions" +> a.actions(user))
  }

}