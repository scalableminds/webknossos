package models.task

import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import models.annotation.AnnotationSettings
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.DBAccessContext
import play.modules.reactivemongo.json.BSONFormats._
import models.user.User

case class TimeSpan(min: Int, max: Int, maxHard: Int) {

  override def toString = s"$min - $max, Limit: $maxHard"
}

object TimeSpan {
  implicit val timeSpanFormat = Json.format[TimeSpan]
}

case class TaskType(summary: String, description: String, expectedTime: TimeSpan, team: String, settings: AnnotationSettings = AnnotationSettings.default, fileName: Option[String] = None, _id: BSONObjectID = BSONObjectID.generate) {
  val id = _id.stringify
}

object TaskType {

  implicit val taskTypeFormat = Json.format[TaskType]

  def empty = TaskType("", "", TimeSpan(5, 10, 15), "")

  def fromForm(summary: String, description: String, team: String, allowedModes: Seq[String], branchPointsAllowed: Boolean, somaClickingAllowed: Boolean, expectedTime: TimeSpan) =
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
}

object TaskTypeDAO extends SecuredBaseDAO[TaskType] {

  val collectionName = "taskTypes"
  val formatter = TaskType.taskTypeFormat

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

  def findOneBySumnary(summary: String)(implicit ctx: DBAccessContext) = {
    findOne("summary", summary)
  }
}