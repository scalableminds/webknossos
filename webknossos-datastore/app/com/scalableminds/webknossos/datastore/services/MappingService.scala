package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayerMapping, DataLayerMapping}
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceMappingRequest, MappingReadInstruction}
import com.scalableminds.webknossos.datastore.storage.ParsedMappingCache
import com.typesafe.scalalogging.LazyLogging

import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag

class MappingService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  lazy val cache = new ParsedMappingCache(config.Datastore.Cache.Mapping.maxEntries)

  def handleMappingRequest(request: DataServiceMappingRequest): Fox[Array[Byte]] = {
    val readInstruction =
      MappingReadInstruction(Paths.get(config.Datastore.baseDirectory),
                             request.dataSourceIdOrVolumeDummy,
                             request.mapping)
    request.dataLayer.mappingProvider.load(readInstruction).toFox
  }

  def applyMapping[T: ClassTag](request: DataServiceMappingRequest,
                                data: Array[T],
                                fromLongFn: Long => T): Fox[Array[T]] = {

    def loadAndParseMapping(mappingRequest: DataServiceMappingRequest): Fox[AbstractDataLayerMapping] =
      for {
        rawMapping <- handleMappingRequest(request)
        mapping <- MappingParser.parse[T](rawMapping, fromLongFn).toFox
      } yield mapping

    cache.withCache(request)(loadAndParseMapping) { mapping =>
      data.map(mapping.asInstanceOf[DataLayerMapping[T]].mapping.withDefault(identity).apply)
    }
  }
}
