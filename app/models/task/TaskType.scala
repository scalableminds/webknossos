package models.task

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import models.annotation.{AnnotationSettings, TracingMode}
import models.team.TeamDAO
import play.api.libs.json._
import slick.lifted.Rep
import utils.sql.{EnumerationArrayValue, SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class TaskType(
    _id: ObjectId,
    _team: ObjectId,
    summary: String,
    description: String,
    settings: AnnotationSettings = AnnotationSettings.defaultFor(TracingType.skeleton),
    recommendedConfiguration: Option[JsValue] = None,
    tracingType: TracingType = TracingType.skeleton,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class TaskTypeService @Inject()(teamDAO: TeamDAO, taskTypeDAO: TaskTypeDAO)(implicit ec: ExecutionContext) {

  def fromForm(
      summary: String,
      description: String,
      team: ObjectId,
      settings: AnnotationSettings,
      recommendedConfiguration: Option[JsValue],
      tracingType: TracingType
  ): TaskType =
    TaskType(ObjectId.generate, team, summary, description, settings, recommendedConfiguration, tracingType)

  def publicWrites(taskType: TaskType): Fox[JsObject] =
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

}

class TaskTypeDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TaskType, TasktypesRow, Tasktypes](sqlClient) {
  protected val collection = Tasktypes

  protected def idColumn(x: Tasktypes): Rep[String] = x._Id
  protected def isDeletedColumn(x: Tasktypes): Rep[Boolean] = x.isdeleted

  protected def parse(r: TasktypesRow): Fox[TaskType] =
    for {
      tracingType <- TracingType.fromString(r.tracingtype) ?~> "failed to parse tracing type"
      settingsAllowedModes <- Fox.combined(
        parseArrayLiteral(r.settingsAllowedmodes)
          .map(TracingMode.fromString(_).toFox)) ?~> "failed to parse tracing mode"
      settingsPreferredMode = r.settingsPreferredmode.flatMap(TracingMode.fromString)
    } yield
      TaskType(
        ObjectId(r._Id),
        ObjectId(r._Team),
        r.summary,
        r.description,
        AnnotationSettings(
          settingsAllowedModes,
          settingsPreferredMode,
          r.settingsBranchpointsallowed,
          r.settingsSomaclickingallowed,
          r.settingsVolumeinterpolationallowed,
          r.settingsMergermode,
          MagRestrictions(r.settingsMagrestrictionsMin, r.settingsMagrestrictionsMax)
        ),
        r.recommendedconfiguration.map(Json.parse),
        tracingType,
        Instant.fromSql(r.created),
        r.isdeleted
      )

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""(_team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId)
       OR _organization = (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin))"""

  override protected def updateAccessQ(requestingUserId: ObjectId) =
    q"""(_team IN (SELECT _team FROM webknossos.user_team_roles WHERE isTeamManager AND _user = $requestingUserId)
       OR _organization = (SELECT _organization from webknossos.users_ WHERE _id = $requestingUserId AND isAdmin))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[TasktypesRow])
      parsed <- parseFirst(r, id.toString)
    } yield parsed

  def findOneBySummaryAndOrganization(summary: String, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE summary = $summary
                   AND _organization = $organizationId
                   AND $accessQuery""".as[TasktypesRow])
      parsed <- parseFirst(r, summary)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TaskType]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[TasktypesRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(t: TaskType, organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.taskTypes(
                          _id, _organization, _team, summary, description, settings_allowedModes, settings_preferredMode,
                          settings_branchPointsAllowed, settings_somaClickingAllowed, settings_volumeInterpolationAllowed, settings_mergerMode,
                          settings_magRestrictions_min, settings_magRestrictions_max,
                          recommendedConfiguration, tracingType, created, isDeleted)
                   VALUES(${t._id}, $organizationId, ${t._team}, ${t.summary}, ${t.description},
                           ${EnumerationArrayValue(t.settings.allowedModes, "webknossos.TASKTYPE_MODES")},
                           ${t.settings.preferredMode},
                           ${t.settings.branchPointsAllowed},
                           ${t.settings.somaClickingAllowed},
                           ${t.settings.volumeInterpolationAllowed},
                           ${t.settings.mergerMode},
                           ${t.settings.magRestrictions.min},
                           ${t.settings.magRestrictions.max},
                           ${t.recommendedConfiguration.map(Json.toJson(_))},
                           ${t.tracingType},
                           ${t.created}, ${t.isDeleted})
                    """.asUpdate)
    } yield ()

  def updateOne(t: TaskType)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { // note that t.created is immutable, hence skipped here
      _ <- assertUpdateAccess(t._id)
      _ <- run(q"""UPDATE webknossos.taskTypes
                   SET
                     _team = ${t._team},
                     summary = ${t.summary},
                     description = ${t.description},
                     settings_allowedModes = ${EnumerationArrayValue(t.settings.allowedModes,
                                                                     "webknossos.TASKTYPE_MODES")},
                     settings_preferredMode = ${t.settings.preferredMode},
                     settings_branchPointsAllowed = ${t.settings.branchPointsAllowed},
                     settings_somaClickingAllowed = ${t.settings.somaClickingAllowed},
                     settings_volumeInterpolationAllowed = ${t.settings.volumeInterpolationAllowed},
                     settings_mergerMode = ${t.settings.mergerMode},
                     settings_magRestrictions_min = ${t.settings.magRestrictions.min},
                     settings_magRestrictions_max = ${t.settings.magRestrictions.max},
                     recommendedConfiguration = ${t.recommendedConfiguration.map(Json.toJson(_))},
                     isDeleted = ${t.isDeleted}
                   WHERE _id = ${t._id}""".asUpdate)
    } yield ()

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(q"SELECT COUNT(*) FROM $existingCollectionName WHERE _team = $teamId".as[Int])
      count <- countList.headOption
    } yield count

  override def deleteOne(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    deleteOneWithNameSuffix(taskTypeId, nameColumn = "summary")
}
