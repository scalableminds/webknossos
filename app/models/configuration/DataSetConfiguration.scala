package models.configuration

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.Category
import javax.inject.Inject
import models.binary.{DataSet, DataSetService}
import play.api.libs.json._

case class DataSetConfiguration(configuration: Map[String, JsValue])

object DataSetConfiguration { implicit val dataSetConfigurationFormat = Json.format[DataSetConfiguration] }

class DataSetConfigurationDefaults @Inject()(dataSetService: DataSetService) {

  def constructInitialDefault(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[DataSetConfiguration] =
    for {
      dataSource <- dataSetService.dataSourceFor(dataSet)
    } yield
      constructInitialDefault(
        dataSource.toUsable
          .map(d => d.dataLayers.filter(_.category != Category.segmentation).map(_.name))
          .getOrElse(List()))

  def constructInitialDefault(layerNames: List[String]): DataSetConfiguration = {
    val layerValues = Json.toJson(layerNames.map(layerName => (layerName -> initialDefaultPerLayer)).toMap)

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

  def configurationOrDefaults(configuration: DataSetConfiguration): Map[String, JsValue] =
    constructInitialDefault(List()).configuration ++ configuration.configuration

  val initialDefaultPerLayer: JsObject = Json.obj(
    "brightness" -> 0,
    "contrast" -> 1,
    "color" -> Json.arr(255, 255, 255),
    "alpha" -> 100
  )

}
