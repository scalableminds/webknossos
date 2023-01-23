package models.voxelytics

import akka.actor.ActorSystem
import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.voxelytics.VoxelyticsLogLevel.VoxelyticsLogLevel
import net.liftweb.common.Box.tryo
import net.liftweb.common.Full
import play.api.http.{HeaderNames, Status}
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

protected case class LokiLabel(
    workflow_hash: String,
    run_name: String,
    wk_url: String,
    wk_org: String
)

class LokiClient @Inject()(wkConf: WkConf, rpc: RPC, val system: ActorSystem)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MimeTypes {

  private lazy val conf = wkConf.Voxelytics.Loki
  private lazy val enabled = wkConf.Features.voxelyticsEnabled && conf.uri.nonEmpty

  private val POLLING_INTERVAL = 1 second

  private lazy val serverStartupFuture: Fox[Unit] = {
    for {
      _ <- bool2Fox(enabled) ?~> "Loki is not enabled."
      _ = logger.info("Waiting for Loki to become available.")
      _ <- pollUntilServerStartedUp(Instant.in(conf.startupTimeout)) ~> 500
    } yield ()
  }

  private def pollUntilServerStartedUp(until: Instant): Fox[Unit] = {
    def waitAndRecurse(until: Instant): Fox[Unit] =
      for {
        _ <- akka.pattern.after(POLLING_INTERVAL, using = system.scheduler)(Future.successful(()))
        _ <- bool2Fox(!until.isPast) ?~> s"Loki did not become ready within ${conf.startupTimeout}."
        _ <- pollUntilServerStartedUp(until)
      } yield ()

    for {
      isServerAvailableBox <- rpc(s"${conf.uri}/ready").request
        .withMethod("GET")
        .execute()
        .flatMap(result =>
          if (Status.isSuccessful(result.status)) {
            Fox.successful(true)
          } else if (result.status >= 500 && result.status < 600) {
            logger.debug(s"Loki status: ${result.status}")
            Fox.successful(false)
          } else {
            Fox.failure(s"Unexpected error code from Loki ${result.status}.")
        })
        .recoverWith({
          case e: java.net.ConnectException =>
            logger.debug(s"Loki connection exception: $e")
            Fox.successful(false)
          case e =>
            logger.error(s"Unexpected error $e")
            Fox.failure("Unexpected error while trying to connect to Loki.", Full(e))
        })
      isServerAvailable <- isServerAvailableBox.toFox
      _ <- if (!isServerAvailable) {
        waitAndRecurse(until)
      } else {
        logger.info("Loki is available.")
        Fox.successful(())
      }
    } yield ()
  }

  def queryLogs(runName: String,
                organizationId: ObjectId,
                taskName: Option[String],
                minLevel: VoxelyticsLogLevel = VoxelyticsLogLevel.INFO,
                startTime: Instant,
                endTime: Instant,
                limit: Long,
                backward: Boolean = true): Fox[JsValue] = {
    val levels = VoxelyticsLogLevel.sortedValues.drop(VoxelyticsLogLevel.sortedValues.indexOf(minLevel))

    val logQLFilter = List(
      taskName.map(t => s"""vx_task_name="$t""""),
      Some(s"""level=~"(${levels.mkString("|")})"""")
    ).flatten.mkString(" | ")
    val logQL =
      s"""{vx_run_name="$runName",wk_org="${organizationId.id}",wk_url="${wkConf.Http.uri}"} | json vx_task_name,level | $logQLFilter"""

    val queryString =
      List("query" -> logQL,
           "start" -> startTime.toString,
           "end" -> endTime.toString,
           "limit" -> limit.toString,
           "direction" -> (if (backward) {
                             "backward"
                           } else {
                             "forward"
                           }))
        .map(keyValueTuple => s"${keyValueTuple._1}=${java.net.URLEncoder.encode(keyValueTuple._2, "UTF-8")}")
        .mkString("&")
    for {
      _ <- serverStartupFuture
      _ = { println(s"ready, $queryString") }
      res <- rpc(s"${conf.uri}/loki/api/v1/query_range?$queryString").silent.getWithJsonResponse[JsValue]
      _ = { println(s"$res") }
      logEntries <- tryo(
        JsArray(
          (res \ "data" \ "result")
            .as[List[JsValue]]
            .flatMap(
              stream =>
                (stream \ "values")
                  .as[List[(String, String)]]
                  .map(value =>
                    Json.parse(value._2).as[JsObject] ++ (stream \ "stream").as[JsObject] ++ Json.obj(
                      "timestamp" -> Instant(value._1.substring(0, value._1.length - 6).toLong)))))).toFox
    } yield logEntries
  }

  def bulkInsert(logEntries: List[JsValue], organizationId: ObjectId)(implicit ec: ExecutionContext): Fox[Unit] =
    if (logEntries.nonEmpty) {
      for {
        _ <- serverStartupFuture
        logEntryGroups <- tryo(
          logEntries
            .groupBy(
              entry => ((entry \ "vx" \ "workflow_hash").as[String], (entry \ "vx" \ "run_name").as[String])
            )
            .toList).toFox
        streams <- Fox.serialCombined(logEntryGroups)(
          keyValueTuple =>
            for {
              values <- Fox.serialCombined(keyValueTuple._2)(entry => {
                for {
                  timestamp <- Instant.fromString((entry \ "@timestamp").as[String])
                  values <- tryo(
                    Json.stringify(
                      Json.obj(
                        "level" -> (entry \ "level").as[String],
                        "pid" -> (entry \ "pid").as[Long],
                        "logger_name" -> (entry \ "vx" \ "logger_name").as[String],
                        "vx_workflow_hash" -> (entry \ "vx" \ "workflow_hash").as[String],
                        "vx_run_name" -> (entry \ "vx" \ "run_name").as[String],
                        "vx_task_name" -> (entry \ "vx" \ "task_name").as[String],
                        "message" -> (entry \ "message").as[String],
                        "host" -> (entry \ "host").as[String],
                        "program" -> (entry \ "program").as[String],
                        "func_name" -> (entry \ "vx" \ "func_name").as[String],
                        "line" -> (entry \ "vx" \ "line").as[Long],
                        "path" -> (entry \ "vx" \ "path").as[String],
                        "process_name" -> (entry \ "vx" \ "process_name").as[String],
                        "thread_name" -> (entry \ "vx" \ "thread_name").as[String],
                        "vx_version" -> (entry \ "vx" \ "version").as[String],
                        "user" -> (entry \ "vx" \ "user").as[String],
                        "pgid" -> (entry \ "vx" \ "process_group_id").as[Long]
                      ))
                  ).toFox
                } yield
                  Json.arr(
                    timestamp.toNanosecondsString,
                    values
                  )
              })
            } yield
              Json.obj(
                "stream" -> Json.obj("vx_workflow_hash" -> keyValueTuple._1._1,
                                     "vx_run_name" -> keyValueTuple._1._2,
                                     "wk_url" -> wkConf.Http.uri,
                                     "wk_org" -> organizationId.id),
                "values" -> JsArray(values)
            ))
        res <- rpc(s"${conf.uri}/loki/api/v1/push").silent
          .addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType)
          .post[JsValue](Json.obj("streams" -> streams))
      } yield ()
    } else {
      Fox.successful(())
    }
}
