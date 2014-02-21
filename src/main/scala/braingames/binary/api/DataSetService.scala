package braingames.binary.api

import braingames.binary.models.{DataLayer, DataSourceSettings, DataSourceRepository, DataSource, UserDataLayer}
import java.util.UUID
import com.typesafe.config.Config
import braingames.geometry.Point3D
import java.io.File

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 09.06.13
 * Time: 16:20
 */
trait DataSourceService {

  def config: Config

  def dataSourceRepository: DataSourceRepository

  lazy val userBaseFolder = config.getString("braingames.binary.userBaseFolder")

  def userDataLayerName() = {
    UUID.randomUUID().toString
  }

  def userDataLayerFolder(name: String) = {
    userBaseFolder + "/" + name
  }

def createUserDataSource(baseDataSource: DataSource): UserDataLayer = {
    val name = userDataLayerName()
    val baseFolder = new File(userDataLayerFolder(name))
    val sections = baseDataSource.dataLayer(DataLayer.SEGMENTATION.name).map(_.sections).getOrElse(Nil)
    val dataLayer = DataLayer(
      DataLayer.SEGMENTATION.name,
      baseFolder.getAbsolutePath(),
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      Some(baseDataSource.name),
      sections)

    baseFolder.mkdirs()
    UserDataLayer(name, baseDataSource.name, dataLayer)
  }
}
