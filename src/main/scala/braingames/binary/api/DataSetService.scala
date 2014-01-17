package braingames.binary.api

import braingames.binary.models.{DataLayer, DataSetSettings, DataSetRepository, DataSet, UserDataLayer}
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
trait DataSetService {

  def config: Config

  def dataSetRepository: DataSetRepository

  lazy val userBaseFolder = config.getString("braingames.binary.userBaseFolder")

  def userDataSetName() = {
    UUID.randomUUID().toString
  }

  def userDataSetFolder(name: String) = {
    userBaseFolder + "/" + name
  }

  def createUserDataLayer(baseDataSet: DataSet): UserDataLayer = {
    val name = userDataSetName()
    val dataLayer = DataLayer(
      DataLayer.SEGMENTATION.name,
      userDataSetFolder(name),
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      fallback = Some(baseDataSet.name))

    val baseFolder = new File(dataLayer.baseDir)
    baseFolder.mkdirs()
    UserDataLayer(name, baseDataSet.name, dataLayer)
  }

  def writeToDataSet(dataSet: DataSet, block: Point3D, content: File) = {

  }
}
