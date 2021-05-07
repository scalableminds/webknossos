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

  object Datastore {
    val key: String = get[String]("datastore.key")
    val name: String = get[String]("datastore.name")
    object WebKnossos {
      val uri: String = get[String]("datastore.webKnossos.uri")
      val pingInterval: FiniteDuration = get[FiniteDuration]("datastore.webKnossos.pingInterval")
    }
    val baseFolder: String = get[String]("datastore.baseFolder")
    object WatchFileSystem {
      val enabled: Boolean = get[Boolean]("datastore.watchFileSystem.enabled")
      val interval: FiniteDuration = get[FiniteDuration]("datastore.watchFileSystem.interval")
    }
    object Cache {
      object DataCube {
        val maxEntries: Int = get[Int]("datastore.cache.dataCube.maxEntries")
      }
      object Mapping {
        val maxEntries: Int = get[Int]("datastore.cache.mapping.maxEntries")
      }
      object AgglomerateFile {
        val maxFileHandleEntries: Int = get[Int]("datastore.cache.agglomerateFile.maxFileHandleEntries")
        val maxSegmentIdEntries: Int = get[Int]("datastore.cache.agglomerateFile.maxSegmentIdEntries")
        val blockSize: Int = get[Int]("datastore.cache.agglomerateFile.blockSize")
        val cumsumMaxReaderRange: Long = get[Long]("datastore.cache.agglomerateFile.cumsumMaxReaderRange")
      }
      val children = List(DataCube, Mapping, AgglomerateFile)
    }
    object Isosurface {
      val timeout: FiniteDuration = get[FiniteDuration]("datastore.isosurface.timeout")
      val actorPoolSize: Int = get[Int]("datastore.isosurface.actorPoolSize")
    }
    object AgglomerateSkeleton {
      val maxEdges: Int = get[Int]("datastore.agglomerateSkeleton.maxEdges")
    }
    val children = List(WebKnossos, WatchFileSystem, Cache, Isosurface)
  }

  val children = List(Http, Datastore)
}
