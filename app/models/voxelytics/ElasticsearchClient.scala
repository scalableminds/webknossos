package models.voxelytics

import akka.actor.ActorSystem
import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.voxelytics.VoxelyticsLogLevel.VoxelyticsLogLevel
import net.liftweb.common.Full
import play.api.http.{HeaderNames, Status}
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsArray, JsNumber, JsValue, Json}
import utils.WkConf

import java.time.{Duration, LocalDateTime}
import java.util.UUID
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.{FiniteDuration, SECONDS}
import scala.concurrent.{ExecutionContext, Future}

class ElasticsearchClient @Inject()(wkConf: WkConf,
                                    rpc: RPC,
                                    val lifecycle: ApplicationLifecycle,
                                    val system: ActorSystem)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MimeTypes {

  private lazy val conf = wkConf.Voxelytics.Elasticsearch
  val SCROLL_SIZE = 10000
  val POLLING_INTERVAL = FiniteDuration(1, SECONDS)

  private lazy val elasticsearchSchema = Json.obj(
    "settings" -> Json.obj(),
    "mappings" -> Json.obj(
      "properties" -> Json.obj(
        "@timestamp" -> Json.obj("type" -> "date"),
        "@version" -> Json.obj("type" -> "text",
                               "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
        "level" -> Json.obj("type" -> "text",
                            "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
        "message" -> Json.obj("type" -> "text",
                              "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
        "vx" -> Json.obj("properties" -> Json.obj(
          "hostname" -> Json.obj(
            "type" -> "text",
            "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
          "logger_name" -> Json.obj(
            "type" -> "text",
            "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
          "run_name" -> Json.obj(
            "type" -> "text",
            "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
          "task_name" -> Json.obj(
            "type" -> "text",
            "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
          "wk_org" -> Json.obj("type" -> "text",
                               "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
          "wk_url" -> Json.obj("type" -> "text",
                               "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256))),
          "workflow_hash" -> Json.obj(
            "type" -> "text",
            "fields" -> Json.obj("keyword" -> Json.obj("type" -> "keyword", "ignore_above" -> 256)))
        ))
      ))
  )

  private lazy val serverStartupFuture: Fox[Unit] = {
    logger.info("Waiting for Elasticsearch to become available.")
    for {
      _ <- pollUntilServerStartedUp(LocalDateTime.now.plus(Duration.ofMillis(conf.startupTimeout.toMillis))) ~> 500
      _ <- bootstrapIndexOnServer
    } yield ()
  }

  private def pollUntilServerStartedUp(until: LocalDateTime): Fox[Unit] = {
    def waitAndRecurse(until: LocalDateTime): Fox[Unit] =
      for {
        _ <- akka.pattern.after(POLLING_INTERVAL, using = system.scheduler)(Future.successful(()))
        _ <- bool2Fox(!LocalDateTime.now().isAfter(until)) ?~> s"Elasticsearch did not become ready within ${conf.startupTimeout}."
        _ <- pollUntilServerStartedUp(until)
      } yield ()

    for {
      isServerAvailableBox <- rpc(s"${conf.uri}/_cluster/health?wait_for_status=yellow&timeout=10s").request
        .withMethod("GET")
        .execute()
        .flatMap(result =>
          if (Status.isSuccessful(result.status)) {
            Fox.successful(true)
          } else {
            Fox.failure(s"Unexpected error code from Elasticsearch ${result.status}.")
        })
        .recoverWith({
          case e: java.net.ConnectException => {
            logger.debug(s"Elasticsearch connection exception: $e")
            Fox.successful(false)
          }
          case e =>
            logger.error(s"Unexpected error $e")
            Fox.failure("Unexpected error while trying to connect to Elasticsearch.", Full(e))
        })
      isServerAvailable <- isServerAvailableBox.toFox
      _ <- if (!isServerAvailable) {
        waitAndRecurse(until)
      } else {
        logger.info("Elasticsearch is available.")
        Fox.successful(())
      }
    } yield ()
  }

  private def bootstrapIndexOnServer: Fox[Unit] =
    for {
      indexExists <- rpc(s"${conf.uri}/${conf.index}").head.map(_ => true).getOrElse(false)
      _ <- if (!indexExists) {
        logger.info("Bootstrapping Elasticsearch index for Voxelytics.")
        rpc(s"${conf.uri}/${conf.index}").put(elasticsearchSchema)
      } else {
        Fox.successful(())
      }
    } yield ()

  def queryLogs(runName: String,
                organizationName: String,
                taskName: Option[String],
                minLevel: VoxelyticsLogLevel = VoxelyticsLogLevel.INFO): Fox[JsValue] = {

    val levels = VoxelyticsLogLevel.values - minLevel
    val queryStringParts = List(
      Some(s"""vx.run_name:"$runName""""),
      Some(s"""vx.wk_org:"$organizationName""""),
      Some(s"level:(${levels.map(_.toString).mkString(" OR ")})"),
      taskName.map(t => s"""vx.task_name:"$t"""")
    ).flatten

    val scrollBody = Json.obj(
      "size" -> JsNumber(SCROLL_SIZE),
      "query" -> Json.obj("query_string" -> Json.obj("query" -> queryStringParts.mkString(" AND "))),
      "sort" -> Json.arr(Json.obj("@timestamp" -> Json.obj("order" -> "asc")))
    )

    val buffer = ListBuffer[JsValue]()

    for {
      _ <- serverStartupFuture
      scroll <- rpc(s"${conf.uri}/${conf.index}/_search?scroll=1m")
        .postJsonWithJsonResponse[JsValue, JsValue](scrollBody) ~> "Could not fetch logs"
      scrollId = (scroll \ "_scroll_id").as[String]
      scrollHits = (scroll \ "hits" \ "hits").as[List[JsValue]]
      _ = buffer ++= scrollHits
      lastScrollId <- fetchBatch(buffer, scrollId)
      _ <- rpc(s"${conf.uri}/_search/scroll/$lastScrollId").delete()
    } yield JsArray(buffer)

  }

  private def fetchBatch(buffer: ListBuffer[JsValue], scrollId: String): Fox[String] =
    for {
      batch <- rpc(s"${conf.uri}/_search/scroll")
        .postJsonWithJsonResponse[JsValue, JsValue](Json.obj("scroll" -> "1m", "scroll_id" -> scrollId))
      batchScrollId = (batch \ "_scroll_id").as[String]
      batchHits = (batch \ "hits" \ "hits").as[List[JsValue]]
      _ = buffer ++= batchHits
      returnedScrollId <- if (batchHits.isEmpty) {
        Fox.successful(scrollId)
      } else {
        fetchBatch(buffer, batchScrollId)
      }
    } yield returnedScrollId

  def bulkInsert(logEntries: List[JsValue]): Fox[Unit] =
    if (conf.uri.nonEmpty && logEntries.nonEmpty) {
      val uri = s"${conf.uri}/_bulk"
      val bytes = logEntries
        .flatMap(entry =>
          List(Json.toBytes(Json.obj("create" -> Json.obj("_index" -> conf.index, "_id" -> UUID.randomUUID.toString))),
               Json.toBytes(entry)))
        .fold(Array.emptyByteArray)((rest, entry) => rest ++ entry ++ "\n".getBytes)

      for {
        _ <- serverStartupFuture
        res <- rpc(uri)
          .addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType)
          .postBytesWithJsonResponse[JsValue](bytes)
        _ <- Fox.bool2Fox((res \ "errors").asOpt[List[JsValue]].forall(_.isEmpty))
      } yield ()
    } else {
      Fox.successful(())
    }
}
