package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.DataStoreStatus
import com.typesafe.scalalogging.LazyLogging
import models.binary._
import models.team.{OrganizationDAO, TeamDAO}
import models.user.UserService
import net.liftweb.common.Full
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsSuccess, JsValue}
import play.api.mvc.Action

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class WKDataStoreController @Inject()(dataSetService: DataSetService,
                                      dataStoreService: DataStoreService,
                                      dataStoreDAO: DataStoreDAO,
                                      userService: UserService,
                                      organizationDAO: OrganizationDAO,
                                      dataSetDAO: DataSetDAO,
                                      teamDAO: TeamDAO,
                                      dataSetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                                      wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                      sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with LazyLogging {

  val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def validateDataSetUpload(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      for {
        uploadInfo <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
        organization <- organizationDAO
          .findOneByName(uploadInfo.team)(GlobalAccessContext) ?~> "organization.notFound" ~> NOT_FOUND
        _ <- bool2Fox(dataSetService.isProperDataSetName(uploadInfo.name)) ?~> "dataSet.name.invalid"
        _ <- dataSetService
          .assertNewDataSetName(uploadInfo.name, organization._id)(GlobalAccessContext) ?~> "dataSet.name.alreadyTaken"
        _ <- bool2Fox(dataStore.onlyAllowedOrganization.forall(_ == organization._id)) ?~> "dataSet.upload.Datastore.restricted"
        _ <- dataSetService.reserveDataSetName(uploadInfo.name, uploadInfo.team, dataStore)
      } yield Ok
    }
  }

  def addDataSetInitialTeams(name: String, token: String, dataSetName: String): Action[JsValue] =
    Action.async(parse.json) { implicit request =>
      dataStoreService.validateAccess(name) { dataStore =>
        withJsonBodyAs[List[String]] { teams =>
          for {
            user <- bearerTokenService.userForToken(token)(GlobalAccessContext)
            dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, user._organization)(GlobalAccessContext) ?~> Messages(
              "dataSet.notFound",
              dataSetName) ~> NOT_FOUND
            _ <- dataSetService.addInitialTeams(dataSet, teams)(AuthorizedAccessContext(user))
          } yield Ok
        }
      }
    }

  def statusUpdate(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      request.body.validate[DataStoreStatus] match {
        case JsSuccess(status, _) =>
          logger.debug(s"Status update from data store '$name'. Status: " + status.ok)
          dataStoreDAO.updateUrlByName(name, status.url)(GlobalAccessContext).map(_ => Ok)
        case e: JsError =>
          logger.error("Data store '$name' sent invalid update. Error: " + e)
          Future.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def updateAll(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      request.body.validate[List[InboxDataSource]] match {
        case JsSuccess(dataSources, _) =>
          for {
            _ <- Fox.successful(
              logger.info(s"Received dataset list from datastore '${dataStore.name}': " +
                s"${dataSources.count(_.isUsable)} active, ${dataSources.count(!_.isUsable)} inactive datasets"))
            existingIds <- dataSetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
            _ <- dataSetService.deactivateUnreportedDataSources(existingIds, dataStore)(GlobalAccessContext)
          } yield {
            JsonOk
          }

        case e: JsError =>
          logger.warn("Data store reported invalid json for data sources.")
          Fox.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def updateOne(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      request.body.validate[InboxDataSource] match {
        case JsSuccess(dataSource, _) =>
          for {
            _ <- dataSetService.updateDataSources(dataStore, List(dataSource))(GlobalAccessContext)
          } yield {
            JsonOk
          }
        case e: JsError =>
          logger.warn("Data store reported invalid json for data source.")
          Fox.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def deleteErroneous(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { _ =>
      for {
        datasourceId <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
        existingDataset = dataSetDAO
          .findOneByNameAndOrganizationName(datasourceId.name, datasourceId.team)(GlobalAccessContext)
          .futureBox
        _ <- existingDataset.flatMap {
          case Full(dataset) => dataSetDAO.deleteDataset(dataset._id)
          case _             => Fox.successful(())
        }
      } yield Ok
    }

  }
}
