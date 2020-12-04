package oxalis.telemetry.SlackNotificationService

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json
import utils.WkConf

import javax.inject.Inject

class SlackNotificationService @Inject()(rpc: RPC, conf: WkConf) extends LazyLogging {

  lazy val url: String = conf.SlackNotifications.url

  def noticeError(ex: Throwable, message: String): Unit =
    noticeError(ex.toString + ": " + ex.getLocalizedMessage + "\n" + message)

  def noticeError(msg: String): Unit =
    if (url != "empty") {
      logger.info(s"Sending Slack notification: $msg")
      rpc(url).postJson(
        Json.obj(
          "attachments" -> Json.arr(
            Json.obj(
              "title" -> s"Notification from webKnossos at ${conf.Http.uri}",
              "text" -> msg,
              "color" -> "#ff8a00"
            ))))
    }

  def noticeBaseAnnotationTaskCreation(taskType: List[String], numberOfTasks: Int): Unit =
    if (url != "empty") {
      rpc(url).postJson(
        Json.obj(
          "attachments" -> Json.arr(
            Json.obj(
              "title" -> s"Notification from webKnossos at ${conf.Http.uri}",
              "text" -> s"$numberOfTasks tasks with BaseAnnotation for TaskTypes ${taskType.mkString(", ")} have been created",
              "color" -> "#01781f"
            )
          )
        )
      )
    }
}
