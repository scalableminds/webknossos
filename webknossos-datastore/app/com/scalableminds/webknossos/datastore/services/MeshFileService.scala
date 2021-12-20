package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Json, OFormat}

import scala.collection.JavaConverters._
import scala.concurrent.ExecutionContext

trait GenericJsonFormat[T] {}

case class ListMeshChunksRequest(
    meshFile: String,
    segmentId: Long
)

object ListMeshChunksRequest {
  implicit val jsonFormat: OFormat[ListMeshChunksRequest] = Json.format[ListMeshChunksRequest]
}

case class MeshChunkDataRequest(
    meshFile: String,
    position: Point3D,
    segmentId: Long
)

object MeshChunkDataRequest {
  implicit val jsonFormat: OFormat[MeshChunkDataRequest] = Json.format[MeshChunkDataRequest]
}

case class MeshFileNameWithMappingName(
    meshFileName: String,
    mappingName: Option[String]
)

object MeshFileNameWithMappingName {
  implicit val jsonFormat: OFormat[MeshFileNameWithMappingName] = Json.format[MeshFileNameWithMappingName]
}

class MeshFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val meshesDir = "meshes"
  private val meshFileExtension = "hdf5"
  private val defaultLevelOfDetail = 0

  private lazy val meshFileCache = new Hdf5FileCache(30)

  def exploreMeshFiles(organizationName: String,
                       dataSetName: String,
                       dataLayerName: String): Fox[Set[MeshFileNameWithMappingName]] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    val meshFileNames = PathUtils
      .listFiles(layerDir.resolve(meshesDir), PathUtils.fileExtensionFilter(meshFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
    val mappingNameFoxes = meshFileNames.map { fileName =>
      val meshFilePath = layerDir.resolve(meshesDir).resolve(s"$fileName.$meshFileExtension")
      mappingNameForMeshFile(meshFilePath)
    }
    for {
      mappingNameBoxes: Seq[Box[String]] <- Fox.sequence(mappingNameFoxes)
      mappingNameOptions = mappingNameBoxes.map(_.toOption)
      zipped = meshFileNames.zip(mappingNameOptions).toSet
    } yield zipped.map(tuple => MeshFileNameWithMappingName(tuple._1, tuple._2))
  }

  /*
   Note that null is a valid value here for once. Meshfiles with no information about the
   meshFilePath will return Fox.empty, while meshfiles with one marked as empty, will return Fox.successful(null)
   */
  def mappingNameForMeshFile(meshFilePath: Path): Fox[String] =
    for {
      cachedMeshFile <- tryo { meshFileCache.withCache(meshFilePath)(initHDFReader) } ?~> "mesh.file.open.failed"
      mappingName <- tryo { _: Throwable =>
        cachedMeshFile.finishAccess()
      } { cachedMeshFile.reader.string().getAttr("/", "metadata/mapping_name") } ?~> "mesh.file.readEncoding.failed"
      _ = cachedMeshFile.finishAccess()
    } yield mappingName

  def listMeshChunksForSegment(organizationName: String,
                               dataSetName: String,
                               dataLayerName: String,
                               listMeshChunksRequest: ListMeshChunksRequest): Fox[List[Point3D]] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"${listMeshChunksRequest.meshFile}.$meshFileExtension")

    for {
      cachedMeshFile <- tryo { meshFileCache.withCache(meshFilePath)(CachedHdf5File.fromPath) } ?~> "mesh.file.open.failed"
      chunkPositionLiterals <- tryo { _: Throwable =>
        cachedMeshFile.finishAccess()
      } {
        cachedMeshFile.reader
          .`object`()
          .getAllGroupMembers(s"/${listMeshChunksRequest.segmentId}/$defaultLevelOfDetail")
          .asScala
          .toList
      }.toFox
      _ = cachedMeshFile.finishAccess()
      positions <- Fox.serialCombined(chunkPositionLiterals)(parsePositionLiteral)
    } yield positions
  }

  def readMeshChunk(organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    meshChunkDataRequest: MeshChunkDataRequest): Fox[(Array[Byte], String)] = {
    val meshFilePath = dataBaseDir
      .resolve(organizationName)
      .resolve(dataSetName)
      .resolve(dataLayerName)
      .resolve(meshesDir)
      .resolve(s"${meshChunkDataRequest.meshFile}.$meshFileExtension")
    for {
      cachedMeshFile <- tryo { meshFileCache.withCache(meshFilePath)(CachedHdf5File.fromPath) } ?~> "mesh.file.open.failed"
      encoding <- tryo { _: Throwable =>
        cachedMeshFile.finishAccess()
      } { cachedMeshFile.reader.string().getAttr("/", "metadata/encoding") } ?~> "mesh.file.readEncoding.failed"
      key = s"/${meshChunkDataRequest.segmentId}/$defaultLevelOfDetail/${positionLiteral(meshChunkDataRequest.position)}"
      data <- tryo { _: Throwable =>
        cachedMeshFile.finishAccess()
      } { cachedMeshFile.reader.readAsByteArray(key) } ?~> "mesh.file.readData.failed"
      _ = cachedMeshFile.finishAccess()
    } yield (data, encoding)
  }

  private def positionLiteral(position: Point3D) =
    s"${position.x}_${position.y}_${position.z}"

  private def parsePositionLiteral(positionLiteral: String): Fox[Point3D] = {
    val split = positionLiteral.split("_").toList
    for {
      _ <- bool2Fox(split.length == 3)
      asInts <- tryo { split.map(_.toInt) }
    } yield Point3D(asInts.head, asInts(1), asInts(2))
  }

}
