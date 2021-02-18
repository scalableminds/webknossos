package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.{RPC, RPCRequest}
import com.scalableminds.webknossos.schema.Tables.{Jobs, JobsRow}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.analytics.{AnalyticsService, RunJobEvent}
import models.organization.OrganizationDAO
import models.user.User
import net.liftweb.common.{Failure, Full}
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
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

class JobService @Inject()(wkConf: WkConf, jobDAO: JobDAO, rpc: RPC, analyticsService: AnalyticsService)(
    implicit ec: ExecutionContext)
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
        celeryInfoJson <- flowerRpc("/api/tasks").getWithJsonResponse[JsObject]
        celeryInfoMap <- celeryInfoJson
          .validate[Map[String, JsObject]] ?~> "Could not validate celery response as json map"
        _ <- Fox.serialCombined(celeryInfoMap.keys.toList)(jobId =>
          jobDAO.updateCeleryInfoByCeleryId(jobId, celeryInfoMap(jobId)))
      } yield ()
      updateResult.futureBox.map {
        case Full(_)    => ()
        case f: Failure => logger.warn(s"Could not update celery infos: $f")
        case _          => logger.warn(s"Could not update celery infos (empty)")
      }
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
      result <- flowerRpc(s"/api/task/async-apply/tasks.$command")
        .postWithJsonResponse[JsValue, Map[String, JsValue]](commandArgs)
      celeryJobId <- result("task-id").validate[String].toFox ?~> "Could not parse job submit answer"
      job = Job(ObjectId.generate, owner._id, command, commandArgs, celeryJobId)
      _ <- jobDAO.insertOne(job)
      _ = analyticsService.track(RunJobEvent(owner, command))
    } yield job

  private def flowerRpc(route: String): RPCRequest =
    rpc(wkConf.Jobs.Flower.uri + route).withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
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
        commandArgs = Json.obj(
          "kwargs" -> Json
            .obj("organization_name" -> organizationName, "dataset_name" -> dataSetName, "scale" -> scale))

        job <- jobService.runJob(command, commandArgs, request.identity) ?~> "job.couldNotRunCubing"
        js <- jobService.publicWrites(job)
      } yield Ok(js)
    }

}
