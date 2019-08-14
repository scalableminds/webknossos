package oxalis.telemetry.SlackNotificationService

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import play.api.libs.json.{JsObject, Json}
import utils.WkConf

class SlackNotificationService @Inject()(rpc: RPC,
                      conf: WkConf
                     ) extends LazyLogging {

  lazy val url = conf.SlackNotifications.url

  def noticeError(ex: Throwable, message: String): Unit = {
    sendNotification(ex.toString + ": " + ex.getLocalizedMessage + "\n" + message)
  }

  def sendNotification(msg: String): Unit = {
    if (url != "empty") {
      logger.info(s"Sending Slack notification: $msg")
      rpc(url).postJson(Json.obj(
        "attachments" -> Json.arr(Json.obj(
          "title" -> s"Notification from webKnossos at ${conf.Http.uri}",
          "text" -> msg,
          "color" -> "#66d3e4"
        ))))
    }
  }
}
