package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.schema.Tables.{Jobs, JobsRow}
import javax.inject.Inject
import models.team.OrganizationDAO
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json.{JsValue, Json}
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, WkConf}
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.ExecutionContext

case class Job(
    _id: String,
    _owner: ObjectId,
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
      Job(r._Id, ObjectId(r._Owner), r.created.getTime, r.isdeleted)
    )

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""_owner = '${requestingUserId}'"""

  def isOwnedBy(_id: String, _user: ObjectId): Fox[Boolean] =
    for {
      results: Seq[String] <- run(
        sql"select _id from #${existingCollectionName} where _id = ${_id} and _owner = ${_user}".as[String])
    } yield results.nonEmpty

  def insertOne(j: Job)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.jobs(_id, _owner, created, isDeleted)
                         values(${j._id}, ${j._owner}, ${new java.sql.Timestamp(j.created)}, ${j.isDeleted})""")
    } yield ()

}

class JobsController @Inject()(wkConf: WkConf,
                               sil: Silhouette[WkEnv],
                               rpc: RPC,
                               jobDAO: JobDAO,
                               organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends Controller {

  def list = sil.SecuredAction.async { implicit request =>
    for {
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/tasks")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .getWithJsonResponse[Map[String, JsValue]]
      keyList = result.keys.toList
      ownedIndices: Seq[Boolean] <- Fox.serialCombined(keyList) { id =>
        jobDAO.isOwnedBy(id, request.identity._id)
      }
      keysFiltered = ownedIndices.zip(keyList).flatMap(tuple => if (tuple._1) Some(tuple._2) else None)
      filteredList = result.filterKeys(key => keysFiltered.contains(key))
    } yield Ok(Json.toJson(filteredList))
  }

  def status(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.assertTrue(jobDAO.isOwnedBy(id, request.identity._id)) ?~> Messages("job.notFound", id) ~> NOT_FOUND
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/task/info/$id")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .getWithJsonResponse[JsValue]
    } yield Ok(Json.toJson(result))
  }

  def runCubingJob(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    val commandJson = Json.obj(
      "kwargs" -> Json
        .obj("organization_name" -> organizationName, "dataset_name" -> dataSetName, "scale" -> "11.24,11.24,25"))
    for {
      organization <- organizationDAO.findOneByName(organizationName) ?~> Messages("organization.notFound",
                                                                                   organizationName)
      _ <- bool2Fox(request.identity._organization == organization._id) ~> FORBIDDEN
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/task/async-apply/tasks.tiff_cubing")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .postWithJsonResponse[JsValue, Map[String, JsValue]](commandJson)
      jobId <- result("task-id").validate[String].toFox ?~> "Could not parse job submit answer"
      job = Job(jobId, request.identity._id)
      _ <- jobDAO.insertOne(job)
    } yield Ok(Json.toJson(result))
  }

}
