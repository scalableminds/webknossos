package models.job

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.{RPC, RPCRequest}
import com.scalableminds.webknossos.schema.Tables.Jobs
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.user.{MultiUserDAO, User, UserDAO}
import net.liftweb.common.{Failure, Full}
import oxalis.telemetry.SlackNotificationService
import play.api.libs.json.{JsObject, JsSuccess, JsValue, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, WkConf}

import scala.concurrent.{ExecutionContext, Future}

case class Job(
    _id: ObjectId,
    _owner: ObjectId,
    command: String,
    commandArgs: JsObject = Json.obj(),
    celeryJobId: String,
    celeryInfo: JsObject = Json.obj(),
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
)

class JobDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Job, JobsRow, Jobs](sqlClient) {
  val collection = Jobs

  def idColumn(x: Jobs): Rep[String] = x._Id
  def isDeletedColumn(x: Jobs): Rep[Boolean] = x.isdeleted

  def parse(r: JobsRow): Fox[Job] =
    Fox.successful(
      Job(
        ObjectId(r._Id),
        ObjectId(r._Owner),
        r.command,
        Json.parse(r.commandargs).as[JsObject],
        r.celeryjobid,
        Json.parse(r.celeryinfo).as[JsObject],
        r.created.getTime,
        r.isdeleted
      )
    )

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""_owner = '$requestingUserId'"""

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Job]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from #$existingCollectionName where #$accessQuery order by created".as[JobsRow])
      parsed <- parseAll(r)
    } yield parsed

  def getAllByCeleryIds(celeryJobIds: List[String]): Fox[List[Job]] =
    if (celeryJobIds.isEmpty) Fox.successful(List())
    else {
      for {
        r <- run(
          sql"select #$columns from #$existingCollectionName where celeryJobId in #${writeStructTupleWithQuotes(celeryJobIds)}"
            .as[JobsRow])
        parsed <- parseAll(r)
      } yield parsed
    }

  def isOwnedBy(_id: String, _user: ObjectId): Fox[Boolean] =
    for {
      results: Seq[String] <- run(
        sql"select _id from #$existingCollectionName where _id = ${_id} and _owner = ${_user}".as[String])
    } yield results.nonEmpty

  def insertOne(j: Job): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.jobs(_id, _owner, command, commandArgs, celeryJobId, celeryInfo, created, isDeleted)
                         values(${j._id}, ${j._owner}, ${j.command}, '#${sanitize(j.commandArgs.toString)}', ${j.celeryJobId}, '#${sanitize(
          j.celeryInfo.toString)}', ${new java.sql.Timestamp(j.created)}, ${j.isDeleted})""")
    } yield ()

  def updateCeleryInfoByCeleryId(celeryJobId: String, celeryInfo: JsObject): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""update webknossos.jobs set celeryInfo = '#${sanitize(celeryInfo.toString)}' where celeryJobId = $celeryJobId""")
    } yield ()

}

class JobService @Inject()(wkConf: WkConf,
                           userDAO: UserDAO,
                           multiUserDAO: MultiUserDAO,
                           jobDAO: JobDAO,
                           rpc: RPC,
                           analyticsService: AnalyticsService,
                           slackNotificationService: SlackNotificationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private var celeryInfosLastUpdated: Long = 0
  private val celeryInfosMinIntervalMillis = 3 * 1000 // do not fetch new status more often than once every 3s

  def updateCeleryInfos(): Future[Unit] =
    if (areCeleryInfosOutdated()) {
      Future.successful(())
    } else {
      val updateResult = for {
        _ <- Fox.successful(celeryInfosLastUpdated = System.currentTimeMillis())
        celeryInfoMap <- fetchCeleryInfos()
        _ = trackAllNewlyDone(celeryInfoMap)
        _ <- Fox.serialCombined(celeryInfoMap.keys.toList)(jobId =>
          jobDAO.updateCeleryInfoByCeleryId(jobId, celeryInfoMap(jobId)))
      } yield ()
      updateResult.futureBox.map {
        case Full(_)    => ()
        case f: Failure => logger.warn(s"Could not update celery infos: $f")
        case _          => logger.warn(s"Could not update celery infos (empty)")
      }
    }

  private def areCeleryInfosOutdated(): Boolean =
    celeryInfosLastUpdated > System.currentTimeMillis() - celeryInfosMinIntervalMillis

  def fetchCeleryInfos(): Fox[Map[String, JsObject]] =
    for {
      celeryInfoJson <- flowerRpc("/api/tasks?offset=0").getWithJsonResponse[JsObject]
      celeryInfoMap <- celeryInfoJson
        .validate[Map[String, JsObject]] ?~> "Could not validate celery response as json map"
    } yield celeryInfoMap

  def fetchWorkerStatus(): Fox[JsObject] =
    flowerRpc(s"/api/workers?refresh=true&status=true").getWithJsonResponse[JsObject]

  private def trackAllNewlyDone(celeryInfoMap: Map[String, JsObject]): Fox[Unit] =
    for {
      oldJobs <- jobDAO.getAllByCeleryIds(celeryInfoMap.keys.toList)
      nowFailedJobInfos = filterByStatus(celeryInfoMap: Map[String, JsObject], "FAILURE")
      newlyFailedJobs = getNewlyDoneJobs(oldJobs, nowFailedJobInfos)
      _ = newlyFailedJobs.map(trackNewlyFailed)
      nowSuccessfulJobInfos = filterByStatus(celeryInfoMap: Map[String, JsObject], "SUCCESS")
      newlySuccessfulJobs = getNewlyDoneJobs(oldJobs, nowSuccessfulJobInfos)
      _ = newlySuccessfulJobs.map(trackNewlySuccessful)
    } yield ()

  private def filterByStatus(celeryInfoMap: Map[String, JsObject], statusToFilter: String): Map[String, JsObject] =
    celeryInfoMap.filter(tuple => extractStatus(tuple._2) == statusToFilter)

  private def getNewlyDoneJobs(oldJobs: List[Job], nowDoneJobInfos: Map[String, JsObject]): List[Job] = {
    val previouslyIncompleteJobs = oldJobs.filter(job => isIncomplete(job.celeryInfo))
    val newlyDoneJobs = previouslyIncompleteJobs.filter(job => nowDoneJobInfos.contains(job.celeryJobId))
    newlyDoneJobs.map { job =>
      job.copy(celeryInfo = nowDoneJobInfos(job.celeryJobId))
    }
  }

  def isIncomplete(jobCeleryJson: JsObject): Boolean = {
    val incompleteStates = List("STARTED", "PENDING", "RETRY", "UNKNOWN")
    val status = extractStatus(jobCeleryJson)
    incompleteStates.contains(status)
  }

  private def extractStatus(jobCeleryJson: JsObject, fallback: String = "UNKNOWN"): String = {
    val statusOpt = (jobCeleryJson \ "state").validate[String]
    statusOpt match {
      case JsSuccess(status, _) => status
      case _                    => fallback
    }
  }

  def countByStatus(taskInfos: Map[String, JsObject]): Map[String, Int] =
    taskInfos.values.groupBy(extractStatus(_)).mapValues(_.size)

  private def trackNewlyFailed(job: Job): Unit = {
    for {
      user <- userDAO.findOne(job._owner)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = analyticsService.track(FailedJobEvent(user, job.command))
      _ = slackNotificationService.warn(
        s"Failed job$superUserLabel",
        s"Job ${job._id} failed. Command ${job.command}, celery job id: ${job.celeryJobId}.")
    } yield ()
    ()
  }

  private def trackNewlySuccessful(job: Job): Unit = {
    for {
      user <- userDAO.findOne(job._owner)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = slackNotificationService.info(
        s"Successful job$superUserLabel",
        s"Job ${job._id} succeeded. Command ${job.command}, celery job id: ${job.celeryJobId}."
      )
    } yield ()
    ()
  }

  def publicWrites(job: Job): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> job._id.id,
        "command" -> job.command,
        "commandArgs" -> job.commandArgs,
        "celeryJobId" -> job.celeryJobId,
        "created" -> job.created,
        "celeryInfo" -> job.celeryInfo
      ))

  def getCeleryInfo(job: Job): Fox[JsObject] =
    flowerRpc(s"/api/task/info/${job.celeryJobId}").getWithJsonResponse[JsObject]

  def runJob(command: String, commandArgs: JsObject, owner: User): Fox[Job] =
    for {
      _ <- bool2Fox(wkConf.Features.jobsEnabled) ?~> "jobs.disabled"
      argsWrapped = Json.obj("kwargs" -> commandArgs)
      result <- flowerRpc(s"/api/task/async-apply/tasks.$command")
        .postWithJsonResponse[JsValue, Map[String, JsValue]](argsWrapped)
      celeryJobId <- result("task-id").validate[String].toFox ?~> "Could not parse job submit answer"
      argsWithoutToken = Json.obj("kwargs" -> (commandArgs - "webknossos_token"))
      job = Job(ObjectId.generate, owner._id, command, argsWithoutToken, celeryJobId)
      _ <- jobDAO.insertOne(job)
      _ = analyticsService.track(RunJobEvent(owner, command))
    } yield job

  private def flowerRpc(route: String): RPCRequest =
    rpc(wkConf.Jobs.Flower.uri + route).withBasicAuth(wkConf.Jobs.Flower.user, wkConf.Jobs.Flower.password)

  def assertTiffExportBoundingBoxLimits(bbox: String): Fox[Unit] =
    for {
      boundingBox <- BoundingBox.createFrom(bbox).toFox ?~> "job.export.tiff.invalidBoundingBox"
      _ <- bool2Fox(boundingBox.volume <= wkConf.Features.exportTiffMaxVolumeMVx * 1024 * 1024) ?~> "job.export.tiff.volumeExceeded"
      _ <- bool2Fox(boundingBox.dimensions.maxDim <= wkConf.Features.exportTiffMaxEdgeLengthVx) ?~> "job.export.tiff.edgeLengthExceeded"
    } yield ()

}
