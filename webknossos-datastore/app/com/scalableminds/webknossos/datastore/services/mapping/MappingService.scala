package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.io.{FileIO, PathUtils}
import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceMappingRequest
import com.scalableminds.webknossos.datastore.services.BaseDirService
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils

import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class JsonMappingCacheKey(
    dataSourceId: Option[DataSourceId],
    dataLayerName: String,
    mappingName: String,
    // The cached mapping is normalized to the element width, so it must not be reused after the element class changed.
    elementClass: ElementClass.Value
)

// A JSON mapping stored compactly as sorted primitive arrays. Ids not contained in the mapping map to themselves.
class JsonMapping(private val keys: Array[Long], private val values: Array[Long]) {
  def apply(segmentId: Long): Long = {
    val index = java.util.Arrays.binarySearch(keys, segmentId)
    if (index >= 0) values(index) else segmentId
  }
}

object JsonMapping {
  def fromMap(mapping: Map[Long, Long]): JsonMapping = {
    val keys = mapping.keys.toArray
    java.util.Arrays.sort(keys)
    new JsonMapping(keys, keys.map(mapping))
  }
}

class MappingService @Inject() (config: DataStoreConfig, baseDirService: BaseDirService)(implicit ec: ExecutionContext)
    extends LazyLogging {

  private lazy val mappingsDir = "mappings"
  private lazy val mappingFileExtension = "json"

  private lazy val cache: AlfuCache[JsonMappingCacheKey, JsonMapping] =
    AlfuCache(maxCapacity = config.Datastore.Cache.Mapping.maxEntries)

  private lazy val bucketScanner = new NativeBucketScanner()

  def loadMappingBytes(request: DataServiceMappingRequest): Box[Array[Byte]] =
    for {
      dataSourceId <- Box.fromOption(request.dataSourceId)
      orgaDir <- baseDirService.getOneLocalForOrga(dataSourceId.organizationId)
      mappingsDirPath = orgaDir
        .resolve(dataSourceId.directoryName)
        .resolve(request.dataLayer.name)
        .resolve(mappingsDir)
        .normalize()
      mappingFilePath <- tryo(mappingsDirPath.resolve(s"${request.mapping}.$mappingFileExtension").normalize()) ?~>
        s"Invalid mapping name: ${request.mapping}"
      _ <- Box.fromBool(mappingFilePath.getParent == mappingsDirPath) ?~> s"Invalid mapping name: ${request.mapping}"
      result <- FileIO.readFileToByteArray(mappingFilePath.toFile)
    } yield result

  def loadMapping(request: DataServiceMappingRequest): Fox[JsonMapping] =
    cache.getOrLoad(
      JsonMappingCacheKey(request.dataSourceId, request.dataLayer.name, request.mapping, request.dataLayer.elementClass),
      _ =>
        (for {
          rawMapping <- loadMappingBytes(request)
          mapping <- MappingService.parseMapping(rawMapping, request.dataLayer.elementClass)
        } yield mapping).toFox
    )

  // Maps the little-endian segment ids in data (of the given element class), unmapped ids stay unchanged.
  def applyMapping(mapping: JsonMapping, data: Array[Byte], elementClass: ElementClass.Value): Box[Array[Byte]] =
    tryo(MappingService.applyMappingToBytes(mapping, data, elementClass, bucketScanner))

  def mapSegmentId(mapping: JsonMapping, segmentId: Long, elementClass: ElementClass.Value): Long =
    mapping(MappingService.normalizeSegmentId(segmentId, elementClass))

  def exploreMappings(layerDir: Path): Set[String] =
    PathUtils
      .listFiles(layerDir.resolve(mappingsDir), silent = true, PathUtils.fileExtensionFilter(mappingFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .getOrElse(Seq.empty)
      .toSet
}

object MappingService {

  // JSON mappings store ids as Longs, while the data holds ids of the element class's width. The ids are compared
  // in the representation the native bucket scanner reads them in: truncated to the element width and then sign- or
  // zero-extended. E.g. 300 and 44 are the same uint8 id, and 255 and -1 are the same int8 id.
  def normalizeSegmentId(segmentId: Long, elementClass: ElementClass.Value): Long = {
    val bits = ElementClass.bytesPerElement(elementClass) * 8
    if (bits >= 64) segmentId
    else if (ElementClass.isSigned(elementClass)) (segmentId << (64 - bits)) >> (64 - bits)
    else segmentId & ((1L << bits) - 1)
  }

  def parseMapping(rawMapping: Array[Byte], elementClass: ElementClass.Value): Box[JsonMapping] =
    MappingParser.parse[Long](rawMapping, normalizeSegmentId(_, elementClass)).map(m => JsonMapping.fromMap(m.mapping))

  // Collects the distinct ids natively, looks up only those and lets the native code rewrite the voxels.
  def applyMappingToBytes(
      mapping: JsonMapping,
      data: Array[Byte],
      elementClass: ElementClass.Value,
      bucketScanner: NativeBucketScanner
  ): Array[Byte] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val isSigned = ElementClass.isSigned(elementClass)
    val distinctSegmentIds = bucketScanner.collectSegmentIds(data, bytesPerElement, isSigned, skipZeroes = false)
    val mappedSegmentIds = distinctSegmentIds.map(mapping.apply)
    bucketScanner.applySegmentIdMapping(data, bytesPerElement, isSigned, distinctSegmentIds, mappedSegmentIds)
  }
}
