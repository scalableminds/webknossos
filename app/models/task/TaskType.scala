package models.task

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables.{Tasktypes, _}
import models.annotation.AnnotationSettings
import models.basics.SecuredBaseDAO
import models.team.TeamSQLDAO
import models.user.User
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

case class TaskTypeSQL(
                         _id: ObjectId,
                         _team: ObjectId,
                         summary: String,
                         description: String,
                         settings: AnnotationSettings,
                         created: Long = System.currentTimeMillis(),
                         isDeleted: Boolean = false
                         )

object TaskTypeSQLDAO extends SQLDAO[TaskTypeSQL, TasktypesRow, Tasktypes] {
  val collection = Tasktypes

  def idColumn(x: Tasktypes): Rep[String] = x._Id
  def isDeletedColumn(x: Tasktypes): Rep[Boolean] = x.isdeleted

  def parse(r: TasktypesRow): Fox[TaskTypeSQL] =
    Some(TaskTypeSQL(
      ObjectId(r._Id),
      ObjectId(r._Team),
      r.summary,
      r.description,
      AnnotationSettings(
        parseArrayTuple(r.settingsAllowedmodes),
        r.settingsPreferredmode,
        r.settingsBranchpointsallowed,
        r.settingsSomaclickingallowed,
        r.settingsAdvancedoptionsallowed
      ),
      r.created.getTime,
      r.isdeleted
    ))
}






case class TaskType(
                     summary: String,
                     description: String,
                     team: String,
                     settings: AnnotationSettings = AnnotationSettings.defaultFor(TracingType.skeleton),
                     isActive: Boolean = true,
                     _id: BSONObjectID = BSONObjectID.generate) {

  val id = _id.stringify
}

object TaskType extends FoxImplicits {

  implicit val taskTypeFormat = Json.format[TaskType]

  def fromForm(
    summary: String,
    description: String,
    team: String,
    settings: AnnotationSettings) = {

    TaskType(
      summary,
      description,
      team,
      settings)
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

  def fromTaskTypeSQL(s: TaskTypeSQL)(implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
      team <- TeamSQLDAO.findOne(s._team)
    } yield {
      TaskType(
        s.summary,
        s.description,
        team.name,
        s.settings,
        !s.isDeleted,
        idBson
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
