package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.io.{FileIO, PathUtils}
import com.scalableminds.util.tools.Box
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayerMapping, DataLayerMapping}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceMappingRequest
import com.scalableminds.webknossos.datastore.services.BaseDirService
import com.scalableminds.webknossos.datastore.storage.ParsedMappingCache
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils

import java.nio.file.Path
import javax.inject.Inject
import scala.reflect.ClassTag

class MappingService @Inject()(config: DataStoreConfig, baseDirService: BaseDirService)
    extends LazyLogging {

  private lazy val mappingsDir = "mappings"
  private lazy val mappingFileExtension = "json"

  private lazy val cache = new ParsedMappingCache(config.Datastore.Cache.Mapping.maxEntries)

  def loadMappingBytes(request: DataServiceMappingRequest): Box[Array[Byte]] = for {
    dataSourceId <- Box(request.dataSourceId)
    orgaDir <- baseDirService.oneLocalForOrga(dataSourceId.organizationId)
    mappingFilePath = orgaDir
      .resolve(dataSourceId.directoryName)
      .resolve(request.dataLayer.name)
      .resolve(mappingsDir)
      .resolve(s"${request.mapping}.$mappingFileExtension")
    result <- FileIO.readFileToByteArray(mappingFilePath.toFile)
  } yield result

  def applyMapping[T: ClassTag](request: DataServiceMappingRequest,
                                data: Array[T],
                                fromLongFn: Long => T): Box[Array[T]] = {

    def loadAndParseMapping(mappingRequest: DataServiceMappingRequest): Box[AbstractDataLayerMapping] =
      for {
        rawMapping <- loadMappingBytes(request)
        mapping <- MappingParser.parse[T](rawMapping, fromLongFn)
      } yield mapping

    cache.withCache(request)(loadAndParseMapping) { mapping =>
      data.map(mapping.asInstanceOf[DataLayerMapping[T]].mapping.withDefault(identity).apply)
    }
  }

  def exploreMappings(layerDir: Path): Set[String] = {
    PathUtils.listFiles(layerDir.resolve(mappingsDir),
        silent = true,
        PathUtils.fileExtensionFilter(mappingFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .getOrElse(Seq.empty)
      .toSet
  }
}
