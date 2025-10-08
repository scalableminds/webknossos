package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, Full}
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.{LayerMagLinkInfo, MagLinkInfo}
import com.scalableminds.webknossos.datastore.models.UnfinishedUpload
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataSource,
  DataSourceId,
  DataSourceStatus,
  UnusableDataSource
}
import com.scalableminds.webknossos.datastore.services.{DataSourcePathInfo, DataStoreStatus}
import com.scalableminds.webknossos.datastore.services.uploading.{
  ReportDatasetUploadParameters,
  ReserveAdditionalInformation,
  ReserveUploadInformation
}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.dataset._
import models.dataset.credential.CredentialDAO
import models.job.JobDAO
import models.organization.OrganizationDAO
import models.storage.UsedStorageService
import models.team.TeamDAO
import models.user.UserDAO
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}

import scala.concurrent.duration.DurationInt
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class WKRemoteDataStoreController @Inject()(
    datasetService: DatasetService,
    dataStoreService: DataStoreService,
    dataStoreDAO: DataStoreDAO,
    organizationDAO: OrganizationDAO,
    usedStorageService: UsedStorageService,
    layerToLinkService: LayerToLinkService,
    datasetDAO: DatasetDAO,
    datasetLayerDAO: DatasetLayerDAO,
    userDAO: UserDAO,
    teamDAO: TeamDAO,
    jobDAO: JobDAO,
    credentialDAO: CredentialDAO,
    annotationDAO: AnnotationDAO,
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
          _ <- Fox.serialCombined(uploadInfo.layersToLink.getOrElse(List.empty))(l =>
            layerToLinkService.validateLayerToLink(l, user)) ?~> "dataset.upload.invalidLinkedLayers"
          _ <- Fox.runIf(request.body.requireUniqueName.getOrElse(false))(
            datasetService.assertNewDatasetNameUnique(request.body.name, organization._id))
          preliminaryDataSource = UnusableDataSource(DataSourceId("", ""), None, DataSourceStatus.notYetUploaded)
          dataset <- datasetService.createAndSetUpDataset(
            uploadInfo.name,
            dataStore,
            preliminaryDataSource,
            uploadInfo.folderId,
            user,
            // For the moment, the convert_to_wkw job can only fill the dataset if it is not virtual.
            isVirtual = !uploadInfo.needsConversion.getOrElse(false)
          ) ?~> "dataset.upload.creation.failed"
          _ <- datasetService.addInitialTeams(dataset, uploadInfo.initialTeams, user)(AuthorizedAccessContext(user))
          additionalInfo = ReserveAdditionalInformation(dataset._id, dataset.directoryName)
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

  def reportDatasetUpload(name: String,
                          key: String,
                          token: String,
                          datasetId: ObjectId): Action[ReportDatasetUploadParameters] =
    Action.async(validateJson[ReportDatasetUploadParameters]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          user <- bearerTokenService.userForToken(token)
          dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> Messages("dataset.notFound", datasetId) ~> NOT_FOUND
          _ <- Fox.runIf(!request.body.needsConversion)(usedStorageService.refreshStorageReportForDataset(dataset))
          _ = datasetService.trackNewDataset(dataset,
                                             user,
                                             request.body.needsConversion,
                                             request.body.datasetSizeBytes,
                                             viaAddRoute = false)
          dataSourceWithLinkedLayersOpt <- Fox.runOptional(request.body.dataSourceOpt) {
            implicit val ctx: DBAccessContext = AuthorizedAccessContext(user)
            layerToLinkService.addLayersToLinkToDataSource(_, request.body.layersToLink)
          }
          _ <- Fox.runOptional(dataSourceWithLinkedLayersOpt) { dataSource =>
            logger.info(s"Updating dataset $datasetId in database after upload reported from datastore $name.")
            datasetDAO.updateDataSource(datasetId,
                                        dataset._dataStore,
                                        dataSource.hashCode(),
                                        dataSource,
                                        isUsable = true)(GlobalAccessContext)
          }
        } yield Ok
      }
    }

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

  def updateAll(name: String, key: String, organizationId: Option[String]): Action[List[DataSource]] =
    Action.async(validateJson[List[DataSource]]) { implicit request =>
      dataStoreService.validateAccess(name, key) { dataStore =>
        val dataSources = request.body
        for {
          before <- Instant.nowFox
          selectedOrgaLabel = organizationId.map(id => s"for organization $id").getOrElse("for all organizations")
          _ = logger.info(
            s"Received dataset list from datastore ${dataStore.name} $selectedOrgaLabel: " +
              s"${dataSources.count(_.isUsable)} active, ${dataSources.count(!_.isUsable)} inactive")
          existingIds <- datasetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
          _ <- datasetService.deactivateUnreportedDataSources(existingIds, dataStore, organizationId)
          _ = if (Instant.since(before) > (30 seconds))
            Instant.logSince(before,
                             s"Updating datasources from datastore ${dataStore.name} $selectedOrgaLabel",
                             logger)
        } yield Ok
      }
    }

  def updateOne(name: String, key: String): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
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

  /**
    * Called by the datastore after a dataset has been deleted on disk.
    */
  def deleteDataset(name: String, key: String): Action[ObjectId] = Action.async(validateJson[ObjectId]) {
    implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          existingDatasetBox <- datasetDAO.findOne(request.body)(GlobalAccessContext).shiftBox
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

  def findDatasetId(name: String,
                    key: String,
                    datasetDirectoryName: String,
                    organizationId: String): Action[AnyContent] =
    Action.async { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          organization <- organizationDAO.findOne(organizationId)(GlobalAccessContext) ?~> Messages(
            "organization.notFound",
            organizationId) ~> NOT_FOUND
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetDirectoryName, organization._id)(
            GlobalAccessContext) ?~> Messages("dataset.notFound", datasetDirectoryName)
        } yield Ok(Json.toJson(dataset._id))
      }
    }

  def getPaths(name: String, key: String, datasetId: ObjectId): Action[AnyContent] =
    Action.async { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ~> NOT_FOUND
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
          dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> "dataset.notFound" ~> NOT_FOUND
          dataSource <- datasetService.dataSourceFor(dataset)
        } yield Ok(Json.toJson(dataSource))
      }
    }

  def updateDataSource(name: String, key: String, datasetId: ObjectId): Action[DataSource] =
    Action.async(validateJson[DataSource]) { implicit request =>
      dataStoreService.validateAccess(name, key) { _ =>
        for {
          dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ~> NOT_FOUND
          _ <- Fox.runIf(!dataset.isVirtual)(
            datasetDAO.updateDataSource(datasetId,
                                        name,
                                        request.body.hashCode(),
                                        request.body,
                                        isUsable = request.body.toUsable.isDefined)(GlobalAccessContext))
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
