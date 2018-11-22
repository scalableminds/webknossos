package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.AbstractDataLayerMapping
import com.scalableminds.webknossos.datastore.models.requests.DataServiceMappingRequest

class ParsedMappingCache(val maxEntries: Int) extends LRUConcurrentCache[DataServiceMappingRequest, Fox[AbstractDataLayerMapping]] {

}
