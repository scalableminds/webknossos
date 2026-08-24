package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.io.{FileIO, PathUtils}
import com.scalableminds.util.box.Box
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractDataLayerMapping,
  DataLayerMapping,
  DataSourceId
}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceMappingRequest
import com.scalableminds.webknossos.datastore.services.BaseDirService
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils

import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag

case class JsonMappingCacheKey(
    dataSourceId: Option[DataSourceId],
    dataLayerName: String,
    mappingName: String
)

class MappingService @Inject() (config: DataStoreConfig, baseDirService: BaseDirService)(implicit ec: ExecutionContext)
    extends LazyLogging {

  private lazy val mappingsDir = "mappings"
  private lazy val mappingFileExtension = "json"

  private lazy val cache: AlfuCache[JsonMappingCacheKey, AbstractDataLayerMapping] =
    AlfuCache(maxCapacity = config.Datastore.Cache.Mapping.maxEntries)

  def loadMappingBytes(request: DataServiceMappingRequest): Box[Array[Byte]] =
    for {
      dataSourceId <- Box.fromOption(request.dataSourceId)
      orgaDir <- baseDirService.getOneLocalForOrga(dataSourceId.organizationId)
      mappingFilePath = orgaDir
        .resolve(dataSourceId.directoryName)
        .resolve(request.dataLayer.name)
        .resolve(mappingsDir)
        .resolve(s"${request.mapping}.$mappingFileExtension")
      result <- FileIO.readFileToByteArray(mappingFilePath.toFile)
    } yield result

  def applyMapping[T: ClassTag](
      request: DataServiceMappingRequest,
      data: Array[T],
      fromLongFn: Long => T
  ): Fox[Array[T]] = {

    def loadAndParseMapping(mappingRequest: DataServiceMappingRequest): Box[AbstractDataLayerMapping] =
      for {
        rawMapping <- loadMappingBytes(mappingRequest)
        mapping <- MappingParser.parse[T](rawMapping, fromLongFn)
      } yield mapping

    for {
      mappingCacheKey = JsonMappingCacheKey(
        request.dataSourceId,
        request.dataLayer.name,
        request.mapping
      )
      parsedMapping <- cache.getOrLoad(mappingCacheKey, _ => loadAndParseMapping(request).toFox)
      typedMapping = parsedMapping.asInstanceOf[DataLayerMapping[T]].mapping.withDefault(identity)
      mappedData = data.map(typedMapping.apply)
    } yield mappedData
  }

  def exploreMappings(layerDir: Path): Set[String] =
    PathUtils
      .listFiles(layerDir.resolve(mappingsDir), silent = true, PathUtils.fileExtensionFilter(mappingFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .getOrElse(Seq.empty)
      .toSet
}
