package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

class TracingStoreConfig @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw: Configuration = configuration

  object Http {
    val uri: String = get[String]("http.uri")
  }

  object Tracingstore {
    val key: String = get[String]("tracingstore.key")
    val name: String = get[String]("tracingstore.name")
    object WebKnossos {
      val uri: String = get[String]("tracingstore.webKnossos.uri")
    }
    object Fossildb {
      val address: String = get[String]("tracingstore.fossildb.address")
      val port: Int = get[Int]("tracingstore.fossildb.port")
    }
    object Redis {
      val address: String = get[String]("tracingstore.redis.address")
      val port: Int = get[Int]("tracingstore.redis.port")
    }
    val children = List(WebKnossos, Fossildb)
  }

  object SlackNotifications {
    val url: String = get[String]("slackNotifications.url")
  }
  val children = List(Http, Tracingstore)
}
