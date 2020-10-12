package models.configuration

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerLike}
import javax.inject.Inject
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.user.{User, UserDataSetConfigurationDAO, UserDataSetLayerConfigurationDAO}
import play.api.libs.json._
import utils.ObjectId

case class DataSetLayerId(name: String, isSegmentationLayer: Boolean)
object DataSetLayerId { implicit val dataSetLayerId = Json.format[DataSetLayerId] }

//case class DataSetConfiguration(configuration: Map[String, JsValue])

class DataSetConfigurationService @Inject()(dataSetService: DataSetService,
                                            userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                                            userDataSetLayerConfigurationDAO: UserDataSetLayerConfigurationDAO,
                                            dataSetDAO: DataSetDAO) {

  def getDataSetConfigurationForUserAndDataset(
      requestedVolumeIds: List[String],
      user: User,
      dataSetName: String,
      organizationName: String)(implicit ctx: DBAccessContext): Fox[DataSetViewConfiguration] = {
    def getLayerConfigurations(dataSetLayers: List[DataLayerLike], requestedVolumeIds: List[String]) = {
      val allLayerNames = dataSetLayers.map(_.name) ++ requestedVolumeIds
      userDataSetLayerConfigurationDAO.findAllByLayerNameForUserAndDataset(allLayerNames, user._id, dataSetName).map {
        layerConfigJson =>
          val layerSourceDefaultViewConfigs = getAllLayerSourceDefaultViewConfigForDataSet(dataSetLayers)
          mergeLayerConfigurations(allLayerNames, layerConfigJson, layerSourceDefaultViewConfigs)
      }
    }
    for {
      configurationJson: JsValue <- userDataSetConfigurationDAO.findOneForUserAndDataset(user._id, dataSetName)
      dataSetConfiguration = configurationJson.validate[Map[String, JsValue]].getOrElse(Map.empty)

      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(GlobalAccessContext)
      dataSource <- dataSetService.dataSourceFor(dataSet)
      dataSetLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
      layerConfigurations <- getLayerConfigurations(dataSetLayers, requestedVolumeIds)
    } yield buildCompleteDataSetConfiguration(dataSetConfiguration, layerConfigurations)
  }

  def constructInitialDefaultForDataset(dataSet: DataSet, requestedVolumeIds: List[String] = List())(
      implicit ctx: DBAccessContext): Fox[DataSetViewConfiguration] =
    for {
      dataSource <- dataSetService.dataSourceFor(dataSet)
      dataLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
      initialConfig = constructInitialDefaultForLayers(
        dataLayers.map(dl => (dl.name, dl.category)) ++ requestedVolumeIds.map((_, Category.segmentation)),
        dataLayers.map(_.defaultViewConfiguration.map(_.toMap)) ++ requestedVolumeIds.map(_ => None)
      )
      sourceDefaultConfig = dataSet.defaultViewConfiguration.map(_.toMap).getOrElse(Map.empty)
      defaultConfig = dataSet.adminDefaultViewConfiguration.getOrElse(Map.empty)
    } yield initialConfig ++ sourceDefaultConfig ++ defaultConfig

  def constructInitialDefaultForLayers(
      layers: List[(String, Category.Value)],
      layerDefaults: List[Option[Map[String, JsValue]]] = List.empty): DataSetViewConfiguration = {
    val layerValues = Json.toJson(
      layers
        .zipAll(layerDefaults, ("", Category.color), None)
        .map {
          case ((name, category), default) =>
            category match {
              case Category.color        => name -> (initialDefaultPerColorLayer ++ default.getOrElse(Map.empty))
              case Category.segmentation => name -> (initialDefaultPerSegmentationLayer ++ default.getOrElse(Map.empty))
            }
        }
        .toMap)

    Map(
      "fourBit" -> JsBoolean(false),
      "interpolation" -> JsBoolean(true),
      "highlightHoveredCellId" -> JsBoolean(true),
      "renderMissingDataBlack" -> JsBoolean(true),
      "layers" -> layerValues
    )
  }

  def configurationOrDefaults(
      configuration: DataSetViewConfiguration,
      sourceDefaultConfiguration: Option[DataSetViewConfiguration] = None): Map[String, JsValue] =
    constructInitialDefaultForLayers(List()) ++ sourceDefaultConfiguration.getOrElse(Map.empty) ++ configuration

  def mergeLayerConfigurations(allLayerNames: List[String],
                               existingLayerConfiguration: Map[String, JsValue],
                               sourceDefaultConfiguration: Map[String, JsValue]) =
    allLayerNames.flatMap { name =>
      existingLayerConfiguration.get(name).orElse(sourceDefaultConfiguration.get(name)).map((name, _))
    }.toMap

  def buildCompleteDataSetConfiguration(dataSetConfiguration: Map[String, JsValue],
                                        layerConfigurations: Map[String, JsValue]): DataSetViewConfiguration =
    dataSetConfiguration + ("layers" -> Json.toJson(layerConfigurations))

  def getAllLayerSourceDefaultViewConfigForDataSet(dataLayers: List[DataLayerLike]): Map[String, JsValue] =
    dataLayers.flatMap(dl => dl.defaultViewConfiguration.map(c => (dl.name, Json.toJson(c.toMap)))).toMap

  val initialDefaultPerColorLayer: Map[String, JsValue] = Map(
    "brightness" -> JsNumber(0),
    "contrast" -> JsNumber(1),
    "color" -> Json.arr(255, 255, 255),
    "alpha" -> JsNumber(100)
  )

  val initialDefaultPerSegmentationLayer: Map[String, JsValue] = Map("alpha" -> JsNumber(20))

}
