package models.dataset

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Empty, EmptyBox, Fox, FoxImplicits, Full, JsonHelper, TextUtils}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataSource,
  DataSourceId,
  DataSourceStatus,
  StaticColorLayer,
  StaticLayer,
  StaticSegmentationLayer,
  UnusableDataSource,
  UsableDataSource
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.DataSourcePathInfo
import com.typesafe.scalalogging.LazyLogging
import models.folder.FolderDAO
import models.organization.{Organization, OrganizationDAO}
import models.team._
import models.user.{MultiUserDAO, User, UserService}
import com.scalableminds.webknossos.datastore.controllers.PathValidationResult
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, UploadDatasetEvent}
import models.annotation.AnnotationDAO
import models.job.JobDAO
import models.storage.UsedStorageService
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import security.RandomIDGenerator
import telemetry.SlackNotificationService
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.duration._
import scala.concurrent.ExecutionContext

class DatasetService @Inject()(organizationDAO: OrganizationDAO,
                               datasetDAO: DatasetDAO,
                               dataStoreDAO: DataStoreDAO,
                               datasetLastUsedTimesDAO: DatasetLastUsedTimesDAO,
                               datasetDataLayerDAO: DatasetLayerDAO,
                               datasetMagsDAO: DatasetMagsDAO,
                               datasetLayerAttachmentsDAO: DatasetLayerAttachmentsDAO,
                               teamDAO: TeamDAO,
                               folderDAO: FolderDAO,
                               multiUserDAO: MultiUserDAO,
                               mailchimpClient: MailchimpClient,
                               analyticsService: AnalyticsService,
                               slackNotificationService: SlackNotificationService,
                               dataStoreService: DataStoreService,
                               teamService: TeamService,
                               thumbnailCachingService: ThumbnailCachingService,
                               userService: UserService,
                               jobDAO: JobDAO,
                               annotationDAO: AnnotationDAO,
                               usedStorageService: UsedStorageService,
                               conf: WkConf,
                               rpc: RPC)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def assertValidDatasetName(name: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(name.matches("[A-Za-z0-9_\\-\\.]*")) ?~> "dataset.name.invalid.characters"
      _ <- Fox.fromBool(!name.startsWith(".")) ?~> "dataset.name.invalid.startsWithDot"
      _ <- Fox.fromBool(name.length >= 3) ?~> "dataset.name.invalid.lessThanThreeCharacters"
    } yield ()

  // Less strict variant than what we want for https://github.com/scalableminds/webknossos/issues/7711
  // since some existing layer names don’t fulfill the new strict criteria
  // but we don’t want to disable features for those now
  def assertValidLayerNameLax(name: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!name.contains("/")) ?~> "dataset.layer.name.invalid.characters"
      _ <- Fox.fromBool(!name.startsWith(".")) ?~> "dataset.layer.name.invalid.startsWithDot"
    } yield ()

  def assertNewDatasetNameUnique(name: String, organizationId: String): Fox[Unit] =
    for {
      exists <- datasetDAO.doesDatasetNameExistInOrganization(name, organizationId)
      _ <- Fox.fromBool(!exists) ?~> "dataset.name.taken"
    } yield ()

  def checkNameAvailable(organizationId: String, datasetName: String): Fox[Unit] =
    for {
      isDatasetNameAlreadyTaken <- datasetDAO.doesDatasetNameExistInOrganization(datasetName, organizationId)
      _ <- Fox.fromBool(!isDatasetNameAlreadyTaken) ?~> "dataset.name.alreadyTaken"
    } yield ()

  def getAllUnfinishedDatasetUploadsOfUser(userId: ObjectId, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[List[DatasetCompactInfo]] =
    datasetDAO.findAllCompactWithSearch(
      uploaderIdOpt = Some(userId),
      organizationIdOpt = Some(organizationId),
      isActiveOpt = Some(false),
      includeSubfolders = true,
      statusOpt = Some(DataSourceStatus.notYetUploaded),
      // Only list pending uploads since the two last weeks.
      createdSinceOpt = Some(Instant.now - (14 days)),
      requestingUserOrga = Some(organizationId)
    ) ?~> "dataset.list.fetchFailed"

  def createAndSetUpDataset(datasetName: String,
                            dataStore: DataStore,
                            dataSource: DataSource,
                            folderId: Option[ObjectId],
                            user: User,
                            isVirtual: Boolean): Fox[Dataset] =
    for {
      _ <- assertValidDatasetName(datasetName)
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext) ?~> "organization.notFound"
      folderIdWithFallback = folderId.getOrElse(organization._rootFolder)
      _ <- folderDAO.assertUpdateAccess(folderIdWithFallback)(AuthorizedAccessContext(user)) ?~> "folder.noWriteAccess"
      newDatasetId = ObjectId.generate
      directoryName = generateDirectoryName(datasetName, newDatasetId)
      dataset <- createDataset(dataStore,
                               newDatasetId,
                               datasetName,
                               dataSource.withUpdatedId(DataSourceId(directoryName, organization._id)),
                               isVirtual = isVirtual)
      datasetId = dataset._id
      _ <- datasetDAO.updateFolder(datasetId, folderIdWithFallback)(GlobalAccessContext)
      _ <- addUploader(dataset, user._id)(GlobalAccessContext)
    } yield dataset

  def createDataset(
      dataStore: DataStore,
      datasetId: ObjectId,
      datasetName: String,
      dataSource: DataSource,
      publication: Option[ObjectId] = None,
      isVirtual: Boolean = false
  ): Fox[Dataset] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    val metadata =
      if (publication.isDefined)
        Json.arr(
          Json.obj("type" -> "string", "key" -> "species", "value" -> "species name"),
          Json.obj("type" -> "string", "key" -> "brainRegion", "value" -> "brain region"),
          Json.obj("type" -> "string", "key" -> "acquisition", "value" -> "acquisition method")
        )
      else Json.arr()

    val dataSourceHash = if (dataSource.isUsable) Some(dataSource.hashCode()) else None
    for {
      organization <- organizationDAO.findOne(dataSource.id.organizationId) ?~> "organization.notFound"
      organizationRootFolder <- folderDAO.findOne(organization._rootFolder)
      dataset = Dataset(
        datasetId,
        dataStore.name,
        organization._id,
        publication,
        None,
        organizationRootFolder._id,
        dataSourceHash,
        dataSource.defaultViewConfiguration,
        adminViewConfiguration = None,
        description = None,
        directoryName = dataSource.id.directoryName,
        isPublic = false,
        isUsable = dataSource.isUsable,
        isVirtual = isVirtual,
        name = datasetName,
        voxelSize = dataSource.voxelSizeOpt,
        sharingToken = None,
        status = dataSource.statusOpt.getOrElse(""),
        logoUrl = None,
        metadata = metadata
      )
      _ <- datasetDAO.insertOne(dataset)
      _ <- datasetDataLayerDAO.updateLayers(datasetId, dataSource)
      _ <- teamDAO.updateAllowedTeamsForDataset(datasetId, List())
    } yield dataset
  }

  def updateDataSources(dataStore: DataStore, dataSources: List[DataSource])(
      implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {

    val groupedByOrga = dataSources.groupBy(_.id.organizationId).toList
    Fox
      .serialCombined(groupedByOrga) { orgaTuple: (String, List[DataSource]) =>
        organizationDAO.findOne(orgaTuple._1).shiftBox.flatMap {
          case Full(organization) if dataStore.onlyAllowedOrganization.exists(_ != organization._id) =>
            logger.info(
              s"Ignoring ${orgaTuple._2.length} reported datasets for forbidden organization ${orgaTuple._1} from organization-specific datastore ${dataStore.name}")
            Fox.successful(List.empty)
          case Full(organization) =>
            for {
              foundDatasets <- datasetDAO.findAllByDirectoryNamesAndOrganization(orgaTuple._2.map(_.id.directoryName),
                                                                                 organization._id)
              foundDatasetsByDirectoryName = foundDatasets.groupBy(_.directoryName)
              existingIds <- Fox.serialCombined(orgaTuple._2)(dataSource =>
                updateDataSourceFromDataStore(dataStore, dataSource, foundDatasetsByDirectoryName))
            } yield existingIds.flatten
          case _ =>
            logger.info(
              s"Ignoring ${orgaTuple._2.length} reported datasets for non-existing organization ${orgaTuple._1}")
            Fox.successful(List.empty)
        }
      }
      .map(_.flatten)
  }

  private def updateDataSourceFromDataStore(
      dataStore: DataStore,
      dataSource: DataSource,
      foundDatasetsByDirectoryName: Map[String, List[Dataset]]
  )(implicit ctx: DBAccessContext): Fox[Option[ObjectId]] = {
    val foundDatasetOpt = foundDatasetsByDirectoryName.get(dataSource.id.directoryName).flatMap(_.headOption)
    val isVirtual = foundDatasetOpt.exists(_.isVirtual)
    if (isVirtual) { // Virtual datasets should not be updated from the datastore, as we do not expect them to exist as data source properties on the datastore.
      Fox.successful(foundDatasetOpt.map(_._id))
    } else {
      foundDatasetOpt match {
        case Some(foundDataset) if foundDataset._dataStore == dataStore.name =>
          updateKnownDataSource(foundDataset, dataSource, dataStore).map(Some(_))
        case Some(foundDataset) => // This only returns None for Datasets that are present on a normal Datastore but also got reported from a scratch Datastore
          updateDataSourceDifferentDataStore(foundDataset, dataSource, dataStore)
        case _ =>
          createDataset(dataStore, ObjectId.generate, dataSource.id.directoryName, dataSource).map(ds => Some(ds._id))
      }
    }
  }

  private def updateKnownDataSource(foundDataset: Dataset, dataSource: DataSource, dataStore: DataStore)(
      implicit ctx: DBAccessContext): Fox[ObjectId] =
    if (foundDataset.inboxSourceHash.contains(dataSource.hashCode))
      Fox.successful(foundDataset._id)
    else
      for {
        _ <- thumbnailCachingService.removeFromCache(foundDataset._id)
        _ <- datasetDAO.updateDataSource(foundDataset._id,
                                         dataStore.name,
                                         dataSource.hashCode,
                                         dataSource,
                                         dataSource.isUsable)
        _ <- notifyDatastoreOnUpdate(foundDataset._id)
      } yield foundDataset._id

  private def updateDataSourceDifferentDataStore(foundDataset: Dataset, dataSource: DataSource, dataStore: DataStore)(
      implicit ctx: DBAccessContext): Fox[Option[ObjectId]] =
    // The dataset is already present (belonging to the same organization), but reported from a different datastore
    (for {
      originalDataStore <- dataStoreDAO.findOneByName(foundDataset._dataStore)
    } yield {
      if (originalDataStore.isScratch && !dataStore.isScratch || isUnreported(foundDataset)) {
        logger.info(
          s"Replacing dataset ${foundDataset.name} (with id ${foundDataset._id} and status: ${foundDataset.status}) from datastore ${originalDataStore.name} by the one from ${dataStore.name}"
        )
        for {
          _ <- thumbnailCachingService.removeFromCache(foundDataset._id)
          _ <- datasetDAO.updateDataSource(foundDataset._id,
                                           dataStore.name,
                                           dataSource.hashCode,
                                           dataSource,
                                           dataSource.isUsable)(GlobalAccessContext)
          _ <- notifyDatastoreOnUpdate(foundDataset._id)
        } yield Some(foundDataset._id)
      } else {
        logger.info(
          s"Dataset ${foundDataset.name}, as reported from ${dataStore.name}, is already present as id ${foundDataset._id} from datastore ${originalDataStore.name} and will not be replaced.")
        Fox.successful(None)
      }
    }).flatten

  def updateDataSourceFromUserChanges(dataset: Dataset, dataSourceUpdates: UsableDataSource)(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[Unit] =
    for {
      existingDataSource <- usableDataSourceFor(dataset)
      datasetId = dataset._id
      dataStoreClient <- clientFor(dataset)
      updatedDataSource = applyDataSourceUpdates(existingDataSource, dataSourceUpdates)
      isChanged = updatedDataSource.hashCode() != existingDataSource.hashCode()
      _ <- if (isChanged) {
        logger.info(s"Updating dataSource of $datasetId")
        for {
          _ <- Fox.runIf(!dataset.isVirtual)(dataStoreClient.updateDataSourceOnDisk(datasetId, updatedDataSource))
          _ <- dataStoreClient.invalidateDatasetInDSCache(datasetId)
          _ <- datasetDAO.updateDataSource(datasetId,
                                           dataset._dataStore,
                                           updatedDataSource.hashCode(),
                                           updatedDataSource,
                                           isUsable = true)(GlobalAccessContext)
          datastoreClient <- clientFor(dataset)
          removedPaths = existingDataSource.allExplicitPaths.diff(updatedDataSource.allExplicitPaths)
          pathsUsedOnlyByThisDataset <- if (removedPaths.nonEmpty) findPathsUsedOnlyByThisDataset(datasetId)
          else Fox.successful(List.empty)
          pathsToDelete = removedPaths.intersect(pathsUsedOnlyByThisDataset)
          _ <- datastoreClient.deletePaths(pathsToDelete)
        } yield ()
      } else Fox.successful(logger.info(f"DataSource $datasetId not updated as the hashCode is the same"))
    } yield ()

  private def applyDataSourceUpdates(existingDataSource: UsableDataSource,
                                     updates: UsableDataSource): UsableDataSource = {
    val updatedLayers = existingDataSource.dataLayers.flatMap { existingLayer =>
      val layerUpdatesOpt = updates.dataLayers.find(_.name == existingLayer.name)
      layerUpdatesOpt match {
        case Some(layerUpdates) => Some(applyLayerUpdates(existingLayer, layerUpdates))
        case None               => None
      }
    }
    existingDataSource.copy(
      dataLayers = updatedLayers,
      scale = updates.scale
    )
  }

  private def applyLayerUpdates(existingLayer: StaticLayer, layerUpdates: StaticLayer): StaticLayer =
    /*
  Taken from the new layer are only those properties:
   - category (so Color may become Segmentation and vice versa)
   - boundingBox
   - coordinatesTransformations
   - defaultViewConfiguration
   - adminViewConfiguration
   - largestSegmentId (segmentation only)
     */

    existingLayer match {
      case e: StaticColorLayer =>
        val mags = applyMagUpdates(e.mags, layerUpdates.mags)
        layerUpdates match {
          case u: StaticColorLayer =>
            e.copy(
              boundingBox = u.boundingBox,
              coordinateTransformations = u.coordinateTransformations,
              defaultViewConfiguration = u.defaultViewConfiguration,
              adminViewConfiguration = u.adminViewConfiguration,
              mags = mags
            )
          case u: StaticSegmentationLayer =>
            StaticSegmentationLayer(
              e.name,
              e.dataFormat,
              u.boundingBox,
              e.elementClass,
              mags,
              u.defaultViewConfiguration,
              u.adminViewConfiguration,
              u.coordinateTransformations,
              e.additionalAxes,
              e.attachments,
              u.largestSegmentId,
              None
            )
        }
      case e: StaticSegmentationLayer =>
        val mags = applyMagUpdates(e.mags, layerUpdates.mags)
        layerUpdates match {
          case u: StaticSegmentationLayer =>
            e.copy(
              boundingBox = u.boundingBox,
              coordinateTransformations = u.coordinateTransformations,
              defaultViewConfiguration = u.defaultViewConfiguration,
              adminViewConfiguration = u.adminViewConfiguration,
              largestSegmentId = u.largestSegmentId,
              mags = mags
            )
          case u: StaticColorLayer =>
            StaticColorLayer(
              e.name,
              e.dataFormat,
              u.boundingBox,
              e.elementClass,
              mags,
              u.defaultViewConfiguration,
              u.adminViewConfiguration,
              u.coordinateTransformations,
              e.additionalAxes,
              e.attachments
            )
        }
    }

  private def applyMagUpdates(existingMags: List[MagLocator], magUpdates: List[MagLocator]): List[MagLocator] =
    // In this context removing mags is the only allowed update
    existingMags.filter(existingMag => magUpdates.exists(_.mag == existingMag.mag))

  def deactivateUnreportedDataSources(reportedDatasetIds: List[ObjectId],
                                      dataStore: DataStore,
                                      organizationId: Option[String]): Fox[Unit] =
    datasetDAO.deactivateUnreported(reportedDatasetIds, dataStore.name, organizationId, DataSourceStatus.unreported)

  def getSharingToken(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[String] = {

    def createAndSaveSharingToken(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[String] = {
      val tokenValue = RandomIDGenerator.generateBlocking()
      for {
        _ <- datasetDAO.updateSharingTokenById(datasetId, Some(tokenValue))
      } yield tokenValue
    }

    datasetDAO.getSharingTokenById(datasetId).flatMap {
      case Some(oldToken) => Fox.successful(oldToken)
      case None           => createAndSaveSharingToken(datasetId)
    }
  }

  def usableDataSourceFor(dataset: Dataset)(implicit mp: MessagesProvider): Fox[UsableDataSource] =
    for {
      dataSource <- dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
      usableDataSource <- dataSource.toUsable.toFox ?~> Messages("dataset.notImported", dataSource.id.directoryName)
    } yield usableDataSource

  def dataSourceFor(dataset: Dataset, includeZeroMagLayers: Boolean = false): Fox[DataSource] = {
    val dataSourceId = DataSourceId(dataset.directoryName, dataset._organization)
    if (dataset.isUsable)
      for {
        voxelSize <- dataset.voxelSize.toFox ?~> "dataset.source.usableButNoVoxelSize"
        dataLayers <- datasetDataLayerDAO.findAllForDataset(dataset._id)
        dataLayersFiltered = if (includeZeroMagLayers) dataLayers else dataLayers.filter(_.mags.nonEmpty)
      } yield UsableDataSource(dataSourceId, dataLayersFiltered, voxelSize)
    else
      Fox.successful(UnusableDataSource(dataSourceId, None, dataset.status, dataset.voxelSize))
  }

  private def notifyDatastoreOnUpdate(datasetId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      dataset <- datasetDAO.findOne(datasetId) ?~> "dataset.notFound"
      dataStoreClient <- clientFor(dataset)
      _ <- dataStoreClient.invalidateDatasetInDSCache(dataset._id)
    } yield ()

  private def logoUrlFor(dataset: Dataset, organization: Option[Organization]): Fox[String] =
    dataset.logoUrl match {
      case Some(url) => Fox.successful(url)
      case None =>
        Fox.fillOption(organization)(organizationDAO.findOne(dataset._organization)(GlobalAccessContext)).map(_.logoUrl)
    }

  def dataStoreFor(dataset: Dataset)(implicit ctx: DBAccessContext): Fox[DataStore] =
    dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "datastore.notFound"

  def clientFor(dataset: Dataset)(implicit ctx: DBAccessContext): Fox[WKRemoteDataStoreClient] =
    for {
      dataStore <- dataStoreFor(dataset)
    } yield new WKRemoteDataStoreClient(dataStore, rpc)

  private def lastUsedTimeFor(datasetId: ObjectId, userOpt: Option[User]): Fox[Instant] =
    userOpt match {
      case Some(user) =>
        for {
          lastUsedTime <- datasetLastUsedTimesDAO.findForDatasetAndUser(datasetId, user._id).shiftBox
        } yield lastUsedTime.toOption.getOrElse(Instant.zero)
      case _ => Fox.successful(Instant.zero)
    }

  def allLayersFor(dataset: Dataset): Fox[List[StaticLayer]] =
    for {
      dataSource <- dataSourceFor(dataset)
      datasetLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
    } yield datasetLayers

  def isEditableBy(dataset: Dataset,
                   userOpt: Option[User],
                   userTeamManagerMemberships: Option[List[TeamMembership]] = None): Fox[Boolean] =
    userOpt match {
      case Some(user) =>
        for {
          datasetAllowedTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true)
          teamManagerMemberships <- Fox.fillOption(userTeamManagerMemberships)(
            userService.teamManagerMembershipsFor(user._id))
        } yield
          (user.isAdminOf(dataset._organization)
            || user.isDatasetManager
            || teamManagerMemberships.map(_.teamId).intersect(datasetAllowedTeams).nonEmpty)
      case _ => Fox.successful(false)
    }

  def isUnreported(dataset: Dataset): Boolean = dataset.status == DataSourceStatus.unreported

  def addInitialTeams(dataset: Dataset, teamIds: Seq[ObjectId], user: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      previousDatasetTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = false) ?~> "allowedTeams.notFound"
      _ <- Fox.fromBool(previousDatasetTeams.isEmpty) ?~> "dataset.initialTeams.teamsNotEmpty"
      includeMemberOnlyTeams = user.isDatasetManager
      userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
      _ <- Fox.fromBool(teamIds.forall(teamId => userTeams.map(_._id).contains(teamId))) ?~> "dataset.initialTeams.invalidTeams"
      _ <- datasetDAO.assertUpdateAccess(dataset._id) ?~> "dataset.initialTeams.forbidden"
      _ <- teamDAO.updateAllowedTeamsForDataset(dataset._id, teamIds)
    } yield ()

  def addUploader(dataset: Dataset, _uploader: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(dataset._uploader.isEmpty) ?~> "dataset.uploader.notEmpty"
      _ <- datasetDAO.updateUploader(dataset._id, Some(_uploader)) ?~> "dataset.uploader.forbidden"
    } yield ()

  private def updateRealPathsForDataSource(pathInfo: DataSourcePathInfo)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val datasetBox = datasetDAO.findOneByDataSourceId(pathInfo.dataSourceId).shiftBox
    datasetBox.flatMap {
      case Full(dataset) if !dataset.isVirtual =>
        for {
          _ <- datasetMagsDAO.updateMagRealPathsForDataset(dataset._id, pathInfo.magPathInfos)
          _ <- datasetLayerAttachmentsDAO.updateAttachmentRealPathsForDataset(dataset._id, pathInfo.attachmentPathInfos)
        } yield ()
      case Full(_) => // Dataset is virtual, no updates from datastore are accepted.
        Fox.successful(())
      case Empty => // Dataset reported but ignored (non-existing/forbidden org)
        Fox.successful(())
      case e: EmptyBox =>
        Fox.failure("dataset.notFound", e)
    }
  }

  def updateRealPaths(pathInfos: List[DataSourcePathInfo])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(pathInfos)(updateRealPathsForDataSource)
    } yield ()

  def validatePaths(paths: Seq[UPath], dataStore: DataStore): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      client = new WKRemoteDataStoreClient(dataStore, rpc)
      pathValidationResults <- client.validatePaths(paths)
      _ <- Fox.serialCombined(pathValidationResults)({
        case PathValidationResult(_, true)     => Fox.successful(())
        case PathValidationResult(path, false) => Fox.failure(s"Path validation failed for path: $path")
      })
    } yield ()

  private def findPathsUsedOnlyByThisDataset(datasetId: ObjectId): Fox[Seq[UPath]] =
    for {
      magPathsUsedOnlyByThisDataset <- datasetMagsDAO.findMagPathsUsedOnlyByThisDataset(datasetId)
      attachmentPathsUsedOnlyByThisDataset <- datasetLayerAttachmentsDAO.findAttachmentPathsUsedOnlyByThisDataset(
        datasetId)
    } yield magPathsUsedOnlyByThisDataset ++ attachmentPathsUsedOnlyByThisDataset

  def deleteDataset(dataset: Dataset)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      datastoreClient <- clientFor(dataset)
      _ <- if (dataset.isVirtual) {
        for {
          pathsUsedOnlyByThisDataset <- findPathsUsedOnlyByThisDataset(dataset._id)
          // Note that the datastore only deletes local paths and paths on our managed S3 cloud storage
          _ <- datastoreClient.deletePaths(pathsUsedOnlyByThisDataset)
        } yield ()
      } else {
        for {
          datastoreBaseDirStr <- datastoreClient.getBaseDirAbsolute
          datastoreBaseDir <- UPath.fromString(datastoreBaseDirStr).toFox
          datasetDir = datastoreBaseDir / dataset._organization / dataset.directoryName
          datastore <- dataStoreFor(dataset)
          datasetsUsingDataFromThisDir <- findDatasetsUsingDataFromDir(datasetDir, datastore, dataset._id)
          _ <- Fox.fromBool(datasetsUsingDataFromThisDir.isEmpty) ?~> s"Cannot delete dataset because ${datasetsUsingDataFromThisDir.length} other datasets reference its data: ${datasetsUsingDataFromThisDir
            .mkString(",")}"
          _ <- datastoreClient.deleteOnDisk(dataset._id) ?~> "dataset.delete.failed"
        } yield ()
      }
      _ <- Fox.runIf(
        conf.Features.jobsEnabled && (dataset.status == DataSourceStatus.notYetUploadedToPaths || dataset.status == DataSourceStatus.notYetUploaded)) {
        logger.info(s"Cancelling any pending conversion jobs for dataset ${dataset._id}...")
        jobDAO.cancelConvertToWkwJobForDataset(dataset._id)
      }
      _ <- deleteDatasetFromDB(dataset._id)
    } yield ()

  private def findDatasetsUsingDataFromDir(directory: UPath,
                                           dataStore: DataStore,
                                           ignoredDatasetId: ObjectId): Fox[Seq[ObjectId]] =
    for {
      datasetsWithMagsInDir <- datasetMagsDAO.findDatasetsWithMagsInDir(directory, dataStore, ignoredDatasetId)
      datasetsWithAttachmentsInDir <- datasetLayerAttachmentsDAO.findDatasetsWithAttachmentsInDir(directory,
                                                                                                  dataStore,
                                                                                                  ignoredDatasetId)
    } yield (datasetsWithMagsInDir ++ datasetsWithAttachmentsInDir).distinct

  def deleteDatasetFromDB(datasetId: ObjectId): Fox[Unit] =
    for {
      existingDatasetBox <- datasetDAO.findOne(datasetId)(GlobalAccessContext).shiftBox
      _ <- existingDatasetBox match {
        case Full(dataset) =>
          for {
            annotationCount <- annotationDAO.countAllByDataset(dataset._id)(GlobalAccessContext)
            _ <- datasetDAO.deleteDataset(dataset._id, onlyMarkAsDeleted = annotationCount > 0)
            _ <- usedStorageService.refreshStorageReportForDataset(dataset)
          } yield ()
        case _ => Fox.successful(())
      }
    } yield ()

  def generateDirectoryName(datasetName: String, datasetId: ObjectId): String =
    TextUtils.normalizeStrong(datasetName) match {
      case Some(prefix) => s"$prefix-$datasetId"
      case None         => datasetId.toString
    }

  def trackNewDataset(dataset: Dataset,
                      user: User,
                      needsConversion: Boolean,
                      datasetSizeBytes: Long,
                      addVariantLabel: String): Fox[Unit] =
    for {
      _ <- Fox.runIf(!needsConversion)(logDatasetUploadToSlack(user, dataset._id, addVariantLabel))
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore)(GlobalAccessContext)
      _ = analyticsService.track(UploadDatasetEvent(user, dataset, dataStore, datasetSizeBytes))
      _ = if (!needsConversion) mailchimpClient.tagUser(user, MailchimpTag.HasUploadedOwnDataset)
    } yield ()

  private def logDatasetUploadToSlack(user: User, datasetId: ObjectId, addVariantLabel: String): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(user._organization)(GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(GlobalAccessContext)
      resultLink = s"${conf.Http.uri}/datasets/$datasetId"
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = slackNotificationService.info(s"Dataset added ($addVariantLabel)$superUserLabel",
                                        s"For organization: ${organization.name}. <$resultLink|Result>")
    } yield ()

  def publicWrites(dataset: Dataset,
                   requestingUserOpt: Option[User],
                   organization: Option[Organization] = None,
                   dataStore: Option[DataStore] = None,
                   requestingUserTeamManagerMemberships: Option[List[TeamMembership]] = None,
                   includeZeroMagLayers: Boolean = false)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataset._organization) ?~> "organization.notFound"
      }
      dataStore <- Fox.fillOption(dataStore) {
        dataStoreFor(dataset) ?~> "dataStore.notFound"
      }
      teams <- teamService.allowedTeamsForDataset(dataset, cumulative = false, requestingUserOpt) ?~> "dataset.list.fetchAllowedTeamsFailed"
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, Some(organization))) ?~> "dataset.list.teamWritesFailed"
      teamsCumulative <- teamService.allowedTeamsForDataset(dataset, cumulative = true, requestingUserOpt) ?~> "dataset.list.fetchAllowedTeamsFailed"
      teamsCumulativeJs <- Fox.serialCombined(teamsCumulative)(t => teamService.publicWrites(t, Some(organization))) ?~> "dataset.list.teamWritesFailed"
      logoUrl <- logoUrlFor(dataset, Some(organization)) ?~> "dataset.list.fetchLogoUrlFailed"
      isEditable <- isEditableBy(dataset, requestingUserOpt, requestingUserTeamManagerMemberships) ?~> "dataset.list.isEditableCheckFailed"
      lastUsedByUser <- lastUsedTimeFor(dataset._id, requestingUserOpt) ?~> "dataset.list.fetchLastUsedTimeFailed"
      dataStoreJs <- dataStoreService.publicWrites(dataStore) ?~> "dataset.list.dataStoreWritesFailed"
      dataSource <- dataSourceFor(dataset, includeZeroMagLayers) ?~> "dataset.list.fetchDataSourceFailed"
      usedStorageBytes <- if (requestingUserOpt.exists(u => u._organization == dataset._organization))
        organizationDAO.getUsedStorageForDataset(dataset._id)
      else Fox.successful(0L)
    } yield {
      Json.obj(
        "id" -> dataset._id,
        "name" -> dataset.name,
        "dataSource" -> JsonHelper.removeKeyRecursively(Json.toJson(dataSource), Set("credentialId", "credentials")),
        "dataStore" -> dataStoreJs,
        "owningOrganization" -> organization._id,
        "allowedTeams" -> teamsJs,
        "allowedTeamsCumulative" -> teamsCumulativeJs,
        "isActive" -> dataset.isUsable,
        "isPublic" -> dataset.isPublic,
        "description" -> dataset.description,
        "directoryName" -> dataset.directoryName,
        "created" -> dataset.created,
        "isEditable" -> isEditable,
        "lastUsedByUser" -> lastUsedByUser,
        "logoUrl" -> logoUrl,
        "sortingKey" -> dataset.sortingKey,
        "metadata" -> dataset.metadata,
        "isUnreported" -> Json.toJson(isUnreported(dataset)),
        "tags" -> dataset.tags,
        "folderId" -> dataset._folder,
        "usedStorageBytes" -> usedStorageBytes,
        "isVirtual" -> dataset.isVirtual
      )
    }
}
