package models.task

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import models.annotation.{AnnotationSettings, TracingMode}
import models.team.TeamDAO
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SqlClient, SQLDAO}
import utils.ObjectId

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

  def containsVolumeOrHybridTaskType(taskTypeIds: List[String])(implicit ctx: DBAccessContext): Fox[Boolean] =
    Fox
      .serialCombined(taskTypeIds) { taskTypeId =>
        for {
          taskTypeIdValidated <- ObjectId.fromString(taskTypeId) ?~> "taskType.id.invalid"
          taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
        } yield taskType.tracingType == TracingType.volume || taskType.tracingType == TracingType.hybrid
      }
      .map(_.exists(_ == true))

  def idOrSummaryToId(taskTypeIdOrSummary: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[String] =
    (for {
      taskType <- taskTypeDAO.findOneBySummaryAndOrganization(taskTypeIdOrSummary, organizationId)
    } yield taskType._id.toString).orElse(for {
      taskTypeId <- ObjectId.fromString(taskTypeIdOrSummary)
      _ <- taskTypeDAO.findOne(taskTypeId)
    } yield taskTypeId.toString)
}

class TaskTypeDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TaskType, TasktypesRow, Tasktypes](sqlClient) {
  protected val collection = Tasktypes

  protected def idColumn(x: Tasktypes): Rep[String] = x._Id
  protected def isDeletedColumn(x: Tasktypes): Rep[Boolean] = x.isdeleted

  protected def parse(r: TasktypesRow): Fox[TaskType] =
    for {
      tracingType <- TracingType.fromString(r.tracingtype) ?~> "failed to parse tracing type"
      settingsAllowedModes <- Fox.combined(parseArrayTuple(r.settingsAllowedmodes).map(TracingMode.fromString(_).toFox)) ?~> "failed to parse tracing mode"
    } yield
      TaskType(
        ObjectId(r._Id),
        ObjectId(r._Team),
        r.summary,
        r.description,
        AnnotationSettings(
          settingsAllowedModes,
          r.settingsPreferredmode,
          r.settingsBranchpointsallowed,
          r.settingsSomaclickingallowed,
          r.settingsVolumeinterpolationallowed,
          r.settingsMergermode,
          ResolutionRestrictions(r.settingsResolutionrestrictionsMin, r.settingsResolutionrestrictionsMax)
        ),
        r.recommendedconfiguration.map(Json.parse),
        tracingType,
        Instant.fromSql(r.created),
        r.isdeleted
      )

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""(_team in (select _team from webknossos.user_team_roles where _user = $requestingUserId)
       or _organization = (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin))"""

  override protected def updateAccessQ(requestingUserId: ObjectId) =
    q"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = $requestingUserId)
       or _organization = (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select #${columns.debugInfo} from #${existingCollectionName.debugInfo} where _id = ${id.id} and #${accessQuery.debugInfo}"
          .as[TasktypesRow])
      parsed <- parseFirst(r, id.toString)
    } yield parsed

  def findOneBySummaryAndOrganization(summary: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[TaskType] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns.debugInfo} from #${existingCollectionName.debugInfo} where summary = '#${sanitize(
        summary)}' and _organization = $organizationId and #${accessQuery.debugInfo}".as[TasktypesRow])
      parsed <- parseFirst(r, summary)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TaskType]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select #${columns.debugInfo} from #${existingCollectionName.debugInfo} where #${accessQuery.debugInfo}"
          .as[TasktypesRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(t: TaskType, organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.taskTypes(
                          _id, _organization, _team, summary, description, settings_allowedModes, settings_preferredMode,
                          settings_branchPointsAllowed, settings_somaClickingAllowed, settings_volumeInterpolationAllowed, settings_mergerMode,
                          settings_resolutionRestrictions_min, settings_resolutionRestrictions_max,
                          recommendedConfiguration, tracingType, created, isDeleted)
                       values(${t._id.id}, $organizationId, ${t._team.id}, ${t.summary}, ${t.description},
                              '#${writeArrayTuple(t.settings.allowedModes.map(_.toString))}',
                              #${optionLiteral(t.settings.preferredMode.map(sanitize))},
                              ${t.settings.branchPointsAllowed},
                              ${t.settings.somaClickingAllowed},
                              ${t.settings.volumeInterpolationAllowed},
                              ${t.settings.mergerMode},
                              #${optionLiteral(t.settings.resolutionRestrictions.min.map(_.toString))},
                              #${optionLiteral(t.settings.resolutionRestrictions.max.map(_.toString))},
                              #${optionLiteral(t.recommendedConfiguration.map(c => sanitize(Json.toJson(c).toString)))},
                              '#${t.tracingType.toString}',
                              ${t.created}, ${t.isDeleted})
                       """)
    } yield ()

  def updateOne(t: TaskType)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { // note that t.created is immutable, hence skipped here
      _ <- assertUpdateAccess(t._id)
      allowedModesLiteral = sanitize(writeArrayTuple(t.settings.allowedModes.map(_.toString)))
      resolutionMinLiteral = optionLiteral(t.settings.resolutionRestrictions.min.map(_.toString))
      resolutionMaxLiteral = optionLiteral(t.settings.resolutionRestrictions.max.map(_.toString))
      configurationLiteral = optionLiteral(t.recommendedConfiguration.map(c => sanitize(Json.toJson(c).toString)))
      _ <- run(sqlu"""update webknossos.taskTypes
                        set
                         _team = ${t._team.id},
                         summary = ${t.summary},
                         description = ${t.description},
                         settings_allowedModes = '#$allowedModesLiteral',
                         settings_preferredMode = #${optionLiteral(t.settings.preferredMode.map(sanitize))},
                         settings_branchPointsAllowed = ${t.settings.branchPointsAllowed},
                         settings_somaClickingAllowed = ${t.settings.somaClickingAllowed},
                         settings_volumeInterpolationAllowed = ${t.settings.volumeInterpolationAllowed},
                         settings_mergerMode = ${t.settings.mergerMode},
                         settings_resolutionRestrictions_min = #$resolutionMinLiteral,
                           settings_resolutionRestrictions_max = #$resolutionMaxLiteral,
                           recommendedConfiguration = #$configurationLiteral,
                           isDeleted = ${t.isDeleted}
                          where _id = ${t._id.id}""")
    } yield ()

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(sql"select count(_id) from #${existingCollectionName.debugInfo} where _team = $teamId".as[Int])
      count <- countList.headOption
    } yield count
}
