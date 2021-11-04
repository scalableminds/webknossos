package models.job

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables.Jobs
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.job.JobState.JobState
import models.organization.OrganizationDAO
import models.user.{MultiUserDAO, User, UserDAO}
import oxalis.telemetry.SlackNotificationService
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, WkConf}

import scala.concurrent.ExecutionContext

case class Job(
    _id: ObjectId,
    _owner: ObjectId,
    command: String,
    commandArgs: JsObject = Json.obj(),
    state: JobState = JobState.PENDING,
    manualState: Option[JobState] = None,
    _worker: Option[ObjectId] = None,
    latestRunId: Option[String] = None,
    returnValue: Option[String] = None,
    started: Option[Long] = None,
    completed: Option[Long] = None,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
)

class JobDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Job, JobsRow, Jobs](sqlClient) {
  val collection = Jobs

  def idColumn(x: Jobs): Rep[String] = x._Id
  def isDeletedColumn(x: Jobs): Rep[Boolean] = x.isdeleted

  def parse(r: JobsRow): Fox[Job] =
    for {
      manualStateOpt <- Fox.runOptional(r.manualstate)(JobState.fromString)
      state <- JobState.fromString(r.state)
    } yield {
      Job(
        ObjectId(r._Id),
        ObjectId(r._Owner),
        r.command,
        Json.parse(r.commandargs).as[JsObject],
        state,
        manualStateOpt,
        r._Worker.map(ObjectId(_)),
        r.latestrunid,
        r.returnvalue,
        r.started.map(_.getTime),
        r.completed.map(_.getTime),
        r.created.getTime,
        r.isdeleted
      )
    }

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""_owner = '$requestingUserId'"""

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Job]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from #$existingCollectionName where #$accessQuery order by created".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  def isOwnedBy(_id: String, _user: ObjectId): Fox[Boolean] =
    for {
      results: Seq[String] <- run(
        sql"select _id from #$existingCollectionName where _id = ${_id} and _owner = ${_user}".as[String])
    } yield results.nonEmpty

  def insertOne(j: Job): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.jobs(_id, _owner, command, commandArgs, state, manualState, _worker, latestRunId,
               returnValue, started, completed, created, isDeleted)
                         values(${j._id}, ${j._owner}, ${j.command}, '#${sanitize(j.commandArgs.toString)}',
                          '#${j.state.toString}', #${optionLiteralSanitized(j.manualState.map(_.toString))},
                          #${optionLiteral(j._worker.map(_.toString))},
                          #${optionLiteralSanitized(j.latestRunId)},
                          #${optionLiteralSanitized(j.returnValue)},
                          #${optionLiteral(j.started.map(_.toString))},
                          #${optionLiteral(j.completed.map(_.toString))},
                          ${new java.sql.Timestamp(j.created)}, ${j.isDeleted})""")
    } yield ()

  def updateStatus(jobId: ObjectId, s: JobStatus): Fox[Unit] =
    for {
      _ <- run(sqlu"""update webknossos.jobs set
              latest_run_id = ${s.latestRunId},
              state = ${s.state.toString},
              return_value = #${optionLiteralSanitized(s.returnValue)},
              started = #${optionLiteralSanitized(s.started.map(_.toString))},
              completed = #${optionLiteralSanitized(s.completed.map(_.toString))},
              where _id = $jobId""")
    } yield ()

}

class JobService @Inject()(wkConf: WkConf,
                           userDAO: UserDAO,
                           multiUserDAO: MultiUserDAO,
                           jobDAO: JobDAO,
                           organizationDAO: OrganizationDAO,
                           analyticsService: AnalyticsService,
                           slackNotificationService: SlackNotificationService,
                           val lifecycle: ApplicationLifecycle,
                           val system: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val incompleteStates = List("STARTED", "PENDING", "RETRY", "UNKNOWN")

  private def trackNewlyFailed(job: Job): Unit = {
    for {
      user <- userDAO.findOne(job._owner)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = analyticsService.track(FailedJobEvent(user, job.command))
      _ = slackNotificationService.warn(
        s"Failed job$superUserLabel",
        s"Job ${job._id} failed. Command ${job.command}, organization name: ${organization.name}."
      )
    } yield ()
    ()
  }

  private def trackNewlySuccessful(job: Job): Unit = {
    for {
      user <- userDAO.findOne(job._owner)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = slackNotificationService.info(
        s"Successful job$superUserLabel",
        s"Job ${job._id} succeeded. Command ${job.command}, organization name: ${organization.name}."
      )
    } yield ()
    ()
  }

  def publicWrites(job: Job): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> job._id,
        "command" -> job.command,
        "commandArgs" -> (job.commandArgs - "webknossos_token"),
        "state" -> job.state,
        "manualState" -> job.manualState,
        "latestRunId" -> job.latestRunId,
        "returnValue" -> job.returnValue,
        "started" -> job.started,
        "completed" -> job.completed,
      ))

  def submitJob(command: String, commandArgs: JsObject, owner: User): Fox[Job] =
    for {
      _ <- bool2Fox(wkConf.Features.jobsEnabled) ?~> "job.disabled"
      argsWrapped = Json.obj("kwargs" -> commandArgs)
      job = Job(ObjectId.generate, owner._id, command, commandArgs)
      _ <- jobDAO.insertOne(job)
      _ = analyticsService.track(RunJobEvent(owner, command))
    } yield job

  def assertTiffExportBoundingBoxLimits(bbox: String): Fox[Unit] =
    for {
      boundingBox <- BoundingBox.createFrom(bbox).toFox ?~> "job.export.tiff.invalidBoundingBox"
      _ <- bool2Fox(boundingBox.volume <= wkConf.Features.exportTiffMaxVolumeMVx * 1024 * 1024) ?~> "job.export.tiff.volumeExceeded"
      _ <- bool2Fox(boundingBox.dimensions.maxDim <= wkConf.Features.exportTiffMaxEdgeLengthVx) ?~> "job.export.tiff.edgeLengthExceeded"
    } yield ()

}
