package models.configuration

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.{Category, ViewConfiguration}
import javax.inject.Inject
import models.binary.{DataSet, DataSetService}
import play.api.libs.json._

case class DataSetConfiguration(configuration: Map[String, JsValue])

object DataSetConfiguration { implicit val dataSetConfigurationFormat = Json.format[DataSetConfiguration] }

class DataSetConfigurationDefaults @Inject()(dataSetService: DataSetService) {

  def constructInitialDefault(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[DataSetConfiguration] =
    for {
      dataSource <- dataSetService.dataSourceFor(dataSet)
      dataLayers = dataSource.toUsable
        .map(d => d.dataLayers.filter(_.category != Category.segmentation))
        .getOrElse(List())
      defaultConfig = constructInitialDefault(dataLayers.map(_.name),
                                              dataLayers.map(_.defaultViewConfiguration.map(_.toMap))).configuration
      sourceDefaultConfig = dataSet.sourceDefaultConfiguration.map(_.toMap).getOrElse(Map.empty)
    } yield DataSetConfiguration(defaultConfig ++ sourceDefaultConfig)

  def constructInitialDefault(layerNames: List[String],
                              layerDefaults: List[Option[Map[String, JsValue]]] = List.empty): DataSetConfiguration = {
    val layerValues = Json.toJson(
      layerNames
        .zipAll(layerDefaults, "", None)
        .map {
          case (layerName, layerDefault) => layerName -> (initialDefaultPerLayer ++ layerDefault.getOrElse(Map.empty))
        }
        .toMap)

    DataSetConfiguration(
      Map(
        "fourBit" -> JsBoolean(false),
        "quality" -> JsNumber(0),
        "interpolation" -> JsBoolean(true),
        "segmentationOpacity" -> JsNumber(20),
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

  val initialDefaultPerLayer: Map[String, JsValue] = Map(
    "brightness" -> JsNumber(0),
    "contrast" -> JsNumber(1),
    "color" -> Json.arr(255, 255, 255),
    "alpha" -> JsNumber(100)
  )

}
