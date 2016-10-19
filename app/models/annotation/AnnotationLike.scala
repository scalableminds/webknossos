package models.annotation

import controllers.Application
import models.annotation
import models.user.{UserService, User}
import models.task.{TaskDAO, Task}
import models.annotation.AnnotationType._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import reactivemongo.bson.BSONObjectID
import play.api.Logger
import models.tracing.AnnotationStatistics
import oxalis.view.{ResourceActionCollection, ResourceAction}
import play.api.libs.json.Json.JsValueWrapper
import oxalis.mvc.{UrlHelper, FilterableJson}
import com.scalableminds.util.mvc.Formatter
import org.joda.time.format.DateTimeFormat

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:06
 */
trait AnnotationLike extends AnnotationStatistics {
  def _name: Option[String]

  def _user: Option[BSONObjectID]

  def user: Fox[User] =
    _user.toFox.flatMap(u => UserService.findOneById(u.stringify, useCache = true)(GlobalAccessContext))

  def team: String

  def muta: AnnotationMutationsLike

  def content: Fox[AnnotationContent]

  def id: String

  def typ: AnnotationType

  def _task: Option[BSONObjectID]

  def task: Fox[Task] =
    _task.toFox.flatMap(id => TaskDAO.findOneById(id)(GlobalAccessContext))

  def state: AnnotationState

  def restrictions: AnnotationRestrictions

  def relativeDownloadUrl: Option[String]

  def version: Int

  // def incrementVersion: AnnotationLike

  def dataSetName = content.map(_.dataSetName) getOrElse ""

  def annotationInfo(user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(this, user, Nil)

  def actions(user: Option[User]): ResourceActionCollection

  def created : Long

  def temporaryDuplicate(keepId: Boolean)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation]

  def makeReadOnly: AnnotationLike

  def saveToDB(implicit ctx: DBAccessContext): Fox[AnnotationLike]
}

object AnnotationLike extends FoxImplicits with FilterableJson with UrlHelper{

  def stateLabel(annotation: AnnotationLike, user: Option[User]) = {
    annotation.state match {
      case s if s.isFinished =>
        "Finished"
      case _ =>
        "In Progress"
    }
  }

  def annotationLikeInfoWrites(a: AnnotationLike, user: Option[User], exclude: List[String])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    JsonObjectWithFilter(exclude)(
      "version" +> a.version,
      "user" +> a.user.map(u => User.userCompactWrites.writes(u)).getOrElse(JsNull),
      "created" +> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(a.created),
      "stateLabel" +> stateLabel(a, user),
      "state" +> a.state,
      "id" +> a.id,
      "name" +> a._name.getOrElse(""),
      "typ" +> a.typ,
      "task" +> a.task.flatMap(t => Task.transformToJson(t, user)).getOrElse(JsNull),
      "stats" +> a.statisticsForAnnotation().map(_.writeAsJson).getOrElse(JsNull),
      "restrictions" +> AnnotationRestrictions.writeAsJson(a.restrictions, user),
      "actions" +> a.actions(user),
      "formattedHash" +> Formatter.formatHash(a.id),
      "downloadUrl" +> a.relativeDownloadUrl.map(toAbsoluteUrl),
      "content" +> a.content.flatMap(AnnotationContent.writeAsJson(_)).getOrElse(JsNull),
      "contentType" +> a.content.map(_.contentType).getOrElse(""),
      "dataSetName" +> a.dataSetName
    )
  }
}
