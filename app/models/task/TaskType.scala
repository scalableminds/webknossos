package models.task

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import models.annotation.AnnotationSettings
import models.team.TeamDAO
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class TaskType(
    _id: ObjectId,
    _team: ObjectId,
    summary: String,
    description: String,
    settings: AnnotationSettings = AnnotationSettings.defaultFor(TracingType.skeleton),
    recommendedConfiguration: Option[JsValue] = None,
    tracingType: TracingType.Value = TracingType.skeleton,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
)

class TaskTypeService @Inject()(teamDAO: TeamDAO, taskTypeDAO: TaskTypeDAO)(implicit ec: ExecutionContext) {

  def fromForm(
      summary: String,
      description: String,
      team: String,
      settings: AnnotationSettings,
      recommendedConfiguration: Option[JsValue],
      tracingType: TracingType.Value
  ): TaskType =
    TaskType(ObjectId.generate, ObjectId(team), summary, description, settings, recommendedConfiguration, tracingType)

  def publicWrites(taskType: TaskType)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      team <- teamDAO.findOne(taskType._team)(GlobalAccessContext) ?~> "team.notFound"
    } yield
      Json.obj(
        "id" -> taskType._id.toString,
        "summary" -> taskType.summary,
        "description" -> taskType.description,
        "teamId" -> team._id.toString,
        "teamName" -> team.name,
        "settings" -> Json.toJson(taskType.settings),
        "recommendedConfiguration" -> taskType.recommendedConfiguration,
        "tracingType" -> taskType.tracingType
      )

  def containsVolumeOrHybridTaskType(taskTypeIds: List[String])(implicit ctx: DBAccessContext): Fox[Boolean] =
    Fox
      .serialCombined(taskTypeIds) { taskTypeId =>
        for {
          taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
          taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
        } yield taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid
      }
      .map(_.exists(_ == true))
}

class TaskTypeDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TaskType, TasktypesRow, Tasktypes](sqlClient) {
  val collection = Tasktypes

  def idColumn(x: Tasktypes): Rep[String] = x._Id
  def isDeletedColumn(x: Tasktypes): Rep[Boolean] = x.isdeleted

  def parse(r: TasktypesRow): Fox[TaskType] =
    for {
      tracingType <- TracingType.fromString(r.tracingtype) ?~> "failed to parse tracing type"
    } yield
      TaskType(
        ObjectId(r._Id),
        ObjectId(r._Team),
        r.summary,
        r.description,
        AnnotationSettings(
          parseArrayTuple(r.settingsAllowedmodes),
          r.settingsPreferredmode,
          r.settingsBranchpointsallowed,
          r.settingsSomaclickingallowed,
          r.settingsMergermode,
          ResolutionRestrictions(r.settingsResolutionrestrictionsMin, r.settingsResolutionrestrictionsMax)
        ),
        r.recommendedconfiguration.map(Json.parse),
        tracingType,
        r.created.getTime,
        r.isdeleted
      )

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
          in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  override def updateAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}')
      or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}"
          .as[TasktypesRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TaskType]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery}".as[TasktypesRow])
      parsed <- Fox.combined(r.toList.map(parse)) ?~> ("SQLDAO Error: Could not parse one of the database rows in " + collectionName)
    } yield parsed

  def insertOne(t: TaskType)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val allowedModes = writeArrayTuple(t.settings.allowedModes)
    for {
      _ <- run(
        sqlu"""insert into webknossos.taskTypes(_id, _team, summary, description, settings_allowedModes, settings_preferredMode,
                                                       settings_branchPointsAllowed, settings_somaClickingAllowed, settings_mergerMode, settings_resolutionRestrictions_min, settings_resolutionRestrictions_max, recommendedConfiguration, tracingType, created, isDeleted)
                         values(${t._id.id}, ${t._team.id}, ${t.summary}, ${t.description}, '#${sanitize(
          writeArrayTuple(t.settings.allowedModes))}', #${optionLiteral(t.settings.preferredMode.map(sanitize))},
                                ${t.settings.branchPointsAllowed}, ${t.settings.somaClickingAllowed}, ${t.settings.mergerMode}, #${optionLiteral(
          t.settings.resolutionRestrictions.min.map(_.toString))}, #${optionLiteral(
          t.settings.resolutionRestrictions.max.map(_.toString))}, #${optionLiteral(
          t.recommendedConfiguration.map(c => sanitize(Json.toJson(c).toString)))}, '#${t.tracingType.toString}',
                                ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})""")
    } yield ()
  }

  def updateOne(t: TaskType)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { //note that t.created is skipped
      _ <- assertUpdateAccess(t._id)
      _ <- run(sqlu"""update webknossos.taskTypes
                          set
                           _team = ${t._team.id},
                           summary = ${t.summary},
                           description = ${t.description},
                           settings_allowedModes = '#${sanitize(writeArrayTuple(t.settings.allowedModes))}',
                           settings_preferredMode = #${optionLiteral(t.settings.preferredMode.map(sanitize))},
                           settings_branchPointsAllowed = ${t.settings.branchPointsAllowed},
                           settings_somaClickingAllowed = ${t.settings.somaClickingAllowed},
                           settings_mergerMode = ${t.settings.mergerMode},
                           settings_resolutionRestrictions_min = #${optionLiteral(
        t.settings.resolutionRestrictions.min.map(_.toString))},
                           settings_resolutionRestrictions_max = #${optionLiteral(
        t.settings.resolutionRestrictions.max.map(_.toString))},
                           recommendedConfiguration = #${optionLiteral(
        t.recommendedConfiguration.map(c => sanitize(Json.toJson(c).toString)))},
                           isDeleted = ${t.isDeleted}
                          where _id = ${t._id.id}""")
    } yield ()

}
