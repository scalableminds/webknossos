package com.scalableminds.webknossos.datastore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import scala.concurrent.duration._

class DataStoreConfig @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw = configuration

  object Http {
    val uri = get[String]("http.uri")
  }

  object Braingames {
    object Binary {
      object ChangeHandler {
        val enabled = get[Boolean]("braingames.binary.changeHandler.enabled")
        val tickerInterval = get[Int]("braingames.binary.changeHandler.tickerInterval") minutes
      }
      val baseFolder = get[String]("braingames.binary.baseFolder")
      val loadTimeout = get[Int]("braingames.binary.loadTimeout") seconds
      val cacheMaxSize = get[Int]("braingames.binary.cacheMaxSize")
      val mappingCacheMaxSize = get[Int]("braingames.binary.mappingCacheMaxSize")
      val agglomerateCacheMaxSize = get[Int]("braingames.binary.agglomerateCacheMaxSize")
      val agglomerateStandardBlockSize = get[Int]("braingames.binary.agglomerateStandardBlockSize")
      val agglomerateFileCacheMaxSize = get[Int]("braingames.binary.agglomerateFileCacheMaxSize")
      val agglomerateMaxReaderRange = get[Int]("braingames.binary.agglomerateMaxReaderRange")
      val isosurfaceTimeout = get[Int]("braingames.binary.isosurfaceTimeout") seconds
      val isosurfaceActorPoolSize = get[Int](path = "braingames.binary.isosurfaceActorPoolSize")

      val children = List(ChangeHandler)
    }
    val children = List(Binary)
  }

  object Datastore {
    val key = get[String]("datastore.key")
    val name = get[String]("datastore.name")
    object WebKnossos {
      val uri = get[String]("datastore.webKnossos.uri")
      val pingIntervalMinutes = get[Int]("datastore.webKnossos.pingIntervalMinutes") minutes
    }
    val children = List(WebKnossos)
  }

  val children = List(Http, Braingames, Datastore)
}
