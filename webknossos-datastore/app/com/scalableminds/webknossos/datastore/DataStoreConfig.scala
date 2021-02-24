package com.scalableminds.webknossos.datastore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import scala.concurrent.duration._

class DataStoreConfig @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw: Configuration = configuration

  object Http {
    val uri: String = get[String]("http.uri")
  }

  object Braingames {
    object Binary {
      object ChangeHandler {
        val enabled: Boolean = get[Boolean]("braingames.binary.changeHandler.enabled")
        val tickerInterval: FiniteDuration = get[Int]("braingames.binary.changeHandler.tickerInterval") minutes
      }
      val baseFolder: String = get[String]("braingames.binary.baseFolder")
      val cacheMaxSize: Int = get[Int]("braingames.binary.cacheMaxSize")
      val mappingCacheMaxSize: Int = get[Int]("braingames.binary.mappingCacheMaxSize")
      val agglomerateCacheMaxSize: Int = get[Int]("braingames.binary.agglomerateCacheMaxSize")
      val agglomerateStandardBlockSize: Int = get[Int]("braingames.binary.agglomerateStandardBlockSize")
      val agglomerateFileCacheMaxSize: Int = get[Int]("braingames.binary.agglomerateFileCacheMaxSize")
      val agglomerateMaxReaderRange: Int = get[Int]("braingames.binary.agglomerateMaxReaderRange")
      val isosurfaceTimeout: FiniteDuration = get[Int]("braingames.binary.isosurfaceTimeout") seconds
      val isosurfaceActorPoolSize: Int = get[Int](path = "braingames.binary.isosurfaceActorPoolSize")
      val agglomerateSkeletonEdgeLimit: Int = get[Int]("braingames.binary.agglomerateSkeletonEdgeLimit")

      val children = List(ChangeHandler)
    }
    val children = List(Binary)
  }

  object Datastore {
    val key: String = get[String]("datastore.key")
    val name: String = get[String]("datastore.name")
    object WebKnossos {
      val uri: String = get[String]("datastore.webKnossos.uri")
      val pingIntervalMinutes: FiniteDuration = get[Int]("datastore.webKnossos.pingIntervalMinutes") minutes
    }
    val children = List(WebKnossos)
  }

  val children = List(Http, Braingames, Datastore)
}
