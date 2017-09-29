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
import com.typesafe.scalalogging.LazyLogging
import models.tracing.AnnotationStatistics
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

  def description: String

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

  def name = _name getOrElse ""

  def annotationInfo(user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(this, user, Nil)

  def created : Long

  def temporaryDuplicate(keepId: Boolean)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation]

  def makeReadOnly: AnnotationLike

  def saveToDB(implicit ctx: DBAccessContext): Fox[AnnotationLike]

  def tracingTime: Option[Long]

  def isRevertPossible: Boolean = {
    // Unfortunately, we can not revert all tracings, because we do not have the history for all of them
    // hence we need a way to decide if a tracing can safely be revert. We will use the created date of the
    // annotation to do so
    created > 1470002400000L  // 1.8.2016, 00:00:00
  }

  def isPublic: Boolean

  def tags: Set[String]
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

  def createTags(a: AnnotationLike): Future[Set[String]] = {
    (for {
      dataSetName <- a.dataSetName
      content <- a.content
    } yield {
      Set(dataSetName, content.contentType)
    }).getOrElse(Set.empty).map(_ ++ a.tags)
  }

  def annotationLikeInfoWrites(a: AnnotationLike, user: Option[User], exclude: List[String])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    JsonObjectWithFilter(exclude)(
      "version" +> a.version,
      "user" +> a.user.map(u => User.userCompactWrites.writes(u)).getOrElse(JsNull),
      "modified" +> a.content.futureBox.map(content => DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(content.map(_.timestamp).openOr(a.created))),
      "stateLabel" +> stateLabel(a, user),
      "state" +> a.state,
      "id" +> a.id,
      "name" +> a.name,
      "description" +> a.description,
      "typ" +> a.typ,
      "task" +> a.task.flatMap(t => Task.transformToJson(t, user)).getOrElse(JsNull),
      "stats" +> a.statisticsForAnnotation().map(_.writeAsJson).getOrElse(JsNull),
      "restrictions" +> AnnotationRestrictions.writeAsJson(a.restrictions, user),
      "formattedHash" +> Formatter.formatHash(a.id),
      "downloadUrl" +> a.relativeDownloadUrl.map(toAbsoluteUrl),
      "content" +> a.content.flatMap(AnnotationContent.writeAsJson(_)).getOrElse(JsNull),
      "contentType" +> a.content.map(_.contentType).getOrElse(""),
      "dataSetName" +> a.dataSetName,
      "tracingTime" +> a.tracingTime,
      "isPublic" +> a.isPublic,
      "tags" +> createTags(a)
    )
  }
}
