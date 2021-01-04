package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import scala.concurrent.duration._

class TracingStoreConfig @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw = configuration

  object Http {
    val uri = get[String]("http.uri")
  }

  object Tracingstore {
    val key = get[String]("tracingstore.key")
    val name = get[String]("tracingstore.name")
    object WebKnossos {
      val uri = get[String]("tracingstore.webKnossos.uri")
    }
    object Fossildb {
      val address = get[String]("tracingstore.fossildb.address")
      val port = get[Int]("tracingstore.fossildb.port")
    }
    object Redis {
      val address = get[String]("tracingstore.redis.address")
      val port = get[Int]("tracingstore.redis.port")
    }
    val children = List(WebKnossos, Fossildb)
  }

  object SlackNotifications {
    val url = get[String]("slackNotifications.url")
  }
  val children = List(Http, Tracingstore)
}
