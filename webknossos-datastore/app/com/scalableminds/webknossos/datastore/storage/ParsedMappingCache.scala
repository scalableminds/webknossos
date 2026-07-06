package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Box, Failure}
import com.scalableminds.webknossos.datastore.models.datasource.AbstractDataLayerMapping
import com.scalableminds.webknossos.datastore.models.requests.DataServiceMappingRequest

case class MappingCacheKey(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    mappingName: String
)

class ParsedMappingCache(val maxEntries: Int)
    extends LRUConcurrentCache[MappingCacheKey, Box[AbstractDataLayerMapping]] {

  def withCache[T](
      mappingRequest: DataServiceMappingRequest
  )(loadFn: DataServiceMappingRequest => Box[AbstractDataLayerMapping])(f: AbstractDataLayerMapping => T): Box[T] = {

    val mappingCacheKey = MappingCacheKey(
      mappingRequest.dataSourceIdOrVolumeDummy.organizationId,
      mappingRequest.dataSourceIdOrVolumeDummy.directoryName,
      mappingRequest.dataLayer.name,
      mappingRequest.mapping
    )

    def handleUncachedMapping() = {
      val mappingBox = loadFn(mappingRequest)
      mappingBox match {
        case _: Failure => remove(mappingCacheKey)
        case _          => ()
      }

      put(mappingCacheKey, mappingBox)

      mappingBox.map { mapping =>
        f(mapping)
      }
    }

    get(mappingCacheKey) match {
      case Some(mappingFox) =>
        mappingFox.map { mapping =>
          f(mapping)
        }
      case _ => handleUncachedMapping()
    }
  }
}
