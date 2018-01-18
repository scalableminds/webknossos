package models.task

import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import models.annotation.AnnotationSettings
import models.basics.SecuredBaseDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._


case class TaskType(
                     summary: String,
                     description: String,
                     team: BSONObjectID,
                     settings: AnnotationSettings = AnnotationSettings.defaultFor(TracingType.skeleton),
                     isActive: Boolean = true,
                     _id: BSONObjectID = BSONObjectID.generate) {

  val id = _id.stringify
}

object TaskType {

  implicit val taskTypeFormat = Json.format[TaskType]

  def fromForm(
    summary: String,
    description: String,
    team: BSONObjectID,
    settings: AnnotationSettings) = {

    TaskType(
      summary,
      description,
      team,
      settings) //TODO Frontend
  }

  def toForm(tt: TaskType) =
    Some((
      tt.summary,
      tt.description,
      tt.team,
      tt.settings.allowedModes,
      tt.settings.preferredMode,
      tt.settings.branchPointsAllowed,
      tt.settings.somaClickingAllowed))

  def transformToJson(tt: TaskType)(implicit ctx: DBAccessContext) = {
    Json.obj(
      "id" -> tt.id,
      "summary" -> tt.summary,
      "description" -> tt.description,
      "team" -> tt.team,
      "settings" -> Json.toJson(tt.settings)
    )
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
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.supervisorTeamIds)))
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
