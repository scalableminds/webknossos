package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths

import ch.systemsx.cisd.hdf5.HDF5FactoryProvider
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Json, OFormat}

import scala.collection.JavaConverters._

trait GenericJsonFormat[T] {
}

case class ListMeshChunksRequest(
                                  meshFile: String,
    segmentId: Long,
    mag: Point3D
)

object ListMeshChunksRequest {
  implicit val jsonFormat: OFormat[ListMeshChunksRequest] = Json.format[ListMeshChunksRequest]
}

case class MeshChunkDataRequest(
    meshFile: String,
    position: Point3D,
    segmentId: Long,
    mag: Point3D
)

object MeshChunkDataRequest {
  implicit val jsonFormat: OFormat[MeshChunkDataRequest] = Json.format[MeshChunkDataRequest]
}

class MeshFileService @Inject()(config: DataStoreConfig) extends FoxImplicits with LazyLogging {

  private val dataBaseDir = Paths.get(config.Braingames.Binary.baseFolder)
  private val meshesDir = "meshes"
  private val meshFileExtension = "hdf5"

  def exploreMeshFiles(organizationName: String, dataSetName: String, dataLayerName: String): Set[String] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    PathUtils
      .listFiles(layerDir.resolve(meshesDir), PathUtils.fileExtensionFilter(meshFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet
  }

  def listMeshChunksForSegment(organizationName: String, dataSetName: String, dataLayerName: String, listMeshChunksRequest: ListMeshChunksRequest): List[String] = {
    val hdfFile =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"${listMeshChunksRequest.meshFile}.$meshFileExtension")
        .toFile

    val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
    reader.`object`().getAllGroupMembers(s"/${listMeshChunksRequest.segmentId}/${magLiteral(listMeshChunksRequest.mag)}").asScala.toList
  }

  def readMeshChunk(organizationName: String, dataSetName: String, dataLayerName: String, meshChunkDataRequest: MeshChunkDataRequest): Array[Byte] = {
    val hdfFile =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"${meshChunkDataRequest.meshFile}.$meshFileExtension")
        .toFile

    val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
    reader.readAsByteArray(s"/${meshChunkDataRequest.segmentId}/${magLiteral(meshChunkDataRequest.mag)}/${positionLiteral(meshChunkDataRequest.position)}")
  }

  private def positionLiteral(position: Point3D) =
    s"${position.x}_${position.y}_${position.z}"

  private def magLiteral(position: Point3D) =
    s"${position.x}-${position.y}-${position.z}"

}
