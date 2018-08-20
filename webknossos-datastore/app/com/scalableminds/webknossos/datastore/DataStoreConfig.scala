package com.scalableminds.webknossos.datastore

import com.google.inject.Inject
import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class DataStoreConfig @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw = configuration

  object Http {
    val uri = getString("http.uri")
  }

  object Braingames {
    object Binary {
      object ChangeHandler {
        val enabled = getBoolean("braingames.binary.changeHandler.enabled")
        val tickerInterval = getInt("braingames.binary.changeHandler.tickerInterval") minutes
      }
      val baseFolder = getString("braingames.binary.baseFolder")
      val loadTimeout = getInt("braingames.binary.loadTimeout") seconds
      val cacheMaxSize = getInt("braingames.binary.cacheMaxSize")
    }
  }

  object Datastore {
    val key = getString("datastore.key")
    val name = getString("datastore.name")
    object Oxalis {
      val uri = getString("datastore.oxalis.uri")
      val secured = getBoolean("datastore.oxalis.secured")
      val pingIntervalMinutes = getInt("datastore.oxalis.pingIntervalMinutes") minutes
    }
    object Fossildb {
      val address = getString("datastore.fossildb.address")
      val port = getInt("datastore.fossildb.port")
    }
  }

}
