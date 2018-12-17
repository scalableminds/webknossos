package com.scalableminds.webknossos.datastore.services

import java.nio.file.{Path, Paths}

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayerMapping, DataLayerMapping, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceMappingRequest, MappingReadInstruction}
import com.scalableminds.webknossos.datastore.storage.ParsedMappingCache
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect._
import scala.reflect.ClassTag

class MappingService @Inject()(config: DataStoreConfig) extends FoxImplicits with LazyLogging {

  lazy val cache = new ParsedMappingCache(config.Braingames.Binary.mappingCacheMaxSize)

  def handleMappingRequest(request: DataServiceMappingRequest): Fox[Array[Byte]] = {
    val readInstruction = MappingReadInstruction(Paths.get(config.Braingames.Binary.baseFolder), request.dataSource, request.mapping)
    request.dataLayer.mappingProvider.load(readInstruction)
  }

  def applyMapping[T:ClassTag](request: DataServiceMappingRequest, data: Array[T], fromLongFn: Long => T): Fox[Array[T]] = {

    def loadAndParseMapping(mappingRequest: DataServiceMappingRequest): Fox[AbstractDataLayerMapping] = {
      for {
        rawMapping <- handleMappingRequest(request)
        mapping <- MappingParser.parse[T](rawMapping, fromLongFn)
      } yield mapping
    }

    cache.withCache(request)(loadAndParseMapping){ mapping =>
      data.map(mapping.asInstanceOf[DataLayerMapping[T]].mapping.withDefault(identity).apply)
    }
  }
}
