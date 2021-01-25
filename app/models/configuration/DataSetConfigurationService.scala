package models.configuration

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerLike
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import javax.inject.Inject
import models.binary.{DataSet, DataSetDAO, DataSetDataLayerDAO, DataSetService}
import models.user.{User, UserDataSetConfigurationDAO, UserDataSetLayerConfigurationDAO}
import play.api.libs.json._

import scala.concurrent.ExecutionContext

class DataSetConfigurationService @Inject()(dataSetService: DataSetService,
                                            userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                                            userDataSetLayerConfigurationDAO: UserDataSetLayerConfigurationDAO,
                                            dataSetDAO: DataSetDAO,
                                            dataSetDataLayerDAO: DataSetDataLayerDAO)(implicit ec: ExecutionContext) {
  def getDataSetViewConfigurationForUserAndDataset(
      requestedVolumeIds: List[String],
      user: User,
      dataSetName: String,
      organizationName: String)(implicit ctx: DBAccessContext): Fox[DataSetViewConfiguration] =
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)

      dataSetViewConfiguration <- userDataSetConfigurationDAO.findOneForUserAndDataset(user._id, dataSet._id)

      dataSetLayers <- dataSetService.allLayersFor(dataSet)
      layerConfigurations <- getLayerConfigurations(dataSetLayers, requestedVolumeIds, dataSet, Some(user))
    } yield buildCompleteDataSetConfiguration(dataSetViewConfiguration, layerConfigurations)

  def getDataSetViewConfigurationForDataset(
      requestedVolumeIds: List[String],
      dataSetName: String,
      organizationName: String)(implicit ctx: DBAccessContext): Fox[DataSetViewConfiguration] =
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)

      dataSetViewConfiguration = getDataSetViewConfigurationFromDefaultAndAdmin(dataSet)

      dataSetLayers <- dataSetService.allLayersFor(dataSet)
      layerConfigurations <- getLayerConfigurations(dataSetLayers, requestedVolumeIds, dataSet)
    } yield buildCompleteDataSetConfiguration(dataSetViewConfiguration, layerConfigurations)

  def getDataSetViewConfigurationFromDefaultAndAdmin(dataSet: DataSet): DataSetViewConfiguration = {
    val defaultVC = dataSet.defaultViewConfiguration.getOrElse(Map.empty)
    val adminVC = dataSet.adminViewConfiguration.getOrElse(Map.empty)
    defaultVC ++ adminVC
  }

  def getCompleteAdminViewConfiguration(dataSetName: String, organizationName: String)(implicit ctx: DBAccessContext) =
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)
      dataSetViewConfiguration = getDataSetViewConfigurationFromDefaultAndAdmin(dataSet)

      dataSetLayers <- dataSetService.allLayersFor(dataSet)
      layerConfigurations = getAllLayerAdminViewConfigForDataSet(dataSetLayers).mapValues(Json.toJson(_))
    } yield buildCompleteDataSetConfiguration(dataSetViewConfiguration, layerConfigurations)

  private def mergeLayerConfigurations(allLayerNames: List[String],
                                       existingLayerVCs: Map[String, LayerViewConfiguration],
                                       adminLayerVCs: Map[String, LayerViewConfiguration],
                                       defaultVCs: Map[String, LayerViewConfiguration]): Map[String, JsValue] =
    allLayerNames.map { name =>
      val defaultVC = defaultVCs.getOrElse(name, Map.empty)
      val adminVC = adminLayerVCs.getOrElse(name, Map.empty)
      val existingVC = existingLayerVCs.getOrElse(name, Map.empty)
      (name, Json.toJson(defaultVC ++ adminVC ++ existingVC))
    }.toMap

  private def buildCompleteDataSetConfiguration(dataSetConfiguration: Map[String, JsValue],
                                                layerConfigurations: Map[String, JsValue]): DataSetViewConfiguration =
    dataSetConfiguration + ("layers" -> Json.toJson(layerConfigurations))

  private def getAllLayerDefaultViewConfigForDataSet(
      dataLayers: List[DataLayerLike]): Map[String, LayerViewConfiguration] =
    dataLayers.flatMap(dl => dl.defaultViewConfiguration.map(c => (dl.name, c))).toMap

  private def getAllLayerAdminViewConfigForDataSet(
      dataLayers: List[DataLayerLike]): Map[String, LayerViewConfiguration] =
    dataLayers.flatMap(dl => dl.adminViewConfiguration.map(c => (dl.name, c))).toMap

  def getLayerConfigurations(dataSetLayers: List[DataLayerLike],
                             requestedVolumeIds: List[String],
                             dataSet: DataSet,
                             userOpt: Option[User] = None): Fox[Map[String, JsValue]] = {
    val allLayerNames = dataSetLayers.map(_.name) ++ requestedVolumeIds
    (userOpt match {
      case Some(user) =>
        userDataSetLayerConfigurationDAO.findAllByLayerNameForUserAndDataset(allLayerNames, user._id, dataSet._id)
      case None => Fox.successful(Map.empty[String, LayerViewConfiguration])
    }).map { existingLayerViewConfigs =>
      val layerDefaultViewConfigs = getAllLayerDefaultViewConfigForDataSet(dataSetLayers)
      val layerAdminViewConfigs = getAllLayerAdminViewConfigForDataSet(dataSetLayers)
      mergeLayerConfigurations(allLayerNames, existingLayerViewConfigs, layerAdminViewConfigs, layerDefaultViewConfigs)
    }
  }

  def updateAdminViewConfigurationFor(dataSet: DataSet, rawAdminViewConfiguration: DataSetViewConfiguration)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val dataSetViewConfiguration = rawAdminViewConfiguration - "layers"
    val layerViewConfigurations =
      rawAdminViewConfiguration
        .get("layers")
        .flatMap(lVC => lVC.asOpt[Map[String, LayerViewConfiguration]])
        .getOrElse(Map.empty)

    for {
      _ <- dataSetDAO.updateAdminViewConfiguration(dataSet._id, dataSetViewConfiguration)
      _ <- Fox.serialCombined(layerViewConfigurations.toList) {
        case (name, adminViewConfiguration) =>
          dataSetDataLayerDAO.updateLayerAdminViewConfiguration(dataSet._id, name, adminViewConfiguration)
      }
    } yield ()
  }
}
