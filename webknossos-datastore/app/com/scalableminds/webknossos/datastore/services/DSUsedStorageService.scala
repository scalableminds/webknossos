package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FileUtils
import play.api.libs.json.{Json, OFormat}

import java.nio.file.{Files, Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class DirectoryStorageReport(
    organizationName: String,
    dataSetName: String,
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

  def measureStorage(organizationName: String, dataSetName: Option[String])(
      implicit ec: ExecutionContext): Fox[List[DirectoryStorageReport]] = {
    def selectedDatasetFilter(p: Path) = dataSetName.forall(name => p.getFileName.toString == name)

    for {
      datasetDirectories <- PathUtils.listDirectories(baseDir.resolve(organizationName),
                                                      noSymlinksFilter,
                                                      selectedDatasetFilter) ?~> "listdir.failed"
      storageReportsNested <- Fox.serialCombined(datasetDirectories)(d => measureStorageForDataSet(organizationName, d))
    } yield storageReportsNested.flatten
  }

  def measureStorageForDataSet(organizationName: String, dataSetDirectory: Path): Fox[List[DirectoryStorageReport]] =
    for {
      layerDirectory <- PathUtils.listDirectories(dataSetDirectory, noSymlinksFilter) ?~> "listdir.failed"
      storageReportsNested <- Fox.serialCombined(layerDirectory)(l =>
        measureStorageForLayerDirectory(organizationName, dataSetDirectory, l))
    } yield storageReportsNested.flatten

  def measureStorageForLayerDirectory(organizationName: String,
                                      dataSetDirectory: Path,
                                      layerDirectory: Path): Fox[List[DirectoryStorageReport]] =
    for {
      magOrOtherDirectory <- PathUtils.listDirectories(layerDirectory, noSymlinksFilter) ?~> "listdir.failed"
      storageReportsNested <- Fox.serialCombined(magOrOtherDirectory)(m =>
        measureStorageForMagOrOtherDirectory(organizationName, dataSetDirectory, layerDirectory, m))
    } yield storageReportsNested

  def measureStorageForMagOrOtherDirectory(organizationName: String,
                                           dataSetDirectory: Path,
                                           layerDirectory: Path,
                                           magOrOtherDirectory: Path): Fox[DirectoryStorageReport] =
    for {
      usedStorageBytes <- measureStorage(magOrOtherDirectory)
    } yield
      DirectoryStorageReport(
        organizationName,
        dataSetDirectory.getFileName.toString,
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
