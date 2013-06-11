package braingames.binary.api

import braingames.binary.models.{DataLayer, DataSetSettings, DataSetRepository, DataSet}
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

  def createUserDataSet(baseDataSet: DataSet): DataSet = {
    val name = userDataSetName()
    val segmentationLayer = DataLayer(
      DataLayer.SEGMENTATION.name,
      None,
      DataLayer.SEGMENTATION.defaultElementClass,
      fallback = Some(baseDataSet.name))

    val dataSet = DataSet(
      name = name,
      baseDir = userDataSetFolder(name),
      scale = baseDataSet.scale,
      dataLayers = List(segmentationLayer)
    )
    val baseFolder = new File(dataSet.baseDir)
    baseFolder.mkdirs()
    DataSetSettings.writeToFolder(dataSet, baseFolder)
    dataSetRepository.updateOrCreate(dataSet)
    dataSet
  }

  def writeToDataSet(dataSet: DataSet, block: Point3D, content: File) = {

  }
}
