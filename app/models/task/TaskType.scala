package models.task

import play.api.libs.concurrent.Execution.Implicits._
import models.basics.SecuredBaseDAO
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools._
import play.api.libs.functional.syntax._
import models.annotation.{AnnotationService, AnnotationSettings}
import reactivemongo.bson.BSONObjectID
import com.scalableminds.util.reactivemongo._
import play.modules.reactivemongo.json.BSONFormats._
import models.user.User
import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import com.scalableminds.util.mvc.Formatter
import scala.async.Async._
import com.scalableminds.util.reactivemongo.{DefaultAccessDefinitions, DBAccessContext}
import scala.concurrent.Future

case class TraceLimit(min: Int, max: Int, maxHard: Int) {

  override def toString = s"$min - $max, Limit: $maxHard"
}

object TraceLimit {
  implicit val timeSpanFormat = Json.format[TraceLimit]
}

case class TaskType(
  summary: String,
  description: String,
  expectedTime: TraceLimit,
  team: String,
  settings: AnnotationSettings = AnnotationSettings.default,
  fileName: Option[String] = None,
  isActive: Boolean = true,
  _id: BSONObjectID = BSONObjectID.generate) {

  val id = _id.stringify

  def status(implicit ctx: DBAccessContext) = {
    for {
      tasks <- TaskDAO.findAllByTaskType(_id).getOrElse(List.empty)
      taskStatus <- Future.sequence(tasks.map(_.status))
    } yield {
      taskStatus.fold(CompletionStatus(0, 0, 0))(CompletionStatus.combine)
    }
  }
}

object TaskType {

  implicit val taskTypeFormat = Json.format[TaskType]

  def empty = TaskType("", "", TraceLimit(5, 10, 15), "")

  def fromForm(
    summary: String,
    description: String,
    team: String,
    allowedModes: Seq[String],
    preferredMode: Option[String],
    branchPointsAllowed: Boolean,
    advancedOptionsAllowed: Boolean,
    somaClickingAllowed: Boolean,
    expectedTime: TraceLimit) = {

    TaskType(
      summary,
      description,
      expectedTime,
      team,
      AnnotationSettings(
        allowedModes.toList,
        preferredMode,
        branchPointsAllowed,
        somaClickingAllowed,
        advancedOptionsAllowed))
  }

  def toForm(tt: TaskType) =
    Some((
      tt.summary,
      tt.description,
      tt.team,
      tt.settings.allowedModes,
      tt.settings.preferredMode,
      tt.settings.branchPointsAllowed,
      tt.settings.advancedOptionsAllowed,
      tt.settings.somaClickingAllowed,
      tt.expectedTime))

  def transformToJson(tt: TaskType)(implicit ctx: DBAccessContext) = {
    Json.obj(
      "id" -> tt.id,
      "summary" -> tt.summary,
      "description" -> tt.description,
      "team" -> tt.team,
      "settings" -> Json.toJson(tt.settings),
      "fileName" -> tt.fileName,
      "expectedTime" -> tt.expectedTime.toString
    )
  }

  def transformToJsonWithStatus(tt: TaskType)(implicit ctx: DBAccessContext): Future[JsObject] = {
      tt.status.map {
        status =>
          transformToJson(tt) + ("status" -> Json.toJson(status))
      }
    }
}

object TaskTypeDAO extends SecuredBaseDAO[TaskType] {

  val collectionName = "taskTypes"
  val formatter = TaskType.taskTypeFormat

  override val AccessDefinitions = new DefaultAccessDefinitions{

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)))
        case _ =>
          DenyEveryone()
      }
    }
  }

  override def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) =
    super.find(query ++ Json.obj("isActive" -> true))

  override def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) =
    super.findOne(query ++ Json.obj("isActive" -> true))

  def findOneById(id: BSONObjectID, includeDeleted: Boolean = false)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    if(includeDeleted)
      super.find(Json.obj("_id" -> id)).one[TaskType]
    else
      super.find(Json.obj("_id" -> id, "isActive" -> true)).one[TaskType]
  }

  def findOneBySumnary(summary: String)(implicit ctx: DBAccessContext) = {
    findOne("summary", summary)
  }
}
