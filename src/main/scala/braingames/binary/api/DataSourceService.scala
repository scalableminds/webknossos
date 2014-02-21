package braingames.binary.api

import braingames.binary.models._
import java.util.UUID
import com.typesafe.config.Config
import braingames.geometry.Point3D
import java.io.File
import scala.Some
import scalax.file.Path
import braingames.util.PathUtils
import braingames.binary.repository.DataSourceRepository
import braingames.binary.models.DataSourceRepository
import scala.concurrent.Future
import braingames.binary.Logger._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 16:20
 */
trait DataSourceService {

  def config: Config

  def dataSourceRepository: DataSourceRepository

  lazy val userBaseFolder = PathUtils.ensureDirectory(Path(config.getString("braingames.binary.userBaseFolder")))

  def userDataSourceId() = {
    UUID.randomUUID().toString
  }

  def userDataSourceFolder(name: String) = userBaseFolder / name

  def createUserDataSource(baseDataSource: DataSource): DataSource = {
    val id = userDataSourceId()
    val segmentationLayer = DataLayer(
      DataLayer.SEGMENTATION.name,
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      fallback = Some(baseDataSource.id))

    val dataSource = DataSource(
      id = id,
      baseDir = userDataSourceFolder(id).toAbsolute.path,
      scale = baseDataSource.scale,
      dataLayers = List(segmentationLayer)
    )

    dataSource.sourceFolder.doCreateParents()
    DataSourceSettings.writeToFolder(dataSource, dataSource.sourceFolder)
    dataSource
  }

  def importDataSource(id: String): Option[Future[Option[UsableDataSource]]] = {
    DataSourceRepository.dataSources().find(_.id == id).flatMap {
      case ibx: UnusableDataSource if !DataSourceRepository.isImportInProgress(ibx.id)=>
        Some(DataSourceRepository.transformToDataSource(ibx))
      case d: DataSource =>
        None  // TODO: think about what we should do if an already imported DS gets imported again
      case d =>
        None
    }
  }

  def importProgress(id: String) = DataSourceRepository.progressForImport(id)

  def writeToDataSource(dataSource: DataSource, block: Point3D, content: File) = {

  }
}
