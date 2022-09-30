package models.binary.explore

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.n5.{N5DataLayer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr._
import com.scalableminds.webknossos.datastore.datareaders.jzarr._
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import java.nio.file.Path
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetParameters(remoteUri: String, user: Option[String], password: Option[String])
object ExploreRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetParameters] = Json.format[ExploreRemoteDatasetParameters]
}

case class MagWithAttributes(mag: MagLocator,
                             remotePath: Path,
                             elementClass: ElementClass.Value,
                             boundingBox: BoundingBox)

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteDatasource(
      urisWithCredentials: List[ExploreRemoteDatasetParameters],
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      exploredLayersNested <- Fox.serialCombined(urisWithCredentials)(parameters =>
        exploreRemoteLayersForUri(parameters.remoteUri, parameters.user, parameters.password, reportMutable))
      layersWithVoxelSizes = exploredLayersNested.flatten
      _ <- bool2Fox(layersWithVoxelSizes.nonEmpty) ?~> "Detected zero layers"
      voxelSize <- commonVoxelSize(layersWithVoxelSizes.map(_._2)) ?~> "Could not extract common voxel size from layers"
      layers = makeLayerNamesUnique(layersWithVoxelSizes.map(_._1))
      dataSetName <- dataSetName(urisWithCredentials.map(_.remoteUri))
      dataSource = GenericDataSource[DataLayer](
        DataSourceId(dataSetName, ""),
        layers,
        voxelSize
      )
    } yield dataSource

  private def makeLayerNamesUnique(layers: List[DataLayer]): List[DataLayer] = {
    val namesSetMutable = scala.collection.mutable.Set[String]()
    layers.map { layer: DataLayer =>
      var nameCandidate = layer.name
      var index = 1
      while (namesSetMutable.contains(nameCandidate)) {
        index += 1
        nameCandidate = f"${layer.name}_$index"
      }
      namesSetMutable.add(nameCandidate)
      if (nameCandidate == layer.name) {
        layer
      } else
        layer match {
          case l: ZarrDataLayer         => l.copy(name = nameCandidate)
          case l: ZarrSegmentationLayer => l.copy(name = nameCandidate)
          case l: N5DataLayer           => l.copy(name = nameCandidate)
          case l: N5SegmentationLayer   => l.copy(name = nameCandidate)
          case _                        => throw new Exception("Encountered unsupported layer format during explore remote")
        }
    }
  }

  private def dataSetName(uris: List[String])(implicit ec: ExecutionContext): Fox[String] =
    if (uris.length == 1) uris.headOption.map(normalizeUri(_).split("/").last).toFox
    else Fox.successful("explored_remote_dataset")

  private def commonVoxelSize(voxelSizes: List[Vec3Double])(implicit ec: ExecutionContext): Fox[Vec3Double] =
    for {
      head <- voxelSizes.headOption.toFox
      _ <- bool2Fox(voxelSizes.forall(_ == head)) ?~> s"voxel sizes for layers are not uniform, got $voxelSizes"
    } yield head

  private def exploreRemoteLayersForUri(
      layerUri: String,
      user: Option[String],
      password: Option[String],
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[List[(DataLayer, Vec3Double)]] =
    for {
      remoteSource <- tryo(RemoteSourceDescriptor(new URI(normalizeUri(layerUri)), user, password)).toFox ?~> s"Received invalid URI: $layerUri"
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "Failed to set up remote file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "Failed to get remote path"
      layersWithVoxelSizes <- exploreRemoteLayersForRemotePath(
        remotePath,
        remoteSource.credentials,
        reportMutable,
        List(new ZarrArrayExplorer, new NgffExplorer, new N5ArrayExplorer))
    } yield layersWithVoxelSizes

  private def normalizeUri(uri: String): String =
    if (uri.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) uri.dropRight(ZarrHeader.FILENAME_DOT_ZARRAY.length)
    else if (uri.endsWith(OmeNgffHeader.FILENAME_DOT_ZATTRS)) uri.dropRight(OmeNgffHeader.FILENAME_DOT_ZATTRS.length)
    else if (uri.endsWith(OmeNgffGroupHeader.FILENAME_DOT_ZGROUP))
      uri.dropRight(OmeNgffGroupHeader.FILENAME_DOT_ZGROUP.length)
    else uri

  private def exploreRemoteLayersForRemotePath(
      remotePath: Path,
      credentials: Option[FileSystemCredentials],
      reportMutable: ListBuffer[String],
      explorers: List[RemoteLayerExplorer])(implicit ec: ExecutionContext): Fox[List[(DataLayer, Vec3Double)]] =
    explorers match {
      case Nil => Fox.empty
      case currentExplorer :: remainingExplorers =>
        reportMutable += s"Trying to explore $remotePath as ${currentExplorer.name}..."
        currentExplorer.explore(remotePath, credentials).futureBox.flatMap {
          case Full(layersWithVoxelSizes) =>
            reportMutable += s"Found ${layersWithVoxelSizes.length} ${currentExplorer.name} layers at $remotePath."
            Fox.successful(layersWithVoxelSizes)
          case f: Failure =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: ${formatFailureForReport(f)}"
            exploreRemoteLayersForRemotePath(remotePath, credentials, reportMutable, remainingExplorers)
          case Empty =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: Empty"
            exploreRemoteLayersForRemotePath(remotePath, credentials, reportMutable, remainingExplorers)
        }
    }

  def formatFailureForReport(failure: Failure): String = {
    def formatChain(chain: Box[Failure]): String = chain match {
      case Full(failure) =>
        " <~ " + failure.msg + formatChain(failure.chain)
      case _ => ""
    }
    failure.msg + formatChain(failure.chain)
  }

}
