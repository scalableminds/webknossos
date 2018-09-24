package com.scalableminds.webknossos.datastore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import scala.concurrent.ExecutionContext.Implicits.global
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

      val children = List(ChangeHandler)
    }
    val children = List(Binary)
  }

  object Datastore {
    val key = get[String]("datastore.key")
    val name = get[String]("datastore.name")
    object Oxalis {
      val uri = get[String]("datastore.oxalis.uri")
      val secured = get[Boolean]("datastore.oxalis.secured")
      val pingIntervalMinutes = get[Int]("datastore.oxalis.pingIntervalMinutes") minutes
    }
    object Fossildb {
      val address = get[String]("datastore.fossildb.address")
      val port = get[Int]("datastore.fossildb.port")
    }
    val children = List(Oxalis, Fossildb)
  }

  val children = List(Http, Braingames, Datastore)
}
