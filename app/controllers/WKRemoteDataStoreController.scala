package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.DataStoreStatus
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.analytics.{AnalyticsService, UploadDatasetEvent}
import models.binary._
import models.organization.OrganizationDAO
import net.liftweb.common.Full
import oxalis.mail.{MailchimpClient, MailchimpTag}
import oxalis.security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsSuccess, JsValue}
import play.api.mvc.Action

import scala.concurrent.{ExecutionContext, Future}

class WKRemoteDataStoreController @Inject()(
    dataSetService: DataSetService,
    dataStoreService: DataStoreService,
    dataStoreDAO: DataStoreDAO,
    analyticsService: AnalyticsService,
    organizationDAO: OrganizationDAO,
    dataSetDAO: DataSetDAO,
    mailchimpClient: MailchimpClient,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment)(implicit ec: ExecutionContext)
    extends Controller
    with LazyLogging {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def validateDataSetUpload(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { dataStore =>
      for {
        uploadInfo <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
        organization <- organizationDAO.findOneByName(uploadInfo.team)(GlobalAccessContext) ?~> Messages(
          "organization.notFound",
          uploadInfo.team) ~> NOT_FOUND
        _ <- bool2Fox(dataSetService.isProperDataSetName(uploadInfo.name)) ?~> "dataSet.name.invalid"
        _ <- dataSetService.assertNewDataSetName(uploadInfo.name, organization._id) ?~> "dataSet.name.alreadyTaken"
        _ <- bool2Fox(dataStore.onlyAllowedOrganization.forall(_ == organization._id)) ?~> "dataSet.upload.Datastore.restricted"
        _ <- dataSetService.reserveDataSetName(uploadInfo.name, uploadInfo.team, dataStore)
      } yield Ok
    }
  }

  def reportDatasetUpload(name: String,
                          key: String,
                          token: String,
                          dataSetName: String,
                          dataSetSizeBytes: Long): Action[JsValue] =
    Action.async(parse.json) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        withJsonBodyAs[List[String]] { teams =>
          for {
            user <- bearerTokenService.userForToken(token)(GlobalAccessContext)
            dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, user._organization)(GlobalAccessContext) ?~> Messages(
              "dataSet.notFound",
              dataSetName) ~> NOT_FOUND
            _ = analyticsService.track(UploadDatasetEvent(user, dataSet, dataStore, dataSetSizeBytes))
            _ = mailchimpClient.tagUser(user, MailchimpTag.HasUploadedOwnDataset)
            _ <- dataSetService.addInitialTeams(dataSet, teams)(AuthorizedAccessContext(user), request.messages)
            _ <- dataSetService.addUploader(dataSet, user._id)(AuthorizedAccessContext(user))
          } yield Ok
        }
      }
    }

  def statusUpdate(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { _ =>
      request.body.validate[DataStoreStatus] match {
        case JsSuccess(status, _) =>
          logger.debug(s"Status update from data store '$name'. Status: " + status.ok)
          dataStoreDAO.updateUrlByName(name, status.url).map(_ => Ok)
        case e: JsError =>
          logger.error("Data store '$name' sent invalid update. Error: " + e)
          Future.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def updateAll(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { dataStore =>
      request.body.validate[List[InboxDataSource]] match {
        case JsSuccess(dataSources, _) =>
          for {
            _ <- Fox.successful(
              logger.info(s"Received dataset list from datastore '${dataStore.name}': " +
                s"${dataSources.count(_.isUsable)} active, ${dataSources.count(!_.isUsable)} inactive datasets"))
            existingIds <- dataSetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
            _ <- dataSetService.deactivateUnreportedDataSources(existingIds, dataStore)
          } yield {
            JsonOk
          }

        case e: JsError =>
          logger.warn("Data store reported invalid json for data sources.")
          Fox.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def updateOne(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { dataStore =>
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

  def deleteErroneous(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { _ =>
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
