package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.AnnotationSettings
import models.team.TeamSQLDAO
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
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

object TaskTypeSQL {
  def fromTaskType(t: TaskType)(implicit ctx: DBAccessContext) =
    for {
      team <- TeamSQLDAO.findOneByName(t.team)
    } yield {
      TaskTypeSQL(
        ObjectId.fromBsonId(t._id),
        team._id,
        t.summary,
        t.description,
        t.settings,
        System.currentTimeMillis(),
        !t.isActive
      )
    }
}

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
        r.settingsSomaclickingallowed
      ),
      r.created.getTime,
      r.isdeleted
    ))


  def insertOne(t: TaskTypeSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val allowedModes = writeArrayTuple(t.settings.allowedModes)
    for {
      _ <- run(sqlu"""insert into webknossos.taskTypes(_id, _team, summary, description, settings_allowedModes, settings_preferredMode,
                                                       settings_branchPointsAllowed, settings_somaClickingAllowed, created, isDeleted)
                         values(${t._id.id}, ${t._team.id}, ${t.summary}, ${t.description}, '#${sanitize(writeArrayTuple(t.settings.allowedModes))}', #${optionLiteral(t.settings.preferredMode.map(sanitize(_)))},
                                ${t.settings.branchPointsAllowed}, ${t.settings.somaClickingAllowed}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})""")
    } yield ()
  }


  def updateOne(t: TaskTypeSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { //note that t.created is skipped
      _ <- run(sqlu"""update webknossos.taskTypes
                          set
                           _team = ${t._team.id},
                           summary = ${t.summary},
                           description = ${t.description},
                           settings_allowedModes = '#${sanitize(writeArrayTuple(t.settings.allowedModes))}',
                           settings_preferredMode = #${optionLiteral(t.settings.preferredMode.map(sanitize(_)))},
                           settings_branchPointsAllowed = ${t.settings.branchPointsAllowed},
                           settings_somaClickingAllowed = ${t.settings.somaClickingAllowed},
                           isDeleted = ${t.isDeleted}
                          where _id = ${t._id.id}""")
    } yield ()

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

object TaskTypeDAO {
/*
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
  }*/


  def findOneById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[TaskType] = findOneById(id.stringify)

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      taskTypeSQL <- TaskTypeSQLDAO.findOne(ObjectId(id))
      taskType <- TaskType.fromTaskTypeSQL(taskTypeSQL)
    } yield taskType

  def insert(taskType: TaskType)(implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      taskTypeSQL <- TaskTypeSQL.fromTaskType(taskType)
      _ <- TaskTypeSQLDAO.insertOne(taskTypeSQL)
    } yield taskType


  def findAll(implicit ctx: DBAccessContext): Fox[List[TaskType]] =
    for {
      taskTypesSQL <- TaskTypeSQLDAO.findAll
      taskTypes <- Fox.combined(taskTypesSQL.map(TaskType.fromTaskTypeSQL(_)))
    } yield taskTypes


  def update(_id: BSONObjectID, taskType: TaskType)(implicit ctx: DBAccessContext) =
    for {
      taskTypeSQL <- TaskTypeSQL.fromTaskType(taskType.copy(_id = _id))
      _ <- TaskTypeSQLDAO.updateOne(taskTypeSQL)
      updated <- findOneById(_id)
    } yield updated

  def removeById(id: String)(implicit ctx: DBAccessContext) =
    TaskTypeSQLDAO.deleteOne(ObjectId(id))

}
