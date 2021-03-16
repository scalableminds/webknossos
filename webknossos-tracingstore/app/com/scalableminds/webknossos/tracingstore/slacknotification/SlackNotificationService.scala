package com.scalableminds.webknossos.tracingstore.slacknotification

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import play.api.libs.json.Json

import scala.concurrent.duration.DurationInt

class SlackNotificationService @Inject()(rpc: RPC, config: TracingStoreConfig) extends LazyLogging {
  private lazy val slackClient = new SlackClient(rpc, config.SlackNotifications.url, name = s"webknossos-tracingstore at ${config.Http.uri}")

  def noticeSlowRequest(msg: String): Unit =
    slackClient.info(
      title = s"Slow request",
      msg = msg
    )

  def reportFossilWriteError(requestType: String, error: Exception): Unit = {
    if (error.getMessage.contains("unavailable")) return // Filter out expected errors during fossildb restart
    slackClient.warn(
      title = s"Error during fossildb write",
      msg = s"$requestType request to FossilDB failed: ${error.getMessage}"
    )
  }

}

class SlackClient(rpc: RPC, slackUri: String, name: String) extends LazyLogging {

  private lazy val RateLimitInterval = 1 minute
  private lazy val RateLimitMaxMessages = 30

  private var messagesSentSinceReset = 0
  private var lastResetTimestamp = 0

  def warn(title: String, msg: String): Unit =
    sendMessage(title, msg, "#ff8a00")

  def info(title: String, msg: String): Unit =
    sendMessage(title, msg, "#333ccc")

  def error(title: String, msg: String): Unit =
    sendMessage(title, msg, "#e10000")

  private def sendMessage(title: String, msg: String, color: String): Unit = {
    val jsonMessage = Json.obj(
      "title" -> s"$title reported from $name",
      "text" -> msg,
      "color" -> color
    )
    if (slackUri == "empty" || slackUri.isEmpty) {
      logger.info(s"Not sending slack notification as it was not configured. Message was: ${jsonMessage}")
    } else {
      rpc(slackUri).postJson(
        Json.obj("attachments" -> Json.arr(jsonMessage))
      )
    }
  }
}
