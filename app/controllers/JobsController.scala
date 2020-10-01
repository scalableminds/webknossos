package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.schema.Tables.{Jobs, JobsRow}
import javax.inject.Inject
import models.team.OrganizationDAO
import models.user.User
import net.liftweb.common.Full
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, WkConf}
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.ExecutionContext

case class Job(
    _id: ObjectId,
    _owner: ObjectId,
    command: String,
    commandArgs: JsObject = Json.obj(),
    celeryJobId: String,
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
      Job(ObjectId(r._Id),
          ObjectId(r._Owner),
          r.command,
          Json.parse(r.commandargs).as[JsObject],
          r.celeryjobid,
          r.created.getTime,
          r.isdeleted)
    )

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""_owner = '$requestingUserId'"""

  def isOwnedBy(_id: String, _user: ObjectId): Fox[Boolean] =
    for {
      results: Seq[String] <- run(
        sql"select _id from #$existingCollectionName where _id = ${_id} and _owner = ${_user}".as[String])
    } yield results.nonEmpty

  def insertOne(j: Job)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.jobs(_id, _owner, command, commandArgs, celeryJobId, created, isDeleted)
                         values(${j._id}, ${j._owner}, ${j.command}, '#${sanitize(j.commandArgs.toString)}', ${j.celeryJobId}, ${new java.sql.Timestamp(
        j.created)}, ${j.isDeleted})""")
    } yield ()

}

class JobService @Inject()(wkConf: WkConf, jobDAO: JobDAO, rpc: RPC)(implicit ec: ExecutionContext)
    extends FoxImplicits {
  def publicWrites(job: Job): Fox[JsObject] =
    for {
      celeryInfoBox <- getCeleryInfo(job).futureBox
      celeryInfoJson = celeryInfoBox match {
        case Full(s) => s
        case _       => Json.obj()
      }
      json = Json.obj(
        "id" -> job._id.id,
        "command" -> job.command,
        "commandArgs" -> job.commandArgs,
        "celeryJobId" -> job.celeryJobId,
        "created" -> job.created,
        "celeryInfo" -> celeryInfoJson
      )
    } yield json

  def getCeleryInfo(job: Job): Fox[JsObject] =
    rpc(s"${wkConf.Jobs.Flower.uri}/api/task/info/${job.celeryJobId}")
      .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
      .getWithJsonResponse[JsObject]

  def runJob(command: String, commandArgs: JsObject, owner: User)(implicit ctx: DBAccessContext): Fox[Job] =
    for {
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/task/async-apply/tasks.$command")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .postWithJsonResponse[JsValue, Map[String, JsValue]](commandArgs)
      celeryJobId <- result("task-id").validate[String].toFox ?~> "Could not parse job submit answer"
      job = Job(ObjectId.generate, owner._id, command, commandArgs, celeryJobId)
      _ <- jobDAO.insertOne(job)
    } yield job

}

class JobsController @Inject()(jobDAO: JobDAO,
                               sil: Silhouette[WkEnv],
                               jobService: JobService,
                               organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends Controller {

  def list = sil.SecuredAction.async { implicit request =>
    for {
      jobs <- jobDAO.findAll
      jobsJsonList <- Fox.serialCombined(jobs.sortBy(-_.created))(jobService.publicWrites)
    } yield Ok(Json.toJson(jobsJsonList))
  }

  def get(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      job <- jobDAO.findOne(ObjectId(id))
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

  def runCubingJob(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    for {
      organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                   organizationName)
      _ <- bool2Fox(request.identity._organization == organization._id) ~> FORBIDDEN
      command = "tiff_cubing"
      commandArgs = Json.obj(
        "kwargs" -> Json
          .obj("organization_name" -> organizationName, "dataset_name" -> dataSetName, "scale" -> "11.24,11.24,25"))

      job <- jobService.runJob(command, commandArgs, request.identity)
      js <- jobService.publicWrites(job)
    } yield Ok(js)
  }

}
