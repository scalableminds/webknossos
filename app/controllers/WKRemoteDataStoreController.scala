package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.DataStoreStatus
import com.scalableminds.webknossos.datastore.services.uploading.{
  LinkedLayerIdentifier,
  ReserveAdditionalInformation,
  ReserveUploadInformation
}
import com.typesafe.scalalogging.LazyLogging
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, UploadDatasetEvent}
import models.annotation.AnnotationDAO
import models.dataset._
import models.dataset.credential.CredentialDAO
import models.folder.FolderDAO
import models.job.JobDAO
import models.organization.OrganizationDAO
import models.storage.UsedStorageService
import models.team.TeamDAO
import models.user.{MultiUserDAO, User, UserDAO, UserService}
import net.liftweb.common.Full
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsError, JsSuccess, JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import telemetry.SlackNotificationService
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

class WKRemoteDataStoreController @Inject()(
    datasetService: DatasetService,
    dataStoreService: DataStoreService,
    dataStoreDAO: DataStoreDAO,
    analyticsService: AnalyticsService,
    userService: UserService,
    organizationDAO: OrganizationDAO,
    usedStorageService: UsedStorageService,
    datasetDAO: DatasetDAO,
    userDAO: UserDAO,
    folderDAO: FolderDAO,
    teamDAO: TeamDAO,
    jobDAO: JobDAO,
    multiUserDAO: MultiUserDAO,
    credentialDAO: CredentialDAO,
    annotationDAO: AnnotationDAO,
    mailchimpClient: MailchimpClient,
    slackNotificationService: SlackNotificationService,
    conf: WkConf,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with LazyLogging {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def reserveDatasetUpload(name: String, key: String, token: String): Action[ReserveUploadInformation] =
    Action.async(validateJson[ReserveUploadInformation]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        val uploadInfo = request.body
        for {
          user <- bearerTokenService.userForToken(token)
          organization <- organizationDAO.findOne(uploadInfo.organization)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            uploadInfo.organization) ~> NOT_FOUND
          usedStorageBytes <- organizationDAO.getUsedStorage(organization._id)
          _ <- Fox.runOptional(organization.includedStorageBytes)(includedStorage =>
            bool2Fox(usedStorageBytes + uploadInfo.totalFileSize.getOrElse(0) <= includedStorage)) ?~> "dataset.upload.storageExceeded" ~> FORBIDDEN
          _ <- bool2Fox(organization._id == user._organization) ?~> "notAllowed" ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(uploadInfo.name)
          _ <- bool2Fox(dataStore.onlyAllowedOrganization.forall(_ == organization._id)) ?~> "dataset.upload.Datastore.restricted"
          folderId <- ObjectId.fromString(uploadInfo.folderId.getOrElse(organization._rootFolder.toString)) ?~> "dataset.upload.folderId.invalid"
          _ <- folderDAO.assertUpdateAccess(folderId)(AuthorizedAccessContext(user)) ?~> "folder.noWriteAccess"
          layersToLinkWithDatasetId <- Fox.serialCombined(uploadInfo.layersToLink.getOrElse(List.empty))(l =>
            validateLayerToLink(l, user)) ?~> "dataset.upload.invalidLinkedLayers"
          dataset <- datasetService.createPreliminaryDataset(uploadInfo.name, uploadInfo.organization, dataStore) ?~> "dataset.name.alreadyTaken"
          _ <- datasetDAO.updateFolder(dataset._id, folderId)(GlobalAccessContext)
          _ <- datasetService.addInitialTeams(dataset, uploadInfo.initialTeams, user)(AuthorizedAccessContext(user))
          _ <- datasetService.addUploader(dataset, user._id)(AuthorizedAccessContext(user))
          additionalInfo = ReserveAdditionalInformation(dataset._id,
                                                        dataset.directoryName,
                                                        if (layersToLinkWithDatasetId.isEmpty) None
                                                        else Some(layersToLinkWithDatasetId))
        } yield Ok(Json.toJson(additionalInfo))
      }
    }

  def getUnfinishedUploadsForUser(name: String,
                                  key: String,
                                  token: String,
                                  organizationId: String): Action[AnyContent] =
    Action.async { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          user <- bearerTokenService.userForToken(token)
          organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            user._organization) ~> NOT_FOUND
          _ <- bool2Fox(organization._id == user._organization) ?~> "notAllowed" ~> FORBIDDEN
          datasets <- datasetService.getAllUnfinishedDatasetUploadsOfUser(user._id, user._organization)(
            GlobalAccessContext) ?~> "dataset.upload.couldNotLoadUnfinishedUploads"
          teamIdsPerDataset <- Fox.combined(datasets.map(dataset => teamDAO.findAllowedTeamIdsForDataset(dataset.id)))
          unfinishedUploads = datasets.zip(teamIdsPerDataset).map {
            case (d, teamIds) =>
              new UnfinishedUpload("<filled-in by datastore>",
                                   d.dataSourceId,
                                   d.name,
                                   d.folderId.toString,
                                   d.created,
                                   None, // Filled by datastore.
                                   teamIds.map(_.toString))
          }
        } yield Ok(Json.toJson(unfinishedUploads))
      }
    }

  private def validateLayerToLink(layerIdentifier: LinkedLayerIdentifier, requestingUser: User)(
      implicit ec: ExecutionContext,
      m: MessagesProvider): Fox[LinkedLayerIdentifier] =
    for {
      organization <- organizationDAO.findOne(layerIdentifier.getOrganizationId)(GlobalAccessContext) ?~> Messages(
        "organization.notFound",
        layerIdentifier.getOrganizationId) ~> NOT_FOUND
      dataset <- datasetDAO.findOneByNameAndOrganization(layerIdentifier.dataSetName, organization._id)(
        AuthorizedAccessContext(requestingUser)) ?~> Messages("dataset.notFound", layerIdentifier.dataSetName)
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(requestingUser, dataset._organization)
      _ <- Fox.bool2Fox(isTeamManagerOrAdmin || requestingUser.isDatasetManager || dataset.isPublic) ?~> "dataset.upload.linkRestricted"
    } yield layerIdentifier.copy(datasetDirectoryName = Some(dataset.directoryName))

  def reportDatasetUpload(name: String,
                          key: String,
                          token: String,
                          datasetDirectoryName: String,
                          datasetSizeBytes: Long,
                          needsConversion: Boolean,
                          viaAddRoute: Boolean): Action[AnyContent] =
    Action.async { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        for {
          user <- bearerTokenService.userForToken(token)
          dataset <- datasetDAO.findOneByDirectoryNameAndOrganization(datasetDirectoryName, user._organization)(
            GlobalAccessContext) ?~> Messages("dataset.notFound", datasetDirectoryName) ~> NOT_FOUND
          _ <- Fox.runIf(!needsConversion && !viaAddRoute)(usedStorageService.refreshStorageReportForDataset(dataset))
          _ <- Fox.runIf(!needsConversion)(logUploadToSlack(user, dataset._id, viaAddRoute))
          _ = analyticsService.track(UploadDatasetEvent(user, dataset, dataStore, datasetSizeBytes))
          _ = if (!needsConversion) mailchimpClient.tagUser(user, MailchimpTag.HasUploadedOwnDataset)
        } yield Ok(Json.obj("id" -> dataset._id))
      }
    }

  private def logUploadToSlack(user: User, datasetId: ObjectId, viaAddRoute: Boolean): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      resultLink = s"${conf.Http.uri}/datasets/$datasetId"
      addLabel = if (viaAddRoute) "(via explore+add)" else "(upload without conversion)"
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = slackNotificationService.info(s"Dataset added $addLabel$superUserLabel",
                                        s"For organization: ${organization.name}. <$resultLink|Result>")
    } yield ()

  def statusUpdate(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { _ =>
      request.body.validate[DataStoreStatus] match {
        case JsSuccess(status, _) =>
          logger.debug(s"Status update from data store '$name'. Status: " + status.ok)
          for {
            _ <- dataStoreDAO.updateUrlByName(name, status.url)
            _ <- dataStoreDAO.updateReportUsedStorageEnabledByName(name,
                                                                   status.reportUsedStorageEnabled.getOrElse(false))
          } yield Ok
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
            existingIds <- datasetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
            _ <- datasetService.deactivateUnreportedDataSources(existingIds, dataStore)
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
            _ <- datasetService.updateDataSources(dataStore, List(dataSource))(GlobalAccessContext)
          } yield {
            JsonOk
          }
        case e: JsError =>
          logger.warn("Data store reported invalid json for data source.")
          Fox.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def deleteDataset(name: String, key: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name, key) { _ =>
      for {
        datasourceId <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
        existingDataset = datasetDAO.findOneByDataSourceId(datasourceId)(GlobalAccessContext).futureBox

        _ <- existingDataset.flatMap {
          case Full(dataset) =>
            for {
              annotationCount <- annotationDAO.countAllByDataset(dataset._id)(GlobalAccessContext)
              _ = datasetDAO
                .deleteDataset(dataset._id, onlyMarkAsDeleted = annotationCount > 0)
                .flatMap(_ => usedStorageService.refreshStorageReportForDataset(dataset))
            } yield ()

          case _ => Fox.successful(())
        }
      } yield Ok
    }
  }

  def jobExportProperties(name: String, key: String, jobId: ObjectId): Action[AnyContent] = Action.async {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          job <- jobDAO.findOne(jobId)(GlobalAccessContext)
          jobOwner <- userDAO.findOne(job._owner)(GlobalAccessContext)
          organization <- organizationDAO.findOne(jobOwner._organization)(GlobalAccessContext)
          latestRunId <- job.latestRunId.toFox ?~> "job.notRun"
          exportFileName <- job.exportFileName.toFox ?~> "job.noExportFileName"
          jobExportProperties = JobExportProperties(jobId.toString, latestRunId, organization._id, exportFileName)
        } yield Ok(Json.toJson(jobExportProperties))
      }
  }

  def findCredential(name: String, key: String, credentialId: ObjectId): Action[AnyContent] = Action.async {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          credential <- credentialDAO.findOne(credentialId)
        } yield Ok(Json.toJson(credential))
      }
  }

}
