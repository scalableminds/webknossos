package braingames.binary.api

import braingames.binary.models.{DataLayer, DataSourceSettings, DataSourceRepository, DataSource}
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

  def userDataSourceName() = {
    UUID.randomUUID().toString
  }

  def userDataSourceFolder(name: String) = {
    userBaseFolder + "/" + name
  }

  def createUserDataSource(baseDataSource: DataSource): DataSource = {
    val name = userDataSourceName()
    val segmentationLayer = DataLayer(
      DataLayer.SEGMENTATION.name,
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      fallback = Some(baseDataSource.name))

    val dataSource = DataSource(
      name = name,
      baseDir = userDataSourceFolder(name),
      scale = baseDataSource.scale,
      dataLayers = List(segmentationLayer),
      owningTeam = baseDataSource.owningTeam
    )
    val baseFolder = new File(dataSource.baseDir)
    baseFolder.mkdirs()
    DataSourceSettings.writeToFolder(dataSource, baseFolder)
    dataSourceRepository.updateOrCreate(dataSource)
    dataSource
  }

  def writeToDataSource(dataSource: DataSource, block: Point3D, content: File) = {

  }
}
