package controllers

import java.nio.file.{Files, Paths}
import java.util.Date

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.{RPC, RPCRequest}
import com.scalableminds.webknossos.schema.Tables.{Jobs, JobsRow}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.analytics.{AnalyticsService, FailedJobEvent, RunJobEvent}
import models.annotation.TracingStoreRpcClient
import models.organization.OrganizationDAO
import models.user.{User, UserDAO}
import net.liftweb.common.{Failure, Full}
import oxalis.security.WkEnv
import oxalis.telemetry.SlackNotificationService
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
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

  def getAllByCeleryIds(celeryJobIds: List[String]): Fox[List[Job]] =
    for {
      rList <- run(
        sql"select #$columns from #$existingCollectionName where celeryJobId in #${writeStructTupleWithQuotes(celeryJobIds)}"
          .as[JobsRow])
      parsed <- Fox.combined(rList.toList.map(parse))
    } yield parsed

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
                           jobDAO: JobDAO,
                           rpc: RPC,
                           analyticsService: AnalyticsService,
                           slackNotificationService: SlackNotificationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private var celeryInfosLastUpdated: Long = 0
  private val celeryInfosMinIntervalMillis = 3 * 1000 // do not fetch new status more often than once every 3s

  def updateCeleryInfos(): Future[Unit] =
    if (celeryInfosLastUpdated > System.currentTimeMillis() - celeryInfosMinIntervalMillis) {
      Future.successful(())
    } else {
      val updateResult = for {
        _ <- Fox.successful(celeryInfosLastUpdated = System.currentTimeMillis())
        celeryInfoJson <- flowerRpc("/api/tasks?offset=0").getWithJsonResponse[JsObject]
        celeryInfoMap <- celeryInfoJson
          .validate[Map[String, JsObject]] ?~> "Could not validate celery response as json map"
        _ = trackAllNewlyFailed(celeryInfoMap)
        _ <- Fox.serialCombined(celeryInfoMap.keys.toList)(jobId =>
          jobDAO.updateCeleryInfoByCeleryId(jobId, celeryInfoMap(jobId)))
      } yield ()
      updateResult.futureBox.map {
        case Full(_)    => ()
        case f: Failure => logger.warn(s"Could not update celery infos: $f")
        case _          => logger.warn(s"Could not update celery infos (empty)")
      }
    }

  private def trackAllNewlyFailed(celeryInfoMap: Map[String, JsObject]): Fox[Unit] =
    for {
      oldJobs <- jobDAO.getAllByCeleryIds(celeryInfoMap.keys.toList)
      nowFailedJobInfos = filterFailed(celeryInfoMap: Map[String, JsObject])
      newlyFailedJobs = getNewlyFailedJobs(oldJobs, nowFailedJobInfos)
      _ = newlyFailedJobs.map(trackNewlyFailed)
    } yield ()

  private def filterFailed(celeryInfoMap: Map[String, JsObject]): Map[String, JsObject] =
    celeryInfoMap.filter(tuple => {
      val statusOpt = (tuple._2 \ "state").validate[String]
      statusOpt match {
        case JsSuccess(status, _) =>
          if (status == "FAILURE") true
          else false
        case _ => false
      }
    })

  private def getNewlyFailedJobs(oldJobs: List[Job], nowFailedJobInfos: Map[String, JsObject]): List[Job] = {
    val failableStates = List("STARTED", "PENDING", "RETRY")
    val previouslyFailableJobs = oldJobs.filter(job => {
      val oldSatusOpt = (job.celeryInfo \ "state").validate[String]
      oldSatusOpt match {
        case JsSuccess(status, _) => failableStates.contains(status)
        case _                    => true
      }
    })
    val newlyFailedJobs = previouslyFailableJobs.filter(job => nowFailedJobInfos.contains(job.celeryJobId))
    newlyFailedJobs.map { job =>
      job.copy(celeryInfo = nowFailedJobInfos(job.celeryJobId))
    }
  }

  private def trackNewlyFailed(job: Job): Unit = {
    for {
      user <- userDAO.findOne(job._owner)(GlobalAccessContext)
      _ = analyticsService.track(FailedJobEvent(user, job.command))
      _ = slackNotificationService.warn(
        "Failed job",
        s"Job ${job._id} failed. Command ${job.command}, celeryJobId: ${job.celeryJobId}.")
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
    rpc(wkConf.Jobs.Flower.uri + route).withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)

  def assertTiffExportBoundingBoxLimits(bbox: String): Fox[Unit] =
    for {
      boundingBox <- BoundingBox.createFrom(bbox).toFox ?~> "job.export.tiff.invalidBoundingBox"
      _ <- bool2Fox(boundingBox.volume <= wkConf.Features.exportTiffMaxVolumeMVx * 1024 * 1024) ?~> "job.export.tiff.volumeExceeded"
      _ <- bool2Fox(boundingBox.dimensions.maxDim <= wkConf.Features.exportTiffMaxEdgeLengthVx) ?~> "job.export.tiff.edgeLengthExceeded"
    } yield ()
}

class JobsController @Inject()(jobDAO: JobDAO,
                               sil: Silhouette[WkEnv],
                               jobService: JobService,
                               organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends Controller {

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- jobService.updateCeleryInfos()
      jobs <- jobDAO.findAll
      jobsJsonList <- Fox.serialCombined(jobs.sortBy(-_.created))(jobService.publicWrites)
    } yield Ok(Json.toJson(jobsJsonList))
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- jobService.updateCeleryInfos()
      job <- jobDAO.findOne(ObjectId(id))
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  def runCubingJob(organizationName: String, dataSetName: String, scale: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                     organizationName)
        _ <- bool2Fox(request.identity._organization == organization._id) ~> FORBIDDEN
        command = "tiff_cubing"
        commandArgs = Json.obj("organization_name" -> organizationName, "dataset_name" -> dataSetName, "scale" -> scale)

        job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunCubing"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def runTiffExportJob(organizationName: String,
                       dataSetName: String,
                       bbox: String,
                       layerName: Option[String],
                       tracingId: Option[String],
                       tracingVersion: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                     organizationName)
        _ <- bool2Fox(request.identity._organization == organization._id) ?~> "job.export.notAllowed.organization" ~> FORBIDDEN
        _ <- jobService.assertTiffExportBoundingBoxLimits(bbox)
        command = "export_tiff"
        exportFileName = s"${formatDateForFilename(new Date())}__${dataSetName}__${tracingId.map(_ => "volume").getOrElse(layerName.getOrElse(""))}.zip"
        commandArgs = Json.obj(
          "organization_name" -> organizationName,
          "dataset_name" -> dataSetName,
          "bbox" -> bbox,
          "webknossos_token" -> TracingStoreRpcClient.webKnossosToken,
          "export_file_name" -> exportFileName,
          "layer_name" -> layerName,
          "volume_tracing_id" -> tracingId,
          "volume_tracing_version" -> tracingVersion
        )
        job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunTiffExport"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

  def downloadExport(jobId: String, exportFileName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        jobIdValidated <- ObjectId.parse(jobId)
        job <- jobDAO.findOne(jobIdValidated)
        organization <- organizationDAO.findOne(request.identity._organization)
        filePath = Paths.get("binaryData", organization.name, ".export", job.celeryJobId, exportFileName)
        _ <- bool2Fox(Files.exists(filePath)) ?~> "job.export.fileNotFound"
      } yield Ok.sendPath(filePath, inline = false)
    }

}
