package models.task

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
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
import utils.{ObjectId, SQLDAO, SecuredSQLDAO}

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
    Fox.successful(TaskTypeSQL(
        ObjectId.fromBsonId(t._id),
        ObjectId.fromBsonId(t._team),
        t.summary,
        t.description,
        t.settings,
        System.currentTimeMillis(),
        !t.isActive
      ))
}

object TaskTypeSQLDAO extends SQLDAO[TaskTypeSQL, TasktypesRow, Tasktypes] with SecuredSQLDAO {
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

  override def readAccessQ(requestingUserId: ObjectId) = s"_team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')"
  override def updateAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}')
      or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TaskTypeSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[TasktypesRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TaskTypeSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery}".as[TasktypesRow])
      parsed <- Fox.combined(r.toList.map(parse)) ?~> ("SQLDAO Error: Could not parse one of the database rows in " + collectionName)
    } yield parsed


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
      _ <- assertUpdateAccess(t._id)
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
                     _team: BSONObjectID,
                     settings: AnnotationSettings = AnnotationSettings.defaultFor(TracingType.skeleton),
                     isActive: Boolean = true,
                     _id: BSONObjectID = BSONObjectID.generate) {

  val id = _id.stringify
  val team = _team.stringify
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
      BSONObjectID(team),
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
      teamIdBson <- s._team.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
    } yield {
      TaskType(
        s.summary,
        s.description,
        teamIdBson,
        s.settings,
        !s.isDeleted,
        idBson
      )
    }
}

object TaskTypeDAO {

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

  def removeById(_id: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskTypeSQLDAO.deleteOne(ObjectId.fromBsonId(_id))

}
