package com.scalableminds.webknossos.tracingstore.slacknotification

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json

import scala.concurrent.duration.DurationInt

class SlackClient(rpc: RPC, slackUri: String, name: String, verboseLoggingEnabled: Boolean) extends LazyLogging {

  private lazy val RateLimitInterval = 1 minute
  private lazy val RateLimitMaxMessages = 30

  private var messagesSentSinceReset = 0
  private var lastResetTimestamp: Long = 0L

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
    if (slackUri.isEmpty) {
      if (verboseLoggingEnabled) {
        logger.info(s"Not sending slack notification as it was not configured. Message was: $jsonMessage")
      }
    } else {
      if (testAndSetRateLimit) {
        if (verboseLoggingEnabled) {
          logger.info(
            s"Sending slack notification: $jsonMessage. Sent $messagesSentSinceReset messages since rate reset.")
        }
        rpc(slackUri).postJson(
          Json.obj("attachments" -> Json.arr(jsonMessage))
        )
      } else {
        logger.warn(
          s"Not sending slack notification as rate limit of $messagesSentSinceReset was reached. Message was: $jsonMessage")
      }
    }
  }

  private def testAndSetRateLimit: Boolean =
    this.synchronized {
      val currentTimestamp = System.currentTimeMillis()
      if (currentTimestamp - lastResetTimestamp > RateLimitInterval.toMillis) {
        lastResetTimestamp = currentTimestamp
        messagesSentSinceReset = 1
        true
      } else {
        if (messagesSentSinceReset < RateLimitMaxMessages) {
          messagesSentSinceReset += 1
          true
        } else false
      }
    }
}
