package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataSource,
  DataSourceId,
  DataSourceStatus,
  LayerAttachmentType,
  UnusableDataSource
}
import com.scalableminds.webknossos.datastore.services.{DataSourcePathInfo, DataSourceWithRootPathInfo, DataStoreStatus}
import com.scalableminds.webknossos.datastore.services.uploading.{
  AttachmentUploadAdditionalInfo,
  AttachmentUploadInfo,
  DatasetUploadAdditionalInfo,
  DatasetUploadInfo,
  MagUploadAdditionalInfo,
  MagUploadInfo,
  ReportAttachmentUploadParameters,
  ReportDatasetUploadParameters,
  ReportMagUploadParameters
}
import com.typesafe.scalalogging.LazyLogging
import models.dataset._
import models.dataset.credential.CredentialDAO
import models.job.{JobDAO, JobService}
import models.organization.{OrganizationDAO, OrganizationService}
import models.storage.UsedStorageService
import models.team.TeamDAO
import models.user.UserDAO
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}

import scala.concurrent.duration.DurationInt
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class WKRemoteDataStoreController @Inject() (
    datasetService: DatasetService,
    dataStoreService: DataStoreService,
    dataStoreDAO: DataStoreDAO,
    organizationDAO: OrganizationDAO,
    usedStorageService: UsedStorageService,
    organizationService: OrganizationService,
    layerToLinkService: LayerToLinkService,
    datasetDAO: DatasetDAO,
    userDAO: UserDAO,
    teamDAO: TeamDAO,
    jobDAO: JobDAO,
    datasetMagDAO: DatasetMagDAO,
    datasetAttachmentDAO: DatasetLayerAttachmentDAO,
    uploadToPathsService: UploadToPathsService,
    jobService: JobService,
    credentialDAO: CredentialDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with LazyLogging {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def reserveDatasetUpload(name: String, key: String, token: String): Action[DatasetUploadInfo] =
    Action.fox(validateJson[DatasetUploadInfo]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        val uploadInfo = request.body
        for {
          user <- bearerTokenService.userForToken(token) ~> FORBIDDEN
          organization <- organizationDAO.findOne(uploadInfo.organizationId)(using
            GlobalAccessContext
          ) ?~> Msg.Organization.notFound(uploadInfo.organizationId) ~> NOT_FOUND
          _ <- organizationService.assertUsedStorageNotExceeded(
            organization,
            uploadInfo.resumableUploadInfo.totalFileSizeInBytes
          ) ?~> Msg.Dataset.Upload.storageExceeded ~> FORBIDDEN
          _ <- Fox.fromBool(organization._id == user._organization) ?~> Msg.notAllowed ~> FORBIDDEN
          _ <- datasetService.assertValidDatasetName(uploadInfo.datasetName)
          _ <- Fox.fromBool(
            dataStore.onlyAllowedOrganization.forall(_ == organization._id)
          ) ?~> Msg.Dataset.Upload.datastoreRestricted
          _ <- Fox.serialCombined(uploadInfo.layersToLink.getOrElse(List.empty))(l =>
            layerToLinkService.validateLayerToLink(l, user)
          ) ?~> Msg.Dataset.Upload.invalidLinkedLayers
          _ <- Fox.runIf(request.body.requireUniqueName.getOrElse(false))(
            datasetService.checkNameAvailable(organization._id, request.body.datasetName)
          )
          preliminaryDataSource = UnusableDataSource(DataSourceId("", ""), None, DataSourceStatus.notYetUploaded)
          dataset <- datasetService.createAndSetUpDataset(
            uploadInfo.datasetName,
            dataStore,
            preliminaryDataSource,
            uploadInfo.folderId,
            user,
            isVirtual = uploadInfo.isVirtual.getOrElse(true),
            creationType = DatasetCreationType.Upload,
            importURLOpt = None
          ) ?~> Msg.Dataset.Upload.createFailed
          _ <- datasetService.addInitialTeams(dataset, uploadInfo.initialTeamIds, user)(using
            AuthorizedAccessContext(user)
          )
          additionalInfo = DatasetUploadAdditionalInfo(dataset._id, dataset.directoryName)
        } yield Ok(Json.toJson(additionalInfo))
      }
    }

  def reserveMagUpload(name: String, key: String, token: String): Action[MagUploadInfo] =
    Action.fox(validateJson[MagUploadInfo]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        // DS write access was asserted already at this point.
        for {
          user <- bearerTokenService.userForToken(token)
          dataset <- datasetDAO.findOne(request.body.datasetId)(using AuthorizedAccessContext(user))
          _ <- Fox.fromBool(dataset.isVirtual) ?~> Msg.Dataset.Upload.reserveMagUploadNotVirtual
          (dataSource, dataLayer) <- datasetService.getDataSourceAndLayerFor(dataset, request.body.layerName)
          _ <- Fox.fromBool(
            !dataLayer.mags.exists(_.mag.maxDim == request.body.mag.mag.maxDim)
          ) ?~> s"New mag ${request.body.mag.mag} conflicts with existing mag of the layer."
          _ <- Fox.fromBool(
            dataset._dataStore == dataStore.name
          ) ?~> "Cannot upload mag to existing dataset via different datastore."
          _ <- uploadToPathsService.handleExistingPendingMag(
            dataset,
            request.body.layerName,
            request.body.mag.mag,
            request.body.overwritePending
          )
          _ <- datasetMagDAO.insertWithUploadPending(
            request.body.datasetId,
            request.body.layerName,
            request.body.mag.mag,
            request.body.mag.axisOrder,
            request.body.mag.channelIndex
          )
        } yield Ok(Json.toJson(MagUploadAdditionalInfo(dataSource.id)))
      }
    }

  def reserveAttachmentUpload(name: String, key: String, token: String): Action[AttachmentUploadInfo] =
    Action.fox(validateJson[AttachmentUploadInfo]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        // DS write access was asserted already at this point.
        for {
          user <- bearerTokenService.userForToken(token)
          dataset <- datasetDAO.findOne(request.body.datasetId)(using AuthorizedAccessContext(user))
          _ <- Fox.fromBool(dataset.isVirtual) ?~> Msg.Dataset.Upload.reserveAttachmentUploadNotVirtual
          (dataSource, dataLayer) <- datasetService.getDataSourceAndLayerFor(dataset, request.body.layerName)
          isSingletonAttachment = LayerAttachmentType.isSingletonAttachment(request.body.attachmentType)
          existsError =
            if (isSingletonAttachment) Msg.Dataset.Layer.attachmentSingletonAlreadyFilled
            else Msg.Dataset.Layer.attachmentNameTaken
          existingAttachmentOpt = dataLayer.attachments.flatMap(
            _.getByTypeAndNameAlwaysReturnSingletons(request.body.attachmentType, request.body.attachment.name)
          )
          _ <- Fox.fromBool(existingAttachmentOpt.isEmpty) ?~> existsError
          _ <- Fox.fromBool(
            dataset._dataStore == dataStore.name
          ) ?~> "Cannot upload attachment to existing dataset via different datastore."
          dummyAttachmentPath <- UPath.fromString("<pending upload>").toFox
          _ <- uploadToPathsService.handleExistingPendingAttachment(
            dataset,
            request.body.layerName,
            request.body.attachmentType,
            request.body.attachment.name,
            request.body.overwritePending
          )
          _ <- datasetAttachmentDAO.insertWithUploadPending(
            request.body.datasetId,
            request.body.layerName,
            request.body.attachment.name,
            request.body.attachmentType,
            request.body.attachment.dataFormat,
            dummyAttachmentPath
          )
        } yield Ok(Json.toJson(AttachmentUploadAdditionalInfo(dataSource.id)))
      }
    }

  def getUnfinishedDatasetUploadsForUser(
      name: String,
      key: String,
      token: String,
      organizationId: String
  ): Action[AnyContent] =
    Action.fox { _ =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          user <- bearerTokenService.userForToken(token) ~> FORBIDDEN
          organization <- organizationDAO.findOne(organizationId)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(organizationId) ~> NOT_FOUND
          _ <- Fox.fromBool(organization._id == user._organization) ?~> Msg.notAllowed ~> FORBIDDEN
          datasets <- datasetService.getAllUnfinishedDatasetUploadsOfUser(user._id, user._organization)(using
            GlobalAccessContext
          ) ?~> Msg.Dataset.Upload.couldNotLoadUnfinishedUploads
          teamIdsPerDataset <- Fox.combined(datasets.map(dataset => teamDAO.findAllowedTeamIdsForDataset(dataset.id)))
          unfinishedUploads = datasets.zip(teamIdsPerDataset).map { case (d, teamIds) =>
            UnfinishedUpload(
              "<filled-in by datastore>",
              d.dataSourceId,
              d.name,
              d.folderId.toString,
              d.created,
              None, // Filled by datastore.
              teamIds.map(_.toString)
            )
          }
        } yield Ok(Json.toJson(unfinishedUploads))
      }
    }

  def reportDatasetUpload(
      name: String,
      key: String,
      token: String,
      datasetId: ObjectId
  ): Action[ReportDatasetUploadParameters] =
    Action.fox(validateJson[ReportDatasetUploadParameters]) { implicit request =>
      implicit val ctx: DBAccessContext = GlobalAccessContext
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          user <- bearerTokenService.userForToken(token) ~> FORBIDDEN
          dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          _ = datasetService.trackNewDataset(
            dataset,
            user,
            request.body.needsConversion,
            request.body.datasetSizeBytes,
            addVariantLabel = "upload without conversion"
          )
          dataSourceWithLinkedLayersOpt <- Fox.runOptional(request.body.dataSourceOpt) {
            implicit val ctx: DBAccessContext = AuthorizedAccessContext(user)
            layerToLinkService.addLayersToLinkToDataSource(_, request.body.layersToLink)
          }
          _ <- Fox.runOptional(dataSourceWithLinkedLayersOpt) { dataSource =>
            logger.info(s"Updating dataset $datasetId in database after upload reported from datastore $name.")
            datasetDAO.updateDataSource(
              datasetId,
              dataset._dataStore,
              dataSource.hashCode(),
              dataSource,
              isUsable = true
            )
          }
          updated <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
          _ <- Fox.runIf(!request.body.needsConversion)(usedStorageService.refreshStorageReportForDataset(updated))
          _ <- Fox.runIf(!request.body.needsConversion)(datasetService.scanRealpathsIfVirtual(updated))
          _ <- Fox.runIf(!request.body.needsConversion)(
            datasetService.writeMirrorForVirtual(updated)(using GlobalAccessContext)
          )
          _ <- Fox.runIf(request.body.needsConversion) {
            for {
              voxelSize <- request.body.voxelSize.toFox ?~> Msg.Dataset.Upload.needsConversionMissingVoxelSize
              dataStoreClient <- datasetService.clientFor(dataset)(using GlobalAccessContext)
              organizationBaseDirectory <- dataStoreClient.getOrganizationBaseDirectory(
                dataset._organization,
                requireAllowsUpload = true,
                requireLocal = true
              )
              _ <- jobService.submitConvertToWkwJob(updated, user, voxelSize, organizationBaseDirectory)
            } yield ()
          }
        } yield Ok
      }
    }

  def reportMagUpload(name: String, key: String): Action[ReportMagUploadParameters] =
    Action.fox(validateJson[ReportMagUploadParameters]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(request.body.datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(
            request.body.datasetId
          ) ~> NOT_FOUND
          _ <- datasetMagDAO.findOneWithPendingUpload(
            request.body.datasetId,
            request.body.layerName,
            request.body.mag.mag
          ) ?~> Msg.Dataset.Upload.magNotPending
          _ <- request.body.mag.path.toFox ?~> Msg.Dataset.Upload.magPathNotSet
          _ <- datasetMagDAO.finishUpload(request.body.datasetId, request.body.layerName, request.body.mag)
          dataStoreClient <- datasetService.clientFor(dataset)(using GlobalAccessContext)
          _ <- dataStoreClient.invalidateDatasetInDSCache(dataset._id)
          _ <- usedStorageService.refreshStorageReportForDataset(dataset)
        } yield Ok
      }
    }

  def reportAttachmentUpload(name: String, key: String): Action[ReportAttachmentUploadParameters] =
    Action.fox(validateJson[ReportAttachmentUploadParameters]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(request.body.datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(
            request.body.datasetId
          ) ~> NOT_FOUND
          _ <- datasetAttachmentDAO.findOneWithPendingUpload(
            request.body.datasetId,
            request.body.layerName,
            request.body.attachmentType,
            request.body.attachment.name
          ) ?~> Msg.Dataset.Upload.attachmentNotPending
          _ <- datasetAttachmentDAO.finishUpload(
            request.body.datasetId,
            request.body.layerName,
            request.body.attachmentType,
            request.body.attachment
          )
          dataStoreClient <- datasetService.clientFor(dataset)(using GlobalAccessContext)
          _ <- dataStoreClient.invalidateDatasetInDSCache(dataset._id)
          _ <- usedStorageService.refreshStorageReportForDataset(dataset)
        } yield Ok
      }
    }

  def statusUpdate(name: String, key: String): Action[DataStoreStatus] = Action.fox(validateJson[DataStoreStatus]) {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        val okLabel = if (request.body.ok) "ok" else "not ok"
        logger.info(s"Status update from data store ‘$name’. Status $okLabel")
        for {
          _ <- dataStoreDAO.updateUrlByName(name, request.body.url)
        } yield Ok
      }
  }

  def updateAll(name: String, key: String, organizationId: Option[String]): Action[List[DataSourceWithRootPathInfo]] =
    Action.fox(validateJson[List[DataSourceWithRootPathInfo]]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        val dataSourcesWithPathInfo = request.body
        for {
          before <- Instant.nowFox
          selectedOrgaLabel = organizationId.map(id => s"for organization $id").getOrElse("for all organizations")
          _ = logger.info(
            s"Received dataset list from datastore ${dataStore.name} $selectedOrgaLabel: " +
              s"${dataSourcesWithPathInfo.count(_.dataSource.isUsable)} active, ${dataSourcesWithPathInfo.count(!_.dataSource.isUsable)} inactive"
          )
          existingIds <- datasetService.updateDataSources(dataStore, dataSourcesWithPathInfo)
          _ <- datasetService.deactivateUnreportedDataSources(existingIds, dataStore, organizationId)
          _ = if (Instant.since(before) > (30 seconds))
            Instant.logSince(
              before,
              s"Updating datasources from datastore ${dataStore.name} $selectedOrgaLabel",
              logger
            )
        } yield Ok
      }
    }

  def updateOne(name: String, key: String): Action[DataSource] =
    Action.fox(validateJson[DataSource]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          // Note that root path info None will not overwrite a set value in the db.
          _ <- datasetService.updateDataSources(dataStore, List(DataSourceWithRootPathInfo(request.body, None, None)))
        } yield Ok
      }
    }

  def updateRealPaths(name: String, key: String): Action[List[DataSourcePathInfo]] =
    Action.fox(validateJson[List[DataSourcePathInfo]]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          _ <- datasetService.updateRealPaths(request.body)(using GlobalAccessContext)
        } yield Ok
      }
    }

  /** Called by the datastore after a dataset has been deleted on disk.
    */
  def deleteDataset(name: String, key: String): Action[ObjectId] = Action.fox(validateJson[ObjectId]) {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          _ <- datasetService.deleteDatasetFromDB(request.body)
        } yield Ok
      }
  }

  def findDatasetId(
      name: String,
      key: String,
      datasetDirectoryName: String,
      organizationId: String
  ): Action[AnyContent] =
    Action.fox { _ =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          organization <- organizationDAO.findOne(organizationId)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(organizationId) ~> NOT_FOUND
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetDirectoryName, organization._id)(using
            GlobalAccessContext
          ) ?~> Msg.Dataset.notFound(datasetDirectoryName)
        } yield Ok(Json.toJson(dataset._id))
      }
    }

  def findDatasetLocalRootPath(name: String, key: String, datasetId: ObjectId): Action[AnyContent] =
    Action.fox { _ =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        for {
          dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(datasetId)
          _ <- Fox.fromBool(dataset._dataStore == dataStore.name) ?~> Msg.notAllowed ~> FORBIDDEN
          localRootPathOpt = dataset.rootPath.filter(UPath.fromString(_).map(_.isLocal).getOrElse(false))
        } yield Ok(Json.toJson(localRootPathOpt.getOrElse(""))) // Empty string means no local rootpath
      }
    }

  def getDataSource(name: String, key: String, datasetId: ObjectId): Action[AnyContent] =
    Action.fox { _ =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(
            datasetId
          ) ~> NOT_FOUND
          dataSource <- datasetService.dataSourceFor(dataset)
        } yield Ok(Json.toJson(dataSource))
      }
    }

  def updateDataSource(name: String, key: String, datasetId: ObjectId): Action[DataSource] =
    Action.fox(validateJson[DataSource]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(datasetId)(using GlobalAccessContext) ?~> Msg.Dataset.notFound(
            datasetId
          ) ~> NOT_FOUND
          _ <- Fox.runIf(!dataset.isVirtual)(
            datasetDAO.updateDataSource(
              datasetId,
              name,
              request.body.hashCode(),
              request.body,
              isUsable = request.body.toUsable.isDefined
            )(using GlobalAccessContext)
          )
        } yield Ok
      }
    }

  def jobExportProperties(name: String, key: String, jobId: ObjectId): Action[AnyContent] = Action.fox { _ =>
    dataStoreService.validateAccess(name, key) { _ =>
      for {
        job <- jobDAO.findOne(jobId)(using GlobalAccessContext)
        jobOwner <- userDAO.findOne(job._owner)(using GlobalAccessContext)
        organization <- organizationDAO.findOne(jobOwner._organization)(using GlobalAccessContext)
        latestRunId <- job.latestRunId.toFox ?~> Msg.Job.notRun
        exportFileName <- job.exportFileName.toFox ?~> Msg.Job.noExportFileName
        jobExportProperties = JobExportProperties(jobId.toString, latestRunId, organization._id, exportFileName)
      } yield Ok(Json.toJson(jobExportProperties))
    }
  }

  def findCredential(name: String, key: String, credentialId: ObjectId): Action[AnyContent] = Action.fox { _ =>
    dataStoreService.validateAccess(name, key) { _ =>
      for {
        credential <- credentialDAO.findOne(credentialId)
      } yield Ok(Json.toJson(credential))
    }
  }

}
