package models.job

import java.sql.Timestamp
import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.binary.{DataSetDAO, DataStoreDAO}
import models.job.JobState.JobState
import models.organization.OrganizationDAO
import models.user.{MultiUserDAO, User, UserDAO}
import oxalis.telemetry.SlackNotificationService
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, WkConf}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.duration._

case class Job(
    _id: ObjectId,
    _owner: ObjectId,
    _dataStore: String,
    command: String,
    commandArgs: JsObject = Json.obj(),
    state: JobState = JobState.PENDING,
    manualState: Option[JobState] = None,
    _worker: Option[ObjectId] = None,
    latestRunId: Option[String] = None,
    returnValue: Option[String] = None,
    started: Option[Long] = None,
    ended: Option[Long] = None,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
) {
  def isEnded: Boolean = {
    val relevantState = manualState.getOrElse(state)
    relevantState == JobState.SUCCESS || state == JobState.FAILURE
  }

  def duration: Option[FiniteDuration] =
    for {
      e <- ended
      s <- started
    } yield (e - s).millis

  def effectiveState: JobState = manualState.getOrElse(state)

  def exportFileName: Option[String] = argAsStringOpt("export_file_name")

  def datasetName: Option[String] = argAsStringOpt("dataset_name")

  private def argAsStringOpt(key: String) = (commandArgs \ key).toOption.flatMap(_.asOpt[String])

  def resultLink(organizationName: String, dataStorePublicUrl: String): Option[String] =
    if (effectiveState != JobState.SUCCESS) None
    else {
      command match {
        case "convert_to_wkw" =>
          datasetName.map { dsName =>
            s"/datasets/$organizationName/$dsName/view"
          }
        case "export_tiff" =>
          Some(s"$dataStorePublicUrl/data/exports/${_id.id}/download")
        case "infer_nuclei" | "infer_neurons" | "materialize_volume_annotation" =>
          returnValue.map { resultDatasetName =>
            s"/datasets/$organizationName/$resultDatasetName/view"
          }
        case _ => None
      }
    }
}

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
        r._Datastore.trim,
        r.command,
        Json.parse(r.commandargs).as[JsObject],
        state,
        manualStateOpt,
        r._Worker.map(ObjectId(_)),
        r.latestrunid,
        r.returnvalue,
        r.started.map(_.getTime),
        r.ended.map(_.getTime),
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

  override def findOne(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Job] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from #$existingCollectionName where #$accessQuery and _id = $jobId".as[JobsRow])
      parsed <- parseFirst(r, jobId)
    } yield parsed

  def countUnassignedPendingForDataStore(_dataStore: String): Fox[Int] =
    for {
      r <- run(sql"""select count(_id) from #$existingCollectionName
              where state = '#${JobState.PENDING}'
              and manualState is null
              and _dataStore = ${_dataStore}
              and _worker is null""".as[Int])
      head <- r.headOption
    } yield head

  def countUnfinishedByWorker(workerId: ObjectId): Fox[Int] =
    for {
      r <- run(
        sql"select count(_id) from #$existingCollectionName where _worker = $workerId and state in ('#${JobState.PENDING}', '#${JobState.STARTED}') and manualState is null"
          .as[Int])
      head <- r.headOption
    } yield head

  def findAllUnfinishedByWorker(workerId: ObjectId): Fox[List[Job]] =
    for {
      r <- run(
        sql"select #$columns from #$existingCollectionName where _worker = $workerId and state in ('#${JobState.PENDING}', '#${JobState.STARTED}') and manualState is null order by created"
          .as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  /*
   * Jobs that are cancelled by the user (manualState set to cancelled)
   * but not yet cancelled in the worker (state not yet set to cancelled)
   * are sent to the worker in to_cancel list. These are gathered here.
   * Compare the note on the job cancelling protocol in JobsController
   */
  def findAllCancellingByWorker(workerId: ObjectId): Fox[List[Job]] =
    for {
      r <- run(
        sql"select #$columns from #$existingCollectionName where _worker = $workerId and state != '#${JobState.CANCELLED}' and manualState = '#${JobState.CANCELLED}'"
          .as[JobsRow])
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
        sqlu"""insert into webknossos.jobs(_id, _owner, _dataStore, command, commandArgs, state, manualState, _worker, latestRunId,
               returnValue, started, ended, created, isDeleted)
                         values(${j._id}, ${j._owner}, ${j._dataStore}, ${j.command}, '#${sanitize(
          j.commandArgs.toString)}',
                          '#${j.state.toString}', #${optionLiteralSanitized(j.manualState.map(_.toString))},
                          #${optionLiteral(j._worker.map(_.toString))},
                          #${optionLiteralSanitized(j.latestRunId)},
                          #${optionLiteralSanitized(j.returnValue)},
                          #${optionLiteral(j.started.map(_.toString))},
                          #${optionLiteral(j.ended.map(_.toString))},
                          ${new java.sql.Timestamp(j.created)}, ${j.isDeleted})""")
    } yield ()

  def updateManualState(id: ObjectId, manualState: JobState)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"""update webknossos.jobs set manualState = '#${manualState.toString}' where _id = $id""")
    } yield ()

  def updateStatus(jobId: ObjectId, s: JobStatus): Fox[Unit] = {
    val format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX")
    val startedTimestamp = s.started.map(started => format.format(new Timestamp(started)))
    val endedTimestamp = s.ended.map(ended => format.format(new Timestamp(ended)))
    for {
      _ <- run(sqlu"""update webknossos.jobs set
              latestRunId = #${optionLiteralSanitized(s.latestRunId)},
              state = '#${s.state.toString}',
              returnValue = #${optionLiteralSanitized(s.returnValue)},
              started = #${optionLiteralSanitized(startedTimestamp)},
              ended = #${optionLiteralSanitized(endedTimestamp)}
              where _id = $jobId""")
    } yield ()
  }

  def reserveNextJob(worker: Worker): Fox[Unit] = {
    val query =
      sqlu"""
          with subquery as (
            select _id
            from webknossos.jobs_
            where
              state = '#${JobState.PENDING}'
              and _dataStore = ${worker._dataStore}
              and manualState is NULL
              and _worker is NULL
            order by created
            limit 1
          )
          update webknossos.jobs_ j
          set _worker = ${worker._id}
          from subquery
          where j._id = subquery._id
          """
    for {
      _ <- run(
        query.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
  }

  def countByState: Fox[Map[String, Int]] =
    for {
      result <- run(sql"""select state, count(_id)
                           from webknossos.jobs_
                           where manualState is null
                           group by state
                           order by state
                           """.as[(String, Int)])
    } yield result.toMap

}

class JobService @Inject()(wkConf: WkConf,
                           userDAO: UserDAO,
                           multiUserDAO: MultiUserDAO,
                           jobDAO: JobDAO,
                           dataStoreDAO: DataStoreDAO,
                           organizationDAO: OrganizationDAO,
                           dataSetDAO: DataSetDAO,
                           analyticsService: AnalyticsService,
                           slackNotificationService: SlackNotificationService,
                           val lifecycle: ApplicationLifecycle,
                           val system: ActorSystem)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Formatter {

  def trackStatusChange(jobBeforeChange: Job, jobAfterChange: Job): Unit = {
    if (jobBeforeChange.isEnded) return
    if (jobAfterChange.state == JobState.SUCCESS) trackNewlySuccessful(jobBeforeChange, jobAfterChange)
    if (jobAfterChange.state == JobState.FAILURE) trackNewlyFailed(jobBeforeChange, jobAfterChange)
  }

  private def trackNewlyFailed(jobBeforeChange: Job, jobAfterChange: Job): Unit = {
    for {
      user <- userDAO.findOne(jobBeforeChange._owner)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      durationLabel = jobAfterChange.duration.map(d => s" after ${formatDuration(d)}").getOrElse("")
      _ = analyticsService.track(FailedJobEvent(user, jobBeforeChange.command))
      msg = s"Job ${jobBeforeChange._id} failed$durationLabel. Command ${jobBeforeChange.command}, organization name: ${organization.name}."
      _ = logger.warn(msg)
      _ = slackNotificationService.warn(
        s"Failed job$superUserLabel",
        msg
      )
    } yield ()
    ()
  }

  private def trackNewlySuccessful(jobBeforeChange: Job, jobAfterChange: Job): Unit = {
    for {
      user <- userDAO.findOne(jobBeforeChange._owner)(GlobalAccessContext)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      dataStore <- dataStoreDAO.findOneByName(jobBeforeChange._dataStore)(GlobalAccessContext)
      resultLink = jobAfterChange.resultLink(organization.name, dataStore.publicUrl)
      resultLinkMrkdwn = resultLink.map(l => s" <${wkConf.Http.uri}$l|Result>").getOrElse("")
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      durationLabel = jobAfterChange.duration.map(d => s" after ${formatDuration(d)}").getOrElse("")
      msg = s"Job ${jobBeforeChange._id} succeeded$durationLabel. Command ${jobBeforeChange.command}, organization name: ${organization.name}.$resultLinkMrkdwn"
      _ = logger.info(msg)
      _ = slackNotificationService.success(
        s"Successful job$superUserLabel",
        msg
      )
    } yield ()
    ()
  }

  def cleanUpIfFailed(job: Job): Fox[Unit] =
    if (job.state == JobState.FAILURE && job.command == "convert_to_wkw") {
      logger.info(s"WKW conversion job ${job._id} failed. Deleting dataset from the database, freeing the name...")
      val commandArgs = job.commandArgs.value
      for {
        datasetName <- commandArgs.get("dataset_name").map(_.as[String]).toFox
        organizationName <- commandArgs.get("organization_name").map(_.as[String]).toFox
        dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(GlobalAccessContext)
        _ <- dataSetDAO.deleteDataset(dataset._id)
      } yield ()
    } else Fox.successful(())

  def publicWrites(job: Job)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      owner <- userDAO.findOne(job._owner) ?~> "user.notFound"
      organization <- organizationDAO.findOne(owner._organization) ?~> "organization.notFound"
      dataStore <- dataStoreDAO.findOneByName(job._dataStore) ?~> "dataStore.notFound"
      resultLink = job.resultLink(organization.name, dataStore.publicUrl)
    } yield {
      Json.obj(
        "id" -> job._id.id,
        "command" -> job.command,
        "commandArgs" -> (job.commandArgs - "webknossos_token" - "user_auth_token"),
        "state" -> job.state,
        "manualState" -> job.manualState,
        "latestRunId" -> job.latestRunId,
        "returnValue" -> job.returnValue,
        "resultLink" -> resultLink,
        "created" -> job.created,
        "started" -> job.started,
        "ended" -> job.ended,
      )
    }

  def parameterWrites(job: Job): JsObject =
    Json.obj(
      "job_id" -> job._id.id,
      "command" -> job.command,
      "job_kwargs" -> job.commandArgs
    )

  def submitJob(command: String, commandArgs: JsObject, owner: User, dataStoreName: String): Fox[Job] =
    for {
      _ <- bool2Fox(wkConf.Features.jobsEnabled) ?~> "job.disabled"
      job = Job(ObjectId.generate, owner._id, dataStoreName, command, commandArgs)
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
