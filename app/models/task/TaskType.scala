package models.task

import models.basics.SecuredBaseDAO
import play.api.libs.json._
import play.api.libs.functional.syntax._
import models.annotation.{AnnotationService, AnnotationSettings}
import reactivemongo.bson.BSONObjectID
import com.scalableminds.util.reactivemongo._
import play.modules.reactivemongo.json.BSONFormats._
import models.user.User
import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import com.scalableminds.util.mvc.Formatter

case class TraceLimit(min: Int, max: Int, maxHard: Int) {

  override def toString = s"$min - $max, Limit: $maxHard"
}

object TraceLimit {
  implicit val timeSpanFormat = Json.format[TraceLimit]
}

case class TaskType(summary: String, description: String, expectedTime: TraceLimit, team: String, settings: AnnotationSettings = AnnotationSettings.default, fileName: Option[String] = None, _id: BSONObjectID = BSONObjectID.generate) {
  val id = _id.stringify
}

object TaskType {

  implicit val taskTypeFormat = Json.format[TaskType]

  def empty = TaskType("", "", TraceLimit(5, 10, 15), "")

  def fromForm(summary: String, description: String, team: String, allowedModes: Seq[String], branchPointsAllowed: Boolean, somaClickingAllowed: Boolean, expectedTime: TraceLimit) =
    TaskType(
      summary,
      description,
      expectedTime,
      team,
      AnnotationSettings(
        allowedModes.toList,
        branchPointsAllowed,
        somaClickingAllowed))

  def toForm(tt: TaskType) =
    Some((
      tt.summary,
      tt.description,
      tt.team,
      tt.settings.allowedModes,
      tt.settings.branchPointsAllowed,
      tt.settings.somaClickingAllowed,
      tt.expectedTime))

    val publicTaskTypeWrites: Writes[TaskType] =
      ((__ \ 'summary).write[String] and
        (__ \ 'description).write[String] and
        (__ \ 'team).write[String] and
        (__ \ 'settings).write[AnnotationSettings] and
        (__ \ 'fileName).write[Option[String]] and
        (__ \ 'expectedTime).write[String] and
        (__ \ 'id).write[String])( tt =>
          (tt.summary, tt.description, tt.team, tt.settings,
            tt.fileName, tt.expectedTime.toString, tt.id))
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

  def findOneBySumnary(summary: String)(implicit ctx: DBAccessContext) = {
    findOne("summary", summary)
  }
}
