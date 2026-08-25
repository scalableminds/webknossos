package com.scalableminds.webknossos.tracingstore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

class TracingStoreConfig @Inject() (configuration: Configuration) extends ConfigReader {
  override val raw: Configuration = configuration

  object Http {
    val uri: String = get[String]("http.uri")
  }

  object Tracingstore {
    val key: String = get[String]("tracingstore.key")
    val name: String = get[String]("tracingstore.name")
    // SPIKE: guards the volume-versioning benchmark endpoint. Off by default,
    // because a run writes gigabytes into FossilDB.
    //
    // getOptional, not get: standalone-tracingstore.conf and any deployed
    // config define their own `tracingstore` block without inheriting
    // application.conf, so a required key here would throw while this object is
    // initialised and stop the tracingstore from booting at all.
    val enableBenchmarkEndpoint: Boolean =
      getOptional[Boolean]("tracingstore.enableBenchmarkEndpoint").getOrElse(false)
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
    object Cache {
      val chunkCacheMaxSizeBytes: Long = get[Long]("tracingstore.cache.chunkCacheMaxSizeBytes")
    }
    val children: List[Object] = List(WebKnossos, Fossildb, Redis, Cache)
  }

  object SlackNotifications {
    val uri: String = get[String]("slackNotifications.uri")
    val verboseLoggingEnabled: Boolean = get[Boolean]("slackNotifications.verboseLoggingEnabled")
  }

  val children: List[Object] = List(Http, Tracingstore, SlackNotifications)
}
