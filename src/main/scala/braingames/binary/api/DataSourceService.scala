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
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 16:20
 */
trait DataSourceService {

  def config: Config

  def dataSourceRepository: DataSourceRepository

  lazy val userBaseFolder = PathUtils.ensureDirectory(Path.fromString(config.getString("braingames.binary.userBaseFolder")))

  def userDataLayerName() = {
    UUID.randomUUID().toString
  }

  def userDataLayerFolder(name: String) = userBaseFolder / name

  def createUserDataSource(baseDataSource: DataSource): UserDataLayer = {
    val category = DataLayer.SEGMENTATION.category
    val name = userDataLayerName()
    val basePath = userDataLayerFolder(name)
    val sections = baseDataSource.getDataLayer(category).map(_.sections).getOrElse(Nil)
    val dataLayer = DataLayer(
      name,
      category,
      basePath.toAbsolute.path,
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      baseDataSource.getByCategory(category).map(l => FallbackLayer(baseDataSource.id, l.name)),
      sections)

    basePath.createDirectory()
    UserDataLayer(baseDataSource.id, dataLayer)
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

}
