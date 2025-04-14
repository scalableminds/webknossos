package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.AbstractDataLayerMapping
import com.scalableminds.webknossos.datastore.models.requests.DataServiceMappingRequest
import com.scalableminds.webknossos.datastore.storage
import net.liftweb.common.Failure

case class CachedMapping(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    mappingName: String
)

object CachedMapping {

  def fromMappingRequest(mappingRequest: DataServiceMappingRequest): CachedMapping =
    storage.CachedMapping(mappingRequest.dataSource.id.organizationId,
                          mappingRequest.dataSource.id.directoryName,
                          mappingRequest.dataLayer.name,
                          mappingRequest.mapping)
}

class ParsedMappingCache(val maxEntries: Int)
    extends LRUConcurrentCache[CachedMapping, Fox[AbstractDataLayerMapping]]
    with FoxImplicits {

  def withCache[T](mappingRequest: DataServiceMappingRequest)(
      loadFn: DataServiceMappingRequest => Fox[AbstractDataLayerMapping])(f: AbstractDataLayerMapping => T): Fox[T] = {

    val cachedMappingInfo = CachedMapping.fromMappingRequest(mappingRequest)

    def handleUncachedMapping() = {
      val mappingFox = loadFn(mappingRequest)
      mappingFox.onComplete {
        case _: Failure => remove(cachedMappingInfo)
      }

      put(cachedMappingInfo, mappingFox)

      mappingFox.map { mapping =>
        f(mapping)
      }
    }

    get(cachedMappingInfo) match {
      case Some(mappingFox) =>
        mappingFox.map { mapping =>
          f(mapping)
        }
      case _ => handleUncachedMapping()
    }
  }
}
