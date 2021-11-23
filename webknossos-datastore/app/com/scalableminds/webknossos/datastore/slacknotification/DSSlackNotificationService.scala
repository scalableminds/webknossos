package com.scalableminds.webknossos.datastore.slacknotification

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

class DSSlackNotificationService @Inject()(rpc: RPC, config: DataStoreConfig) extends LazyLogging {
  private lazy val slackClient = new SlackClient(rpc,
                                                 config.SlackNotifications.uri,
                                                 name = s"webKnossos-datastore at ${config.Http.uri}",
                                                 config.SlackNotifications.verboseLoggingEnabled)

  def noticeSlowRequest(msg: String): Unit =
    slackClient.info(
      title = s"Slow request",
      msg = msg
    )

}
