package models.job

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.binary.{DataSetDAO, DataStoreDAO}
import models.job.JobState.JobState
import models.organization.OrganizationDAO
import models.user.{MultiUserDAO, User, UserDAO}
import oxalis.telemetry.SlackNotificationService
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{FiniteDuration, _}

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
    created: Instant = Instant.now,
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

  def resultLinkSlackFormatted(organizationName: String,
                               dataStorePublicUrl: String,
                               webKnossosPublicUrl: String): Option[String] =
    for {
      resultLink <- resultLink(organizationName, dataStorePublicUrl)
      resultLinkFormatted = if (resultLink.startsWith("/")) s" <$webKnossosPublicUrl$resultLink|Result>"
      else s" <$resultLink|Result>"
    } yield resultLinkFormatted
}

class JobDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Job, JobsRow, Jobs](sqlClient) {
  protected val collection = Jobs

  protected def idColumn(x: Jobs): Rep[String] = x._Id
  protected def isDeletedColumn(x: Jobs): Rep[Boolean] = x.isdeleted

  protected def parse(r: JobsRow): Fox[Job] =
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
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""_owner = $requestingUserId"""

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Job]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where $accessQuery order by created".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  override def findOne(jobId: ObjectId)(implicit ctx: DBAccessContext): Fox[Job] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where $accessQuery and _id = $jobId".as[JobsRow])
      parsed <- parseFirst(r, jobId)
    } yield parsed

  def countUnassignedPendingForDataStore(dataStoreName: String): Fox[Int] =
    for {
      r <- run(q"""select count(_id) from $existingCollectionName
                   where state = ${JobState.PENDING}
                   and manualState is null
                   and _dataStore = $dataStoreName
                   and _worker is null""".as[Int])
      head <- r.headOption
    } yield head

  def countUnfinishedByWorker(workerId: ObjectId): Fox[Int] =
    for {
      r <- run(q"""SELECT COUNT(_id)
                   FROM $existingCollectionName
                   WHERE _worker = $workerId
                   AND state in ${SqlToken.tupleFromValues(JobState.PENDING, JobState.STARTED)}
                   AND manualState IS NULL""".as[Int])
      head <- r.headOption
    } yield head

  def findAllUnfinishedByWorker(workerId: ObjectId): Fox[List[Job]] =
    for {
      r <- run(q"""SELECT $columns from $existingCollectionName
                   WHERE _worker = $workerId and state in ${SqlToken
        .tupleFromValues(JobState.PENDING, JobState.STARTED)}
                   AND manualState IS NULL
                   ORDER BY created""".as[JobsRow])
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
      r <- run(q"""SELECT $columns from $existingCollectionName
                   WHERE _worker = $workerId
                   AND state != ${JobState.CANCELLED}
                   AND manualState = ${JobState.CANCELLED}""".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(j: Job): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.jobs(
                    _id, _owner, _dataStore, command, commandArgs,
                    state, manualState, _worker,
                    latestRunId, returnValue, started, ended,
                    created, isDeleted
                   )
                   VALUES(
                    ${j._id}, ${j._owner}, ${j._dataStore}, ${j.command}, ${j.commandArgs},
                    ${j.state}, ${j.manualState}, ${j._worker},
                    ${j.latestRunId}, ${j.returnValue}, ${j.started}, ${j.ended},
                    ${j.created}, ${j.isDeleted})""".asUpdate)
    } yield ()

  def updateManualState(id: ObjectId, manualState: JobState)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""update webknossos.jobs set manualState = $manualState where _id = $id""".asUpdate)
    } yield ()

  def updateStatus(jobId: ObjectId, s: JobStatus): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.jobs SET
                   latestRunId = ${s.latestRunId},
                   state = ${s.state},
                   returnValue = ${s.returnValue},
                   started = ${s.started},
                   ended = ${s.ended}
                   where _id = $jobId""".asUpdate)
    } yield ()

  def reserveNextJob(worker: Worker): Fox[Unit] = {
    val query = q"""
          with subquery as (
            select _id
            from $existingCollectionName
            where
              state = ${JobState.PENDING}
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
          """.asUpdate
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
      result <- run(q"""select state, count(_id)
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
                           workerDAO: WorkerDAO,
                           dataStoreDAO: DataStoreDAO,
                           organizationDAO: OrganizationDAO,
                           dataSetDAO: DataSetDAO,
                           analyticsService: AnalyticsService,
                           slackNotificationService: SlackNotificationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Formatter {

  def trackStatusChange(jobBeforeChange: Job, jobAfterChange: Job): Unit =
    if (!jobBeforeChange.isEnded) {
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
      resultLink = jobAfterChange.resultLinkSlackFormatted(organization.name, dataStore.publicUrl, wkConf.Http.uri)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      durationLabel = jobAfterChange.duration.map(d => s" after ${formatDuration(d)}").getOrElse("")
      msg = s"Job ${jobBeforeChange._id} succeeded$durationLabel. Command ${jobBeforeChange.command}, organization name: ${organization.name}.${resultLink
        .getOrElse("")}"
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

  def submitJob(command: String, commandArgs: JsObject, owner: User, dataStoreName: String)(
      implicit ctx: DBAccessContext): Fox[Job] =
    for {
      _ <- bool2Fox(wkConf.Features.jobsEnabled) ?~> "job.disabled"
      _ <- assertDataStoreHasWorkers(dataStoreName) ?~> "job.noWorkerForDatastore"
      job = Job(ObjectId.generate, owner._id, dataStoreName, command, commandArgs)
      _ <- jobDAO.insertOne(job)
      _ = analyticsService.track(RunJobEvent(owner, command))
    } yield job

  private def assertDataStoreHasWorkers(dataStoreName: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- dataStoreDAO.findOneByName(dataStoreName)
      _ <- workerDAO.findOneByDataStore(dataStoreName)
    } yield ()

  def assertTiffExportBoundingBoxLimits(bbox: String): Fox[Unit] =
    for {
      boundingBox <- BoundingBox.fromLiteral(bbox).toFox ?~> "job.export.tiff.invalidBoundingBox"
      _ <- bool2Fox(boundingBox.volume <= wkConf.Features.exportTiffMaxVolumeMVx * 1024 * 1024) ?~> "job.export.tiff.volumeExceeded"
      _ <- bool2Fox(boundingBox.dimensions.maxDim <= wkConf.Features.exportTiffMaxEdgeLengthVx) ?~> "job.export.tiff.edgeLengthExceeded"
    } yield ()

}
