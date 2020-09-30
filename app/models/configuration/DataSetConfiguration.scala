package models.configuration

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{Category, ViewConfiguration}
import javax.inject.Inject
import models.binary.{DataSet, DataSetService}
import play.api.libs.json._

case class DataSetLayerId(name: String, isSegmentationLayer: Boolean)
object DataSetLayerId { implicit val dataSetLayerId = Json.format[DataSetLayerId] }

case class DataSetConfiguration(configuration: Map[String, JsValue])

object DataSetConfiguration { implicit val dataSetConfigurationFormat = Json.format[DataSetConfiguration] }

class DataSetConfigurationDefaults @Inject()(dataSetService: DataSetService) {

  def constructInitialDefault(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[DataSetConfiguration] =
    for {
      dataSource <- dataSetService.dataSourceFor(dataSet)
      dataLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
      initialConfig = constructInitialDefault(dataLayers.map(dl => (dl.name, dl.category)),
                                              dataLayers.map(_.defaultViewConfiguration.map(_.toMap))).configuration
      sourceDefaultConfig = dataSet.sourceDefaultConfiguration.map(_.toMap).getOrElse(Map.empty)
      defaultConfig = dataSet.defaultConfiguration.map(_.configuration).getOrElse(Map.empty)
    } yield DataSetConfiguration(initialConfig ++ sourceDefaultConfig ++ defaultConfig)

  def constructInitialDefault(layers: List[(String, Category.Value)],
                              layerDefaults: List[Option[Map[String, JsValue]]] = List.empty): DataSetConfiguration = {
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

    DataSetConfiguration(
      Map(
        "fourBit" -> JsBoolean(false),
        "interpolation" -> JsBoolean(true),
        "highlightHoveredCellId" -> JsBoolean(true),
        "renderMissingDataBlack" -> JsBoolean(true),
        "layers" -> layerValues
      )
    )
  }

  def configurationOrDefaults(configuration: DataSetConfiguration,
                              sourceDefaultConfiguration: Option[ViewConfiguration] = None): Map[String, JsValue] =
    constructInitialDefault(List()).configuration ++
      sourceDefaultConfiguration.map(_.toMap).getOrElse(Map.empty) ++
      configuration.configuration

  def layerConfigurationOrDefaults(requestedLayer: List[DataSetLayerId],
                                   existingLayerConfiguration: Map[String, JsValue],
                                   sourceDefaultConfiguration: Map[String, JsValue]) =
    requestedLayer.map {
      case DataSetLayerId(name, isSegmentationLayer) =>
        (name,
         existingLayerConfiguration.getOrElse(
           name,
           sourceDefaultConfiguration.getOrElse(name,
                                                Json.toJson(
                                                  if (isSegmentationLayer) initialDefaultPerSegmentationLayer
                                                  else initialDefaultPerColorLayer))))
    }.toMap

  def buildCompleteConfig(initialConfiguration: Map[String, JsValue], layerConfigurations: Map[String, JsValue]) =
    DataSetConfiguration(initialConfiguration + ("layers" -> Json.toJson(layerConfigurations)))

  def getAllLayerSourceDefaultViewConfigForDataSet(dataSet: DataSet)(
      implicit ctx: DBAccessContext): Fox[Map[String, JsValue]] =
    for {

      dataSource <- dataSetService.dataSourceFor(dataSet)
      dataLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
      layerSourceDefaultViewConfig = dataLayers.flatMap(dl =>
        dl.defaultViewConfiguration.map(c => (dl.name, Json.toJson(c.toMap))))
    } yield layerSourceDefaultViewConfig.toMap

  val initialDefaultPerColorLayer: Map[String, JsValue] = Map(
    "brightness" -> JsNumber(0),
    "contrast" -> JsNumber(1),
    "color" -> Json.arr(255, 255, 255),
    "alpha" -> JsNumber(100)
  )

  val initialDefaultPerSegmentationLayer: Map[String, JsValue] = Map("alpha" -> JsNumber(20))

}
