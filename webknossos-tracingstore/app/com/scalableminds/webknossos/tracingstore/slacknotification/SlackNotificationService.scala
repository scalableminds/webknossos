package com.scalableminds.webknossos.tracingstore.slacknotification

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

class SlackNotificationService @Inject()(rpc: RPC, config: TracingStoreConfig) extends LazyLogging {
  private lazy val slackClient = new SlackClient(rpc,
                                                 config.SlackNotifications.uri,
                                                 name = s"webKnossos-tracingstore at ${config.Http.uri}",
                                                 config.SlackNotifications.verboseLoggingEnabled)

  def noticeSlowRequest(msg: String): Unit =
    slackClient.info(
      title = s"Slow request",
      msg = msg
    )

  def reportFossilWriteError(requestType: String, error: Exception): Unit = {
    if (error.getMessage.contains("UNAVAILABLE")) return // Filter out expected errors during fossildb restart
    slackClient.warn(
      title = s"Error during fossildb write",
      msg = s"$requestType request to FossilDB failed: ${error.getMessage}"
    )
  }

}
