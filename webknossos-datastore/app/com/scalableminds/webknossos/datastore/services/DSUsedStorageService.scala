package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat}

import java.nio.file.{Files, Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class DirectoryStorageReport(
    organizationName: String,
    datasetName: String,
    layerName: String,
    magOrDirectoryName: String,
    usedStorageBytes: Long
)

object DirectoryStorageReport {
  implicit val jsonFormat: OFormat[DirectoryStorageReport] = Json.format[DirectoryStorageReport]
}

class DSUsedStorageService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val baseDir: Path = Paths.get(config.Datastore.baseFolder)

  private def noSymlinksFilter(p: Path) = !Files.isSymbolicLink(p)

  def measureStorage(organizationName: String, datasetName: Option[String])(
      implicit ec: ExecutionContext): Fox[List[DirectoryStorageReport]] = {
    val organizationDirectory = baseDir.resolve(organizationName)
    if (Files.exists(organizationDirectory)) {
      measureStorage(organizationName, datasetName, organizationDirectory)
    } else Fox.successful(List())
  }

  def measureStorage(organizationName: String, datasetName: Option[String], organizationDirectory: Path)(
      implicit ec: ExecutionContext): Fox[List[DirectoryStorageReport]] = {
    def selectedDatasetFilter(p: Path) = datasetName.forall(name => p.getFileName.toString == name)

    for {
      datasetDirectories <- PathUtils.listDirectories(organizationDirectory,
                                                      silent = true,
                                                      noSymlinksFilter,
                                                      selectedDatasetFilter) ?~> "listdir.failed"
      storageReportsNested <- Fox.serialCombined(datasetDirectories)(d => measureStorageForDataset(organizationName, d))
    } yield storageReportsNested.flatten
  }

  private def measureStorageForDataset(organizationName: String,
                                       datasetDirectory: Path): Fox[List[DirectoryStorageReport]] =
    for {
      layerDirectory <- PathUtils.listDirectories(datasetDirectory, silent = true, noSymlinksFilter) ?~> "listdir.failed"
      storageReportsNested <- Fox.serialCombined(layerDirectory)(l =>
        measureStorageForLayerDirectory(organizationName, datasetDirectory, l))
    } yield storageReportsNested.flatten

  def measureStorageForLayerDirectory(organizationName: String,
                                      datasetDirectory: Path,
                                      layerDirectory: Path): Fox[List[DirectoryStorageReport]] =
    for {
      magOrOtherDirectory <- PathUtils.listDirectories(layerDirectory, silent = true, noSymlinksFilter) ?~> "listdir.failed"
      storageReportsNested <- Fox.serialCombined(magOrOtherDirectory)(m =>
        measureStorageForMagOrOtherDirectory(organizationName, datasetDirectory, layerDirectory, m))
    } yield storageReportsNested

  def measureStorageForMagOrOtherDirectory(organizationName: String,
                                           datasetDirectory: Path,
                                           layerDirectory: Path,
                                           magOrOtherDirectory: Path): Fox[DirectoryStorageReport] =
    for {
      usedStorageBytes <- measureStorage(magOrOtherDirectory)
    } yield
      DirectoryStorageReport(
        organizationName,
        datasetDirectory.getFileName.toString,
        layerDirectory.getFileName.toString,
        normalizeMagName(magOrOtherDirectory.getFileName.toString),
        usedStorageBytes
      )

  private def normalizeMagName(name: String): String =
    Vec3Int.fromMagLiteral(name, allowScalar = true) match {
      case Some(mag) => mag.toMagLiteral(allowScalar = true)
      case None      => name
    }

  def measureStorage(path: Path)(implicit ec: ExecutionContext): Fox[Long] =
    tryo(FileUtils.sizeOfDirectoryAsBigInteger(path.toFile).longValue)

}
