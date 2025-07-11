package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.{LayerMagLinkInfo, MagLinkInfo}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.{DataSourcePathInfo, DataStoreStatus}
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
import com.scalableminds.util.tools.Full
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import telemetry.SlackNotificationService
import utils.WkConf

import scala.concurrent.duration.DurationInt
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class WKRemoteDataStoreController @Inject()(
    datasetService: DatasetService,
    dataStoreService: DataStoreService,
    dataStoreDAO: DataStoreDAO,
    analyticsService: AnalyticsService,
    userService: UserService,
    organizationDAO: OrganizationDAO,
    usedStorageService: UsedStorageService,
    datasetDAO: DatasetDAO,
    datasetLayerDAO: DatasetLayerDAO,
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
            Fox.fromBool(usedStorageBytes + uploadInfo.totalFileSizeInBytes.getOrElse(0L) <= includedStorage)) ?~> "dataset.upload.storageExceeded" ~> FORBIDDEN
          _ <- Fox.fromBool(organization._id == user._organization) ?~> "notAllowed" ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(uploadInfo.name)
          _ <- Fox.fromBool(dataStore.onlyAllowedOrganization.forall(_ == organization._id)) ?~> "dataset.upload.Datastore.restricted"
          folderId <- ObjectId.fromString(uploadInfo.folderId.getOrElse(organization._rootFolder.toString)) ?~> "dataset.upload.folderId.invalid"
          _ <- folderDAO.assertUpdateAccess(folderId)(AuthorizedAccessContext(user)) ?~> "folder.noWriteAccess"
          layersToLinkWithDatasetId <- Fox.serialCombined(uploadInfo.layersToLink.getOrElse(List.empty))(l =>
            validateLayerToLink(l, user)) ?~> "dataset.upload.invalidLinkedLayers"
          dataset <- datasetService.createPreliminaryDataset(
            uploadInfo.name,
            uploadInfo.organization,
            dataStore,
            uploadInfo.requireUniqueName.getOrElse(false)) ?~> "dataset.upload.creation.failed"
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
          _ <- Fox.fromBool(organization._id == user._organization) ?~> "notAllowed" ~> FORBIDDEN
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
      _ <- Fox.fromBool(isTeamManagerOrAdmin || requestingUser.isDatasetManager || dataset.isPublic) ?~> "dataset.upload.linkRestricted"
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

  def statusUpdate(name: String, key: String): Action[DataStoreStatus] = Action.async(validateJson[DataStoreStatus]) {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        val okLabel = if (request.body.ok) "ok" else "not ok"
        logger.debug(s"Status update from data store '$name'. Status $okLabel")
        for {
          _ <- dataStoreDAO.updateUrlByName(name, request.body.url)
          _ <- dataStoreDAO.updateReportUsedStorageEnabledByName(name,
                                                                 request.body.reportUsedStorageEnabled.getOrElse(false))
        } yield Ok
      }
  }

  def updateAll(name: String, key: String): Action[List[InboxDataSource]] =
    Action.async(validateJson[List[InboxDataSource]]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        val dataSources = request.body
        for {
          before <- Instant.nowFox
          _ = logger.info(
            s"Received dataset list from datastore '${dataStore.name}': " +
              s"${dataSources.count(_.isUsable)} active, ${dataSources.count(!_.isUsable)} inactive")
          existingIds <- datasetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
          _ <- datasetService.deactivateUnreportedDataSources(existingIds, dataStore)
          _ = if (Instant.since(before) > (30 seconds))
            Instant.logSince(before, s"Updating datasources from datastore '${dataStore.name}'", logger)
        } yield Ok
      }
    }

  def updateOne(name: String, key: String): Action[InboxDataSource] =
    Action.async(validateJson[InboxDataSource]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        for {
          _ <- datasetService.updateDataSources(dataStore, List(request.body))(GlobalAccessContext)
        } yield Ok
      }
    }

  def updatePaths(name: String, key: String): Action[List[DataSourcePathInfo]] =
    Action.async(validateJson[List[DataSourcePathInfo]]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          _ <- datasetService.updateRealPaths(request.body)(GlobalAccessContext)
        } yield Ok
      }
    }

  def deleteDataset(name: String, key: String): Action[DataSourceId] = Action.async(validateJson[DataSourceId]) {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          existingDatasetBox <- datasetDAO.findOneByDataSourceId(request.body)(GlobalAccessContext).shiftBox
          _ <- existingDatasetBox match {
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

  def getPaths(name: String, key: String, organizationId: String, directoryName: String): Action[AnyContent] =
    Action.async { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext)
          dataset <- datasetDAO.findOneByDirectoryNameAndOrganization(directoryName, organization._id)(
            GlobalAccessContext)
          layers <- datasetLayerDAO.findAllForDataset(dataset._id)
          magsAndLinkedMags <- Fox.serialCombined(layers)(l => datasetService.getPathsForDataLayer(dataset._id, l.name))
          magLinkInfos = magsAndLinkedMags.map(_.map { case (mag, linkedMags) => MagLinkInfo(mag, linkedMags) })
          layersAndMagLinkInfos = layers.zip(magLinkInfos).map {
            case (layer, magLinkInfo) => LayerMagLinkInfo(layer.name, magLinkInfo)
          }
        } yield Ok(Json.toJson(layersAndMagLinkInfos))
      }
    }

  def getDataSource(name: String, key: String, datasetId: ObjectId): Action[AnyContent] =
    Action.async { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext)
          dataSource <- datasetService.fullDataSourceFor(dataset)
        } yield Ok(Json.toJson(dataSource))
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
