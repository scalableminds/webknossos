package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.Category
import javax.inject.Inject
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.configuration.{DataSetConfiguration, DataSetConfigurationDefaults, DataSetLayerId, UserConfiguration}
import models.user.{UserDataSetConfigurationDAO, UserDataSetLayerConfigurationDAO, UserService}
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json.Json._
import play.api.libs.json.{JsObject, JsValue}
import play.api.mvc.PlayBodyParsers

import scala.concurrent.ExecutionContext

class ConfigurationController @Inject()(
    userService: UserService,
    dataSetService: DataSetService,
    dataSetDAO: DataSetDAO,
    userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
    userDataSetLayerConfigurationDAO: UserDataSetLayerConfigurationDAO,
    dataSetConfigurationDefaults: DataSetConfigurationDefaults,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def read = sil.UserAwareAction.async { implicit request =>
    request.identity.toFox.flatMap { user =>
      for {
        userConfig <- user.userConfigurationStructured
      } yield userConfig.configurationOrDefaults
    }.getOrElse(UserConfiguration.default.configuration).map(configuration => Ok(toJson(configuration)))
  }

  def update = sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
    for {
      jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.invalid"
      conf = jsConfiguration.fields.toMap
      _ <- userService.updateUserConfiguration(request.identity, UserConfiguration(conf))
    } yield {
      JsonOk(Messages("user.configuration.updated"))
    }
  }

  def readDataSet(organizationName: String, dataSetName: String) =
    sil.UserAwareAction.async(validateJson[List[String]]) { implicit request =>
      request.identity.toFox.flatMap { user =>
        for {
          configurationJson: JsValue <- userDataSetConfigurationDAO.findOneForUserAndDataset(user._id, dataSetName)
          initialConfigurationMap = configurationJson.validate[Map[String, JsValue]].getOrElse(Map.empty)
          dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(GlobalAccessContext)
          dataSource <- dataSetService.dataSourceFor(dataSet)
          dataSetLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
          allLayerIds = dataSetLayers.map(dl => DataSetLayerId(dl.name, dl.category == Category.segmentation)) ++ request.body
            .map(DataSetLayerId(_, true))
          layerConfigJson <- userDataSetLayerConfigurationDAO.findAllByLayerNameForUserAndDataset(
            allLayerIds.map(_.name),
            user._id,
            dataSetName)
          layerSourceDefaultViewConfigs = dataSetConfigurationDefaults.getAllLayerSourceDefaultViewConfigForDataSet(
            dataSetLayers)
          layerSettings = dataSetConfigurationDefaults.layerConfigurationOrDefaults(allLayerIds,
                                                                                    layerConfigJson,
                                                                                    layerSourceDefaultViewConfigs)
        } yield dataSetConfigurationDefaults.buildCompleteConfig(initialConfigurationMap, layerSettings)
      }.orElse(
          for {
            dataSet <- dataSetDAO.findOneByNameAndOrganizationName(dataSetName, organizationName)(GlobalAccessContext)
            config <- dataSetConfigurationDefaults.constructInitialDefaultForDataset(dataSet, request.body)
          } yield config
        )
        .getOrElse(dataSetConfigurationDefaults.constructInitialDefaultForLayers(List()))
        .map(configuration => Ok(toJson(configuration.configuration)))
    }

  def updateDataSet(organizationName: String, dataSetName: String) =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        dataSetConf = conf - "layers"
        layerConf = conf.get("layers")
        _ <- userService.updateDataSetConfiguration(request.identity,
                                                    dataSetName,
                                                    organizationName,
                                                    DataSetConfiguration(dataSetConf),
                                                    layerConf)
      } yield {
        JsonOk(Messages("user.configuration.dataset.updated"))
      }
    }

  def readDataSetDefault(organizationName: String, dataSetName: String) = sil.SecuredAction.async { implicit request =>
    dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization).flatMap { dataSet: DataSet =>
      dataSet.defaultConfiguration match {
        case Some(c) =>
          Fox.successful(
            Ok(toJson(dataSetConfigurationDefaults.configurationOrDefaults(c, dataSet.sourceDefaultConfiguration))))
        case _ =>
          dataSetConfigurationDefaults.constructInitialDefaultForDataset(dataSet).map(c => Ok(toJson(c.configuration)))
      }
    }
  }

  def updateDataSetDefault(organizationName: String, dataSetName: String) =
    sil.SecuredAction.async(parse.json(maxLength = 20480)) { implicit request =>
      for {
        dataset <- dataSetDAO.findOneByNameAndOrganization(dataSetName, request.identity._organization) ?~> "dataset.notFound" ~> NOT_FOUND
        _ <- dataSetService.isEditableBy(dataset, Some(request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        jsConfiguration <- request.body.asOpt[JsObject] ?~> "user.configuration.dataset.invalid"
        conf = jsConfiguration.fields.toMap
        _ <- dataSetDAO.updateDefaultConfigurationByName(dataSetName, DataSetConfiguration(conf))
      } yield {
        JsonOk(Messages("user.configuration.dataset.updated"))
      }
    }
}
