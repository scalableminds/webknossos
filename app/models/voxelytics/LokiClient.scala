package models.voxelytics

import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.voxelytics.VoxelyticsLogLevel.VoxelyticsLogLevel
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.Full
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.after
import play.api.http.{HeaderNames, Status}
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.math.Ordering.Implicits.infixOrderingOps

class LokiClient @Inject() (wkConf: WkConf, rpc: RPC, val system: ActorSystem)(implicit ec: ExecutionContext)
    extends LazyLogging
    with MimeTypes {

  private lazy val conf = wkConf.Voxelytics.Loki
  private lazy val enabled = wkConf.Features.voxelyticsEnabled && conf.uri.nonEmpty

  private val POLLING_INTERVAL = 1 second
  private val LOG_TIME_BATCH_INTERVAL = 1 days
  private val LOG_ENTRY_QUERY_BATCH_SIZE = 5000
  private val LOG_ENTRY_INSERT_BATCH_SIZE = 1000

  private lazy val serverStartupFuture: Fox[Unit] =
    for {
      _ <- bool2Fox(enabled) ?~> "Loki is not enabled."
      _ = logger.info("Waiting for Loki to become available.")
      _ <- pollUntilServerStartedUp(Instant.in(conf.startupTimeout)) ~> 500
    } yield ()

  private def pollUntilServerStartedUp(until: Instant): Fox[Unit] = {
    def waitAndRecurse(until: Instant): Fox[Unit] =
      for {
        _ <- after(POLLING_INTERVAL, using = system.scheduler)(Future.successful(()))
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
          }
        )
        .recoverWith {
          case e: java.net.ConnectException =>
            logger.debug(s"Loki connection exception: $e")
            Fox.successful(false)
          case e =>
            logger.error(s"Unexpected error $e")
            Fox.failure("Unexpected error while trying to connect to Loki.", Full(e))
        }
      isServerAvailable <- isServerAvailableBox.toFox
      _ <-
        if (!isServerAvailable) {
          waitAndRecurse(until)
        } else {
          logger.info("Loki is available.")
          Fox.successful(())
        }
    } yield ()
  }

  def queryLogsBatched(
      runName: String,
      organizationId: String,
      taskName: Option[String],
      minLevel: VoxelyticsLogLevel = VoxelyticsLogLevel.INFO,
      startTime: Instant,
      endTime: Instant,
      limit: Option[Int]
  ): Fox[List[JsValue]] = {
    val currentEndTime = endTime
    val currentStartTime = startTime.max(endTime - LOG_TIME_BATCH_INTERVAL)
    val currentLimit = limit.getOrElse(LOG_ENTRY_QUERY_BATCH_SIZE).min(LOG_ENTRY_QUERY_BATCH_SIZE)

    if (currentLimit > 0) {
      for {
        headBatch <- queryLogs(
          runName,
          organizationId,
          taskName,
          minLevel,
          currentStartTime,
          currentEndTime,
          currentLimit
        )
        newLimit = limit.map(l => (l - headBatch.length).max(0))
        buffer <-
          if (headBatch.isEmpty) {
            if (currentStartTime == startTime || newLimit.contains(0)) {
              Fox.successful(List())
            } else {
              for {
                tailBatch <- queryLogsBatched(
                  runName,
                  organizationId,
                  taskName,
                  minLevel,
                  startTime,
                  currentStartTime,
                  newLimit
                )
              } yield tailBatch ++ headBatch
            }
          } else {
            for {
              batchHead <- headBatch.headOption.toFox
              batchHeadTime <- tryo(Instant((batchHead \ "timestamp").as[Long])).toFox
              tailBatch <- queryLogsBatched(
                runName,
                organizationId,
                taskName,
                minLevel,
                startTime,
                batchHeadTime,
                newLimit
              )
            } yield tailBatch ++ headBatch
          }
      } yield buffer
    } else {
      Fox.successful(List())
    }
  }

  private def queryLogs(
      runName: String,
      organizationId: String,
      taskName: Option[String],
      minLevel: VoxelyticsLogLevel,
      startTime: Instant,
      endTime: Instant,
      limit: Int
  ): Fox[List[JsValue]] =
    if (limit > 0) {
      val levels = VoxelyticsLogLevel.sortedValues.drop(VoxelyticsLogLevel.sortedValues.indexOf(minLevel))

      val logQLFilter = List(
        taskName.map(t => s"""vx_task_name="$t""""),
        Some(s"""level=~"(${levels.mkString("|")})"""")
      ).flatten.mkString(" | ")
      val logQL =
        s"""{vx_run_name="$runName",wk_org=~"$organizationId",wk_url="${wkConf.Http.uri}"} | json vx_task_name,level | $logQLFilter"""

      val queryString =
        List(
          "query" -> logQL,
          "start" -> startTime.toString,
          "end" -> endTime.toString,
          "limit" -> limit.toString,
          "direction" -> "backward"
        ).map(keyValueTuple => s"${keyValueTuple._1}=${java.net.URLEncoder.encode(keyValueTuple._2, "UTF-8")}")
          .mkString("&")
      for {
        _ <- serverStartupFuture
        res <- rpc(s"${conf.uri}/loki/api/v1/query_range?$queryString").silent.getWithJsonResponse[JsValue]
        logEntries <- tryo(
          (res \ "data" \ "result")
            .as[List[JsValue]]
            .flatMap(stream =>
              (stream \ "values")
                .as[List[(String, String)]]
                .map(value =>
                  Json.parse(value._2).as[JsObject] ++ (stream \ "stream").as[JsObject] ++ Json
                    .obj("timestamp" -> Instant.fromNanosecondsString(value._1))
                )
            )
            .sortBy(entry => (entry \ "timestamp").as[Long])
        ).toFox
      } yield logEntries
    } else Fox.successful(List())

  def bulkInsertBatched(logEntries: List[JsValue], organizationId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(logEntries.grouped(LOG_ENTRY_INSERT_BATCH_SIZE).toList)(bulkInsert(_, organizationId))
    } yield ()

  private def bulkInsert(logEntries: List[JsValue], organizationId: String)(implicit ec: ExecutionContext): Fox[Unit] =
    if (logEntries.nonEmpty) {
      for {
        _ <- serverStartupFuture
        logEntryGroups <- tryo(
          logEntries
            .groupBy(entry =>
              (
                (entry \ "vx" \ "workflow_hash").as[String],
                (entry \ "vx" \ "run_name").as[String],
                (entry \ "pid").as[Long].toString
              )
            )
            .toList
        ).toFox
        streams <- Fox.serialCombined(logEntryGroups)(keyValueTuple =>
          for {
            values <- Fox.serialCombined(keyValueTuple._2) { entry =>
              for {
                timestampString <- tryo((entry \ "@timestamp").as[String]).toFox
                timestamp <-
                  if (timestampString.endsWith("Z"))
                    Instant.fromString(timestampString).toFox
                  else
                    Instant.fromLocalTimeString(timestampString)
                values <- tryo(
                  Json.stringify(
                    Json.obj(
                      "level" -> (entry \ "level").as[String],
                      "pid" -> (entry \ "pid").as[Long].toString,
                      "logger_name" -> (entry \ "vx" \ "logger_name").as[String],
                      "vx_workflow_hash" -> (entry \ "vx" \ "workflow_hash").as[String],
                      "vx_run_name" -> (entry \ "vx" \ "run_name").as[String],
                      "vx_task_name" -> (entry \ "vx" \ "task_name").as[String],
                      "message" -> (entry \ "message").as[String],
                      "host" -> (entry \ "host").as[String],
                      "program" -> (entry \ "program").as[String],
                      "func_name" -> (entry \ "vx" \ "func_name").as[String],
                      "line" -> (entry \ "vx" \ "line").as[Long].toString,
                      "path" -> (entry \ "vx" \ "path").as[String],
                      "process_name" -> (entry \ "vx" \ "process_name").as[String],
                      "thread_name" -> (entry \ "vx" \ "thread_name").as[String],
                      "vx_version" -> (entry \ "vx" \ "version").as[String],
                      "user" -> (entry \ "vx" \ "user").as[String],
                      "pgid" -> (entry \ "vx" \ "process_group_id").as[Long].toString
                    )
                  )
                ).toFox
              } yield Json.arr(
                timestamp.toNanosecondsString,
                values
              )
            }
          } yield Json.obj(
            "stream" -> Json.obj(
              "vx_workflow_hash" -> keyValueTuple._1._1,
              "vx_run_name" -> keyValueTuple._1._2,
              "pid" -> keyValueTuple._1._3,
              "wk_url" -> wkConf.Http.uri,
              "wk_org" -> organizationId
            ),
            "values" -> JsArray(values)
          )
        )
        _ <- rpc(s"${conf.uri}/loki/api/v1/push").silent
          .addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType)
          .postJson[JsValue](Json.obj("streams" -> streams))
      } yield ()
    } else {
      Fox.successful(())
    }
}
