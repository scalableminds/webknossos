package com.scalableminds.webknossos.datastore.storage

import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.Cube
import com.scalableminds.webknossos.datastore.models.datasource.AbstractDataLayerMapping
import com.scalableminds.webknossos.datastore.models.requests.{DataReadInstruction, DataServiceMappingRequest}
import com.scalableminds.webknossos.datastore.storage
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global

case class CachedMapping(
                          organization: String,
                          dataSourceName: String,
                          dataLayerName: String,
                          mappingName: String
                        )

object CachedMapping {

  def from(mappingRequest: DataServiceMappingRequest): CachedMapping =
    storage.CachedMapping(
      mappingRequest.dataSource.id.team,
      mappingRequest.dataSource.id.name,
      mappingRequest.dataLayer.name,
      mappingRequest.mapping)
}

class ParsedMappingCache(val maxEntries: Int) extends LRUConcurrentCache[CachedMapping, Fox[AbstractDataLayerMapping]] with FoxImplicits {

  def withCache[T](mappingRequest: DataServiceMappingRequest)(loadFn: DataServiceMappingRequest => Fox[AbstractDataLayerMapping])(f: AbstractDataLayerMapping => T): Fox[T] = {

    val cachedMappingInfo = CachedMapping.from(mappingRequest)

    def handleUncachedMapping() = {
      val mappingFox = loadFn(mappingRequest).futureBox.map {
        case Full(cube) =>
          Full(cube)
        case f: Failure =>
          remove(cachedMappingInfo)
          f
        case _ =>
          Empty
      }.toFox

      put(cachedMappingInfo, mappingFox)
      NewRelic.incrementCounter("Custom/FileDataStore/MappingCache/miss")
      NewRelic.recordMetric("Custom/FileDataStore/MappingCache/size", size())

      mappingFox.map { mapping =>
        f(mapping)
      }
    }

    get(cachedMappingInfo) match {
      case Some(mappingFox) =>
        mappingFox.map { mapping =>
          NewRelic.incrementCounter("Custom/FileDataStore/MappingCache/hit")
          f(mapping)
        }
      case _ => handleUncachedMapping()
    }
  }
}
