package models.configuration

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerLike
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration

import javax.inject.Inject
import models.dataset.{Dataset, DatasetDAO, DatasetLayerDAO, DatasetService, ThumbnailCachingService}
import models.user.{User, UserDatasetConfigurationDAO, UserDatasetLayerConfigurationDAO}
import play.api.libs.json._

import scala.concurrent.ExecutionContext

class DatasetConfigurationService @Inject() (
    datasetService: DatasetService,
    userDatasetConfigurationDAO: UserDatasetConfigurationDAO,
    userDatasetLayerConfigurationDAO: UserDatasetLayerConfigurationDAO,
    datasetDAO: DatasetDAO,
    thumbnailCachingService: ThumbnailCachingService,
    datasetDataLayerDAO: DatasetLayerDAO
)(implicit ec: ExecutionContext) {
  def getDatasetViewConfigurationForUserAndDataset(requestedVolumeIds: List[String], user: User, datasetId: ObjectId)(
      implicit ctx: DBAccessContext
  ): Fox[DatasetViewConfiguration] =
    for {

      dataset <- datasetDAO.findOne(datasetId)
      datasetViewConfiguration <- userDatasetConfigurationDAO.findOneForUserAndDataset(user._id, dataset._id)

      datasetLayers <- datasetService.allLayersFor(dataset)
      layerConfigurations <- getLayerConfigurations(datasetLayers, requestedVolumeIds, dataset, Some(user))
    } yield buildCompleteDatasetConfiguration(datasetViewConfiguration, layerConfigurations)

  def getDatasetViewConfigurationForDataset(requestedVolumeIds: List[String], datasetId: ObjectId)(implicit
      ctx: DBAccessContext
  ): Fox[DatasetViewConfiguration] =
    for {
      dataset <- datasetDAO.findOne(datasetId)

      datasetViewConfiguration = getDatasetViewConfigurationFromDefaultAndAdmin(dataset)

      datasetLayers <- datasetService.allLayersFor(dataset)
      layerConfigurations <- getLayerConfigurations(datasetLayers, requestedVolumeIds, dataset)
    } yield buildCompleteDatasetConfiguration(datasetViewConfiguration, layerConfigurations)

  private def getDatasetViewConfigurationFromDefaultAndAdmin(dataset: Dataset): DatasetViewConfiguration = {
    val defaultVC = dataset.defaultViewConfiguration.getOrElse(Map.empty)
    val adminVC = dataset.adminViewConfiguration.getOrElse(Map.empty)
    defaultVC ++ adminVC
  }

  def getCompleteAdminViewConfiguration(
      datasetId: ObjectId
  )(implicit ctx: DBAccessContext): Fox[DatasetViewConfiguration] =
    for {
      dataset <- datasetDAO.findOne(datasetId)
      datasetViewConfiguration = getDatasetViewConfigurationFromDefaultAndAdmin(dataset)
      datasetLayers <- datasetService.allLayersFor(dataset)
      layerConfigurations = getAllLayerAdminViewConfigForDataset(datasetLayers).view.mapValues(Json.toJson(_)).toMap
    } yield buildCompleteDatasetConfiguration(datasetViewConfiguration, layerConfigurations)

  private def mergeLayerConfigurations(
      allLayerNames: List[String],
      existingLayerVCs: Map[String, LayerViewConfiguration],
      adminLayerVCs: Map[String, LayerViewConfiguration],
      defaultVCs: Map[String, LayerViewConfiguration]
  ): Map[String, JsValue] =
    allLayerNames.map { name =>
      val defaultVC = defaultVCs.getOrElse(name, Map.empty)
      val adminVC = adminLayerVCs.getOrElse(name, Map.empty)
      val existingVC = existingLayerVCs.getOrElse(name, Map.empty)
      (name, Json.toJson(defaultVC ++ adminVC ++ existingVC))
    }.toMap

  private def buildCompleteDatasetConfiguration(
      datasetConfiguration: Map[String, JsValue],
      layerConfigurations: Map[String, JsValue]
  ): DatasetViewConfiguration =
    datasetConfiguration + ("layers" -> Json.toJson(layerConfigurations))

  private def getAllLayerDefaultViewConfigForDataset(
      dataLayers: List[DataLayerLike]
  ): Map[String, LayerViewConfiguration] =
    dataLayers.flatMap(dl => dl.defaultViewConfiguration.map(c => (dl.name, c))).toMap

  private def getAllLayerAdminViewConfigForDataset(
      dataLayers: List[DataLayerLike]
  ): Map[String, LayerViewConfiguration] =
    dataLayers.flatMap(dl => dl.adminViewConfiguration.map(c => (dl.name, c))).toMap

  private def getLayerConfigurations(
      datasetLayers: List[DataLayerLike],
      requestedVolumeIds: List[String],
      dataset: Dataset,
      userOpt: Option[User] = None
  ): Fox[Map[String, JsValue]] = {
    val allLayerNames = datasetLayers.map(_.name) ++ requestedVolumeIds
    (userOpt match {
      case Some(user) =>
        userDatasetLayerConfigurationDAO.findAllByLayerNameForUserAndDataset(allLayerNames, user._id, dataset._id)
      case None => Fox.successful(Map.empty[String, LayerViewConfiguration])
    }).map { existingLayerViewConfigs =>
      val layerDefaultViewConfigs = getAllLayerDefaultViewConfigForDataset(datasetLayers)
      val layerAdminViewConfigs = getAllLayerAdminViewConfigForDataset(datasetLayers)
      mergeLayerConfigurations(allLayerNames, existingLayerViewConfigs, layerAdminViewConfigs, layerDefaultViewConfigs)
    }
  }

  def updateAdminViewConfigurationFor(dataset: Dataset, rawAdminViewConfiguration: DatasetViewConfiguration)(implicit
      ctx: DBAccessContext
  ): Fox[Unit] = {
    val datasetViewConfiguration = rawAdminViewConfiguration - "layers"
    val layerViewConfigurations =
      rawAdminViewConfiguration
        .get("layers")
        .flatMap(lVC => lVC.asOpt[Map[String, LayerViewConfiguration]])
        .getOrElse(Map.empty)

    for {
      _ <- thumbnailCachingService.removeFromCache(dataset._id)
      _ <- datasetDAO.updateAdminViewConfiguration(dataset._id, datasetViewConfiguration)
      _ <- Fox.serialCombined(layerViewConfigurations.toList) { case (name, adminViewConfiguration) =>
        datasetDataLayerDAO.updateLayerAdminViewConfiguration(dataset._id, name, adminViewConfiguration)
      }
    } yield ()
  }
}
