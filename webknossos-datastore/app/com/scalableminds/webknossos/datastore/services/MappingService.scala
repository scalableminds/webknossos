package com.scalableminds.webknossos.datastore.services

import java.nio.file.Path

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceMappingRequest, MappingReadInstruction}
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect._
import scala.reflect.ClassTag

class MappingService(dataBaseDir: Path, maxCacheSize: Int) extends FoxImplicits with LazyLogging {

  def handleMappingRequest(request: DataServiceMappingRequest): Fox[Array[Byte]] = {
    val readInstruction = MappingReadInstruction(dataBaseDir, request.dataSource, request.mapping)
    request.dataLayer.mappingProvider.load(readInstruction)
  }

  def applyMapping[T:ClassTag](request: DataServiceMappingRequest, data: Array[T], fromLongFn: Long => T): Fox[Array[T]] = {
    for {
      rawMapping <- handleMappingRequest(request)
      mapping <- MappingParser.parse[T](rawMapping, fromLongFn)
    } yield {
      data.map(mapping.mapping.withDefault(identity).apply)
    }
  }
}
