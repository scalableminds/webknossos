package com.scalableminds.webknossos.tracingstore.slacknotification

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import play.api.libs.json.Json

class SlackNotificationService @Inject()(rpc: RPC, config: TracingStoreConfig) extends LazyLogging {

  lazy val url: String = config.SlackNotifications.url

  def reportUnusalRequest(msg: String): Unit =
    if (url.nonEmpty) {
      rpc(url).postJson(
        Json.obj(
          "attachments" -> Json.arr(
            Json.obj(
              "title" -> s"Unusual request report from webknossos-tracingstore at ${config.Http.uri}",
              "text" -> msg,
              "color" -> "#333ccc"
            )
          )
        )
      )
    }
}
