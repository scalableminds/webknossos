package com.scalableminds.webknossos.datastore.services

import java.nio.file.Path

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceMappingRequest, MappingReadInstruction}
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext.Implicits.global

class MappingService(dataBaseDir: Path, maxCacheSize: Int) extends FoxImplicits with LazyLogging {

  def handleMappingRequest(request: DataServiceMappingRequest): Fox[Array[Byte]] = {
    val readInstruction = MappingReadInstruction(dataBaseDir, request.dataSource, request.mapping)
    request.dataLayer.mappingProvider.load(readInstruction)
  }

  def applyMapping(request: DataServiceMappingRequest, data: Array[Byte]): Fox[Array[Byte]] = {
    for {
      rawMapping <- handleMappingRequest(request)
      mapping <- MappingParser.parse(rawMapping)
    } yield {
      //request.dataLayer.elementClass match {
      //}
      // data.map(mapping.mapping.apply)
      data
    }
  }
}
