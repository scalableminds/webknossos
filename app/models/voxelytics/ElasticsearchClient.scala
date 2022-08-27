package models.voxelytics

import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.voxelytics.VoxelyticsLogLevel.VoxelyticsLogLevel
import play.api.http.HeaderNames
import play.api.libs.json.{JsArray, JsNumber, JsValue, Json}
import utils.WkConf

import java.util.UUID
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

class ElasticsearchClient @Inject()(wkConf: WkConf, rpc: RPC)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MimeTypes {

  private lazy val conf = wkConf.Voxelytics.Elasticsearch
  val SCROLL_SIZE = 10000

  private def pollUntilServerIsAvailable: Fox[Unit] =
    // TODO: Implement polling with conf.startupTimeout
    Fox.successful()

  def queryLogs(runName: String,
                organizationName: String,
                taskName: Option[String],
                minLevel: VoxelyticsLogLevel = VoxelyticsLogLevel.INFO): Fox[JsValue] = {

    val levels = VoxelyticsLogLevel.values - minLevel
    val queryStringParts = List(
      Some(s"""vx.run_name:"$runName""""),
      Some(s"""vx.wk_org:"$organizationName""""),
      Some(s"level:(${levels.map(_.toString).mkString(" OR ")}))"),
      taskName.map(t => s"""vx.task_name:"$t"""")
    ).flatten

    val scrollBody = Json.obj(
      "size" -> JsNumber(SCROLL_SIZE),
      "query" -> Json.obj("query_string" -> Json.obj("query" -> queryStringParts.mkString(" AND "))),
      "sort" -> Json.arr(Json.obj("@timestamp" -> Json.obj("order" -> "asc")))
    )

    val buffer = ListBuffer[JsValue]()

    for {
      _ <- pollUntilServerIsAvailable
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
        _ <- pollUntilServerIsAvailable
        res <- rpc(uri)
          .addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType)
          .postBytesWithJsonResponse[JsValue](bytes)
        _ <- Fox.bool2Fox((res \ "errors").asOpt[List[JsValue]].forall(_.isEmpty))
      } yield ()
    } else {
      Fox.successful(())
    }
}
