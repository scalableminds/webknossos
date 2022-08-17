package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import controllers.VoxelyticsLogLevel.VoxelyticsLogLevel
import io.swagger.annotations._
import models.organization.OrganizationDAO
import models.user.{UserDAO, UserService}
import oxalis.security.WkEnv
import play.api.http.HeaderNames
import play.api.http.HttpEntity.NoEntity
import play.api.libs.json._
import play.api.mvc.{ResponseHeader, _}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

object VoxelyticsLogLevel extends ExtendedEnumeration {
  type VoxelyticsLogLevel = Value
  val NOTSET, DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL = Value
}

class ElasticsearchClient @Inject()(wkConf: WkConf, rpc: RPC)(implicit ec: ExecutionContext) extends LazyLogging {

  private lazy val conf = wkConf.Voxelytics.Elasticsearch

  def queryLogs(runName: String,
                organizationName: String,
                taskName: Option[String],
                minLevel: VoxelyticsLogLevel = VoxelyticsLogLevel.INFO): Fox[JsValue] = {

    val levels = VoxelyticsLogLevel.values - minLevel

    var queryStringParts = List(
      s"vx.run_name:${'"'}${runName}${'"'}",
      s"vx.run_name:${'"'}${organizationName}${'"'}",
      s"level:(${levels.map(_.toString).mkString(" OR ")})"
    )
    if (taskName.isDefined) {
      queryStringParts +: s"vx.task_name:${'"'}${taskName}${'"'}"
    }

    val scrollBody = Json.obj(
      "size" -> JsNumber(10000),
      "query" -> Json.obj("query_string" -> Json.obj("query" -> queryStringParts.mkString(" AND "))),
      "sort" -> Json.arr(Json.obj("@timestamp" -> Json.obj("order" -> "asc")))
    )

    var buffer = List.empty[JsValue]

    def fetchBatch(scrollId: String): Fox[String] =
      for {
        batch <- rpc(s"${conf.host}/_search/scroll")
          .postJsonWithJsonResponse[JsValue, JsValue](Json.obj("scroll" -> "1m", "scroll_id" -> scrollId))
        batchScrollId = (batch \ "_scroll_id").as[String]
        batchHits = (batch \ "hits" \ "hits").as[List[JsValue]]
        _ = { buffer ++= batchHits }
        returnedScrollId <- if (batchHits.isEmpty) {
          Fox.successful(scrollId)
        } else {
          fetchBatch(batchScrollId)
        }
      } yield (returnedScrollId)

    for {
      scroll <- rpc(s"${conf.host}/${conf.index}/_search?scroll=1m")
        .postJsonWithJsonResponse[JsValue, JsValue](scrollBody) ~> "Could not fetch logs"
      scrollId = (scroll \ "_scroll_id").as[String]
      scrollHits = (scroll \ "hits" \ "hits").as[List[JsValue]]
      _ = { buffer ++= scrollHits }
      lastScrollId <- fetchBatch(scrollId)
      _ <- rpc(s"${conf.host}/_search/scroll/${lastScrollId}").delete()
    } yield JsArray(buffer)

  }

  def bulkInsert(logEntries: List[JsValue]): Fox[Unit] = {
    if (conf.host.isEmpty || logEntries.isEmpty) return Fox.successful(())
    val uri = s"${conf.host}/_bulk"
    val bytes = logEntries
      .flatMap(entry =>
        List(Json.toBytes(Json.obj("create" -> Json.obj("_index" -> conf.index, "_id" -> ""))), Json.toBytes(entry)))
      .fold(Array.emptyByteArray)((rest, entry) => rest ++ entry ++ "\n".getBytes)

    for {
      res <- rpc(uri)
        .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
        .postBytesWithJsonResponse[JsValue](bytes)
      _ <- Fox.bool2Fox((res \ "errors").asOpt[List[JsValue]].forall(_.isEmpty))
    } yield ()
  }
}

case class VoxelyticsWorkflowDescription(workflowHash: String)

object VoxelyticsWorkflowDescription {
  implicit val jsonFormat: OFormat[VoxelyticsWorkflowDescription] = Json.format[VoxelyticsWorkflowDescription]
}

@Api
class VoxelyticsController @Inject()(
    userDAO: UserDAO,
    organizationDAO: OrganizationDAO,
    userService: UserService,
    elasticsearchClient: ElasticsearchClient,
    wkConf: WkConf,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private lazy val conf = wkConf.Voxelytics

  @ApiOperation(hidden = true, value = "")
  def createWorkflow: Action[VoxelyticsWorkflowDescription] =
    sil.SecuredAction.async(validateJson[VoxelyticsWorkflowDescription]) { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def listWorkflows(workflowHash: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def getWorkflow(workflowHash: String, runId: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def createWorkflowEvents(workflowHash: String, runName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def getChunkStatistics(workflowHash: String, runId: String, taskName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def getArtifactChecksums(workflowHash: String,
                           runId: String,
                           taskName: Option[String],
                           artifactName: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      notImplemented
    }

  @ApiOperation(hidden = true, value = "")
  def appendLogs: Action[List[JsValue]] =
    sil.SecuredAction.async(validateJson[List[JsValue]]) { implicit request =>
      for {
        _ <- elasticsearchClient.bulkInsert(request.body) ~> BAD_REQUEST
      } yield Ok
    }

  @ApiOperation(hidden = true, value = "")
  def getLogs(runId: String, taskName: Option[String], minLevel: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      val runName = runId
      val organizationName = request.identity._organization.id
      for {
        logEntries <- elasticsearchClient.queryLogs(
          runName,
          organizationName,
          taskName,
          minLevel.flatMap(VoxelyticsLogLevel.fromString).getOrElse(VoxelyticsLogLevel.INFO)) ~> BAD_REQUEST
      } yield JsonOk(logEntries)
    }

  private def notImplemented: Future[Result] = Future.successful(Result(ResponseHeader(NOT_IMPLEMENTED), NoEntity))
}
