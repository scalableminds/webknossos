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
    val baseFolder = new File(userDataSetFolder(name))
    val sections = baseDataSet.dataLayer(DataLayer.SEGMENTATION.name).map(_.sections).getOrElse(Nil)
    val dataLayer = DataLayer(
      DataLayer.SEGMENTATION.name,
      baseFolder.getAbsolutePath(),
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      Some(baseDataSet.name),
      sections)

    baseFolder.mkdirs()
    UserDataLayer(name, baseDataSet.name, dataLayer)
  }
}
