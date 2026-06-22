package models.dataset

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Box, Empty, EmptyBox, Fox, FoxImplicits, Full, JsonHelper, TextUtils}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerAttachments, DataSource, DataSourceId, DataSourceStatus, StaticColorLayer, StaticLayer, StaticSegmentationLayer, UnusableDataSource, UsableDataSource}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.services.{DataSourcePathInfo, DataSourceWithRootPathInfo}
import com.typesafe.scalalogging.LazyLogging
import models.folder.FolderDAO
import models.organization.{Organization, OrganizationDAO}
import models.team.*
import models.user.{MultiUserDAO, User, UserService}
import com.scalableminds.webknossos.datastore.controllers.PathValidationResult
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentType.LayerAttachmentType
import controllers.{AttachmentRenaming, LayerRenaming, PathDeletionService}
import mail.{MailchimpClient, MailchimpTag}
import models.analytics.{AnalyticsService, UploadDatasetEvent}
import models.annotation.AnnotationDAO
import models.dataset.DatasetCreationType.DatasetCreationType
import models.job.JobDAO
import models.storage.UsedStorageService
import play.api.http.Status.NOT_FOUND
import play.api.libs.json.{JsArray, JsObject, Json}
import security.RandomIDGenerator
import telemetry.SlackNotificationService
import utils.WkConf

import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.duration.*
import scala.concurrent.ExecutionContext

class DatasetService @Inject()(organizationDAO: OrganizationDAO,
                               datasetDAO: DatasetDAO,
                               dataStoreDAO: DataStoreDAO,
                               datasetLastUsedTimesDAO: DatasetLastUsedTimesDAO,
                               datasetDataLayerDAO: DatasetLayerDAO,
                               datasetMagsDAO: DatasetMagDAO,
                               datasetLayerAttachmentsDAO: DatasetLayerAttachmentDAO,
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
                               pathDeletionService: PathDeletionService,
                               jobDAO: JobDAO,
                               annotationDAO: AnnotationDAO,
                               usedStorageService: UsedStorageService,
                               conf: WkConf,
                               rpc: RPC)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def assertValidDatasetName(name: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(name.matches("[A-Za-z0-9_\\-\\.]*")) ?~> Msg.Dataset.Name.invalidCharacters
      _ <- Fox.fromBool(!name.startsWith(".")) ?~> Msg.Dataset.Name.invalidStartsWithDot
      _ <- Fox.fromBool(name.length >= 3) ?~> Msg.Dataset.Name.invalidLessThanThreeCharacters
    } yield ()

  // Less strict variant than what we want for https://github.com/scalableminds/webknossos/issues/7711
  // since some existing layer names don’t fulfill the new strict criteria
  // but we don’t want to disable features for those now
  def assertValidLayerNameLax(name: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(!name.contains("/")) ?~> Msg.Dataset.Layer.nameInvalidCharacters
      _ <- Fox.fromBool(!name.startsWith(".")) ?~> Msg.Dataset.Layer.nameInvalidStartsWithDot
    } yield ()

  def checkNameAvailable(organizationId: String, datasetName: String): Fox[Unit] =
    for {
      exists <- datasetDAO.doesDatasetNameExistInOrganization(datasetName, organizationId)
      _ <- Fox.fromBool(!exists) ?~> Msg.Dataset.Name.taken(datasetName)
    } yield ()

  def getAllUnfinishedDatasetUploadsOfUser(userId: ObjectId, organizationId: String)(
      using ctx: DBAccessContext): Fox[List[DatasetCompactInfo]] =
    datasetDAO.findAllCompactWithSearch(
      uploaderIdOpt = Some(userId),
      organizationIdOpt = Some(organizationId),
      isActiveOpt = Some(false),
      includeSubfolders = true,
      statusOpt = Some(DataSourceStatus.notYetUploaded),
      // Only list pending uploads since the two last weeks.
      createdSinceOpt = Some(Instant.now - (14 days)),
      requestingUserOrga = Some(organizationId)
    ) ?~> Msg.Dataset.List.fetchFailed

  def createAndSetUpDataset(datasetName: String,
                            dataStore: DataStore,
                            dataSource: DataSource,
                            folderId: Option[ObjectId],
                            user: User,
                            isVirtual: Boolean,
                            creationType: DatasetCreationType,
                            importURLOpt: Option[String]): Fox[Dataset] =
    for {
      _ <- assertValidDatasetName(datasetName)
      organization <- organizationDAO.findOne(user._organization)(using GlobalAccessContext) ?~> Msg.Organization.notFound(
        user._organization)
      folderIdWithFallback = folderId.getOrElse(organization._rootFolder)
      _ <- folderDAO.assertUpdateAccess(folderIdWithFallback)(using AuthorizedAccessContext(user)) ?~> Msg.Folder.noWriteAccess
      newDatasetId = ObjectId.generate
      directoryName = generateDirectoryName(datasetName, newDatasetId)
      dataset <- createDataset(
        dataStore,
        newDatasetId,
        datasetName,
        dataSource.withUpdatedId(DataSourceId(directoryName, organization._id)),
        isVirtual = isVirtual,
        creationType = creationType,
        importURL = importURLOpt
      )
      datasetId = dataset._id
      _ <- datasetDAO.updateFolder(datasetId, folderIdWithFallback)(using GlobalAccessContext)
      _ <- addUploader(dataset, user._id)(using GlobalAccessContext)
    } yield dataset

  def createDataset(
      dataStore: DataStore,
      datasetId: ObjectId,
      datasetName: String,
      dataSource: DataSource,
      isVirtual: Boolean = false,
      metadata: JsArray = JsArray.empty,
      description: Option[String] = None,
      creationType: DatasetCreationType.Value,
      importURL: Option[String] = None,
      rootPath: Option[String] = None,
      rootRealPath: Option[String] = None
  ): Fox[Dataset] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext

    val dataSourceHash = if (dataSource.isUsable) Some(dataSource.hashCode()) else None
    for {
      organization <- organizationDAO.findOne(dataSource.id.organizationId) ?~> Msg.Organization.notFound(
        dataSource.id.organizationId)
      organizationRootFolder <- folderDAO.findOne(organization._rootFolder)
      dataset = Dataset(
        datasetId,
        dataStore.name,
        organization._id,
        None,
        None,
        organizationRootFolder._id,
        dataSourceHash,
        dataSource.defaultViewConfiguration,
        adminViewConfiguration = None,
        description = description,
        directoryName = dataSource.id.directoryName,
        isPublic = false,
        isUsable = dataSource.isUsable,
        isVirtual = isVirtual,
        name = datasetName,
        voxelSize = dataSource.voxelSizeOpt,
        sharingToken = None,
        status = dataSource.statusOpt.getOrElse(""),
        logoUrl = None,
        metadata = metadata,
        creationType = Some(creationType),
        importURL = importURL,
        rootPath = rootPath,
        rootRealPath = rootRealPath,
      )
      _ <- datasetDAO.insertOne(dataset)
      _ <- datasetDataLayerDAO.updateLayers(datasetId, dataSource)
      _ <- teamDAO.updateAllowedTeamsForDataset(datasetId, List())
      _ <- scanRealpathsIfVirtual(dataset)
      _ <- writeMirrorForVirtual(dataset)
    } yield dataset
  }

  def updateDataSources(dataStore: DataStore, dataSourcesWithPathInfo: List[DataSourceWithRootPathInfo])(
      using ctx: DBAccessContext): Fox[List[ObjectId]] = {

    val groupedByOrga = dataSourcesWithPathInfo.groupBy(_.dataSource.id.organizationId).toList
    Fox
      .serialCombined(groupedByOrga) { (orgaTuple: (String, List[DataSourceWithRootPathInfo])) =>
        organizationDAO.findOne(orgaTuple._1).shiftBox.flatMap {
          case Full(organization) if dataStore.onlyAllowedOrganization.exists(_ != organization._id) =>
            logger.info(
              s"Ignoring ${orgaTuple._2.length} reported datasets for forbidden organization ${orgaTuple._1} from organization-specific datastore ${dataStore.name}")
            Fox.successful(List.empty)
          case Full(organization) =>
            for {
              foundDatasets <- datasetDAO.findAllByDirectoryNamesAndOrganization(
                orgaTuple._2.map(_.dataSource.id.directoryName),
                organization._id)
              foundDatasetsByDirectoryName = foundDatasets.groupBy(_.directoryName)
              existingIds <- Fox.serialCombined(orgaTuple._2)(dataSourceWithPathInfo =>
                updateDataSourceFromDataStore(dataStore, dataSourceWithPathInfo, foundDatasetsByDirectoryName))
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
                                             dataSourceWithRootPathInfo: DataSourceWithRootPathInfo,
                                             foundDatasetsByDirectoryName: Map[String, List[Dataset]]
  )(using ctx: DBAccessContext): Fox[Option[ObjectId]] = {
    val dataSource = dataSourceWithRootPathInfo.dataSource
    val rootPath = dataSourceWithRootPathInfo.rootPath
    val rootRealPath = dataSourceWithRootPathInfo.rootRealPath
    val foundDatasetOpt = foundDatasetsByDirectoryName.get(dataSource.id.directoryName).flatMap(_.headOption)
    val isVirtual = foundDatasetOpt.exists(_.isVirtual)
    if (isVirtual) { // Virtual datasets should not be updated from the datastore, as we do not expect them to exist as data source properties on the datastore.
      Fox.successful(foundDatasetOpt.map(_._id))
    } else {
      foundDatasetOpt match {
        case Some(foundDataset) if foundDataset._dataStore == dataStore.name =>
          updateKnownDataSource(foundDataset, dataSource, dataStore, rootPath, rootRealPath).map(Some(_))
        case Some(foundDataset) => // This only returns None for Datasets that are present on a normal Datastore but also got reported from a scratch Datastore
          updateDataSourceDifferentDataStore(foundDataset, dataSource, dataStore, rootPath, rootRealPath)
        case _ =>
          createDataset(
            dataStore,
            ObjectId.generate,
            dataSource.id.directoryName,
            dataSource,
            creationType = DatasetCreationType.DiskScan,
            rootPath = rootPath,
            rootRealPath = rootRealPath
          ).map(ds => Some(ds._id))
      }
    }
  }

  private def updateKnownDataSource(foundDataset: Dataset,
                                    dataSource: DataSource,
                                    dataStore: DataStore,
                                    rootPath: Option[String],
                                    rootRealPath: Option[String])(using ctx: DBAccessContext): Fox[ObjectId] =
    if (foundDataset.inboxSourceHash.contains(dataSource.hashCode) &&
        foundDataset.rootPath == rootPath && foundDataset.rootRealPath == rootRealPath)
      Fox.successful(foundDataset._id)
    else
      for {
        _ <- thumbnailCachingService.removeFromCache(foundDataset._id)
        _ <- datasetDAO.updateDataSource(foundDataset._id,
                                         dataStore.name,
                                         dataSource.hashCode,
                                         dataSource,
                                         dataSource.isUsable,
                                         rootPath,
                                         rootRealPath)
        _ <- notifyDatastoreOnUpdate(foundDataset._id)
      } yield foundDataset._id

  private def updateDataSourceDifferentDataStore(
      foundDataset: Dataset,
      dataSource: DataSource,
      dataStore: DataStore,
      rootPath: Option[String],
      rootRealPath: Option[String])(using ctx: DBAccessContext): Fox[Option[ObjectId]] =
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
                                           dataSource.isUsable,
                                           rootPath,
                                           rootRealPath)(using GlobalAccessContext)
          _ <- notifyDatastoreOnUpdate(foundDataset._id)
        } yield Some(foundDataset._id)
      } else {
        logger.info(
          s"Dataset ${foundDataset.name}, as reported from ${dataStore.name}, is already present as id ${foundDataset._id} from datastore ${originalDataStore.name} and will not be replaced.")
        Fox.successful(None)
      }
    }).flatten

  def updateDataSourceFromUserChanges(
      dataset: Dataset,
      dataSourceUpdates: UsableDataSource,
      layerRenamings: Seq[LayerRenaming],
      attachmentRenamings: Seq[AttachmentRenaming])(using ctx: DBAccessContext): Fox[Unit] =
    for {
      existingDataSource <- usableDataSourceFor(dataset)
      datasetId = dataset._id
      dataStoreClient <- clientFor(dataset)
      updatedDataSource <- applyDataSourceUpdates(existingDataSource,
                                                  dataSourceUpdates,
                                                  layerRenamings,
                                                  attachmentRenamings).toFox
      isChanged = updatedDataSource.hashCode() != existingDataSource.hashCode()
      _ <- if (isChanged) {
        logger.info(s"Updating dataSource of $datasetId")
        for {
          _ <- Fox.runIf(!dataset.isVirtual)(Fox.runOptional(dataset.rootPath)(r => dataStoreClient.updateDataSourceOnDisk(datasetId, updatedDataSource, r)))
          datastoreClient <- clientFor(dataset)
          removedPaths = existingDataSource.allExplicitPaths.diff(updatedDataSource.allExplicitPaths)
          pathsUsedOnlyByThisDataset <- if (removedPaths.nonEmpty) findPathsUsedOnlyByThisDataset(datasetId)
          else Fox.successful(List.empty)
          pathsToDelete = removedPaths.intersect(pathsUsedOnlyByThisDataset)
          _ <- datasetDAO.updateDataSource(datasetId,
                                           dataset._dataStore,
                                           updatedDataSource.hashCode(),
                                           updatedDataSource,
                                           isUsable = true)(using GlobalAccessContext)
          _ <- dataStoreClient.invalidateDatasetInDSCache(datasetId)
          _ <- pathDeletionService.deletePaths(datastoreClient, pathsToDelete)
        } yield ()
      } else Fox.successful(logger.info(f"DataSource $datasetId not updated as the hashCode is the same"))
    } yield ()

  private def applyDataSourceUpdates(existingDataSource: UsableDataSource,
                                     updates: UsableDataSource,
                                     layerRenamings: Seq[LayerRenaming],
                                     attachmentRenamings: Seq[AttachmentRenaming]): Box[UsableDataSource] = {
    val existingDataSourceWithRenamedLayers = applyLayerRenamings(existingDataSource, layerRenamings)
    val existingDataSourceWithRenamedAttachments =
      applyAttachmentRenamings(existingDataSourceWithRenamedLayers, attachmentRenamings)
    for {
      _ <- Box.fromBool(
        existingDataSourceWithRenamedAttachments.dataLayers.length == existingDataSourceWithRenamedAttachments.dataLayers
          .distinctBy(_.name)
          .length) ?~ "Layer renamings create name collisions."
      _ <- Box.fromBool(
        existingDataSourceWithRenamedAttachments.dataLayers.forall(_.attachments.forall(!_.containsDuplicateNames))
      ) ?~ "Attachment renamings create name collisions."
      updatedLayers = existingDataSourceWithRenamedAttachments.dataLayers.flatMap { existingLayer =>
        val layerUpdatesOpt = updates.dataLayers.find(_.name == existingLayer.name)
        layerUpdatesOpt match {
          case Some(layerUpdates) => Some(applyLayerUpdates(existingLayer, layerUpdates))
          case None               => None
        }
      }
      addedLayers <- findNewLayers(existingDataSourceWithRenamedAttachments, updates)
    } yield
      existingDataSource.copy(
        dataLayers = updatedLayers ++ addedLayers,
        scale = updates.scale
      )
  }

  private def findNewLayers(existingDataSoruce: UsableDataSource, updates: UsableDataSource): Box[Seq[StaticLayer]] = {
    val newLayers = updates.dataLayers.filter(layer => !existingDataSoruce.dataLayers.exists(_.name == layer.name))
    val noneHaveMags = newLayers.forall(_.mags.isEmpty)
    val noneHaveAttachments = newLayers.forall(_.attachments.forall(_.isEmpty))
    for {
      _ <- Box.fromBool(noneHaveMags) ?~ "New layers may not have mags. Add empty layers instead and then add mags."
      _ <- Box.fromBool(noneHaveAttachments) ?~ "New layers may not have attachments. Add empty layers instead and then add attachments."
    } yield newLayers
  }

  private def applyLayerRenamings(existingDataSource: UsableDataSource,
                                  layerRenamings: Seq[LayerRenaming]): UsableDataSource =
    if (layerRenamings.isEmpty) existingDataSource
    else {
      val renamingMap: Map[String, String] = layerRenamings.map(renaming => (renaming.oldName, renaming.newName)).toMap
      val layersRenamed = existingDataSource.dataLayers.map { layer =>
        if (renamingMap.contains(layer.name))
          layer.mapped(name = renamingMap(layer.name))
        else layer
      }
      existingDataSource.copy(dataLayers = layersRenamed)
    }

  private def applyAttachmentRenamings(existingDataSource: UsableDataSource,
                                       attachmentRenamings: Seq[AttachmentRenaming]): UsableDataSource =
    if (attachmentRenamings.isEmpty) existingDataSource
    else {
      existingDataSource.copy(
        dataLayers = existingDataSource.dataLayers.map { layer =>
          val renamingMapForLayer: Map[(LayerAttachmentType, String), String] =
            attachmentRenamings
              .filter(_.layerName == layer.name)
              .map(renaming => ((renaming.attachmentType, renaming.oldName), renaming.newName))
              .toMap
          layer.mapped(attachmentMapping = attachments => attachments.renameByMap(renamingMapForLayer))
        }
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
        val attachments = applyAttachmentUpdates(e.attachments, layerUpdates.attachments)
        layerUpdates match {
          case u: StaticColorLayer =>
            e.copy(
              boundingBox = u.boundingBox,
              coordinateTransformations = u.coordinateTransformations,
              defaultViewConfiguration = u.defaultViewConfiguration,
              adminViewConfiguration = u.adminViewConfiguration,
              mags = mags,
              attachments = attachments
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
              attachments,
              u.largestSegmentId,
              None
            )
        }
      case e: StaticSegmentationLayer =>
        val mags = applyMagUpdates(e.mags, layerUpdates.mags)
        val attachments = applyAttachmentUpdates(e.attachments, layerUpdates.attachments)
        layerUpdates match {
          case u: StaticSegmentationLayer =>
            e.copy(
              boundingBox = u.boundingBox,
              coordinateTransformations = u.coordinateTransformations,
              defaultViewConfiguration = u.defaultViewConfiguration,
              adminViewConfiguration = u.adminViewConfiguration,
              largestSegmentId = u.largestSegmentId,
              mags = mags,
              attachments = attachments
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
              attachments
            )
        }
    }

  private def applyMagUpdates(existingMags: Seq[MagLocator], magUpdates: Seq[MagLocator]): Seq[MagLocator] =
    // In this context removing mags is the only allowed update
    existingMags.filter(existingMag => magUpdates.exists(_.mag == existingMag.mag))

  private def applyAttachmentUpdates(existingAttachmentsOpt: Option[DataLayerAttachments],
                                     attachmentUpdatesOpt: Option[DataLayerAttachments]): Option[DataLayerAttachments] =
    (existingAttachmentsOpt, attachmentUpdatesOpt) match {
      case (Some(existingAttachments), Some(attachmentUpdates)) =>
        existingAttachments.dropMissing(attachmentUpdates)
      case _ => None // If existing is empty, none can be added here. If updates is empty, drop all.
    }

  def deactivateUnreportedDataSources(reportedDatasetIds: List[ObjectId],
                                      dataStore: DataStore,
                                      organizationId: Option[String]): Fox[Unit] =
    datasetDAO.deactivateUnreported(reportedDatasetIds, dataStore.name, organizationId, DataSourceStatus.unreported)

  def getSharingToken(datasetId: ObjectId)(using ctx: DBAccessContext): Fox[String] = {

    def createAndSaveSharingToken(datasetId: ObjectId)(using ctx: DBAccessContext): Fox[String] = {
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

  def usableDataSourceFor(dataset: Dataset, useRealPaths: Boolean = true): Fox[UsableDataSource] =
    for {
      dataSource <- dataSourceFor(dataset, useRealPaths) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      usableDataSource <- dataSource.toUsable.toFox ?~> Msg.Dataset.notUsable(dataset._id)
    } yield usableDataSource

  def dataSourceFor(dataset: Dataset, useRealPaths: Boolean = true): Fox[DataSource] = {
    val dataSourceId = DataSourceId(dataset.directoryName, dataset._organization)
    if (dataset.isUsable)
      for {
        voxelSize <- dataset.voxelSize.toFox ?~> Msg.Dataset.DataSource.usableButNoVoxelSize
        dataLayers <- datasetDataLayerDAO.findAllForDataset(dataset._id, useRealPaths)
      } yield UsableDataSource(dataSourceId, dataLayers, voxelSize)
    else
      Fox.successful(UnusableDataSource(dataSourceId, None, dataset.status, dataset.voxelSize))
  }

  def getDataSourceAndLayerFor(dataset: Dataset, layerName: String): Fox[(UsableDataSource, StaticLayer)] =
    for {
      usableDataSource <- usableDataSourceFor(dataset)
      dataLayer <- usableDataSource.getDataLayer(layerName).toFox ?~> Msg.Dataset.Layer.notFound(layerName)
    } yield (usableDataSource, dataLayer)

  private def notifyDatastoreOnUpdate(datasetId: ObjectId)(using ctx: DBAccessContext) =
    for {
      dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId)
      dataStoreClient <- clientFor(dataset)
      _ <- dataStoreClient.invalidateDatasetInDSCache(dataset._id)
    } yield ()

  private def logoUrlFor(dataset: Dataset, organization: Option[Organization]): Fox[String] =
    dataset.logoUrl match {
      case Some(url) => Fox.successful(url)
      case None =>
        Fox.fillOption(organization)(organizationDAO.findOne(dataset._organization)(using GlobalAccessContext)).map(_.logoUrl)
    }

  def dataStoreFor(dataset: Dataset)(using ctx: DBAccessContext): Fox[DataStore] =
    dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> Msg.DataStore.notFound

  def clientFor(dataset: Dataset)(using ctx: DBAccessContext): Fox[WKRemoteDataStoreClient] =
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
          user.isAdminOf(dataset._organization)
            || user.isDatasetManager
            || teamManagerMemberships.map(_.teamId).intersect(datasetAllowedTeams).nonEmpty
      case _ => Fox.successful(false)
    }

  def isUnreported(dataset: Dataset): Boolean = dataset.status == DataSourceStatus.unreported

  def addInitialTeams(dataset: Dataset, teamIds: Seq[ObjectId], user: User)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      previousDatasetTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = false) ?~> Msg.Dataset.allowedTeamsNotFound
      _ <- Fox.fromBool(previousDatasetTeams.isEmpty) ?~> Msg.Dataset.InitialTeams.teamsNotEmpty
      includeMemberOnlyTeams = user.isDatasetManager
      userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
      _ <- Fox.fromBool(teamIds.forall(teamId => userTeams.map(_._id).contains(teamId))) ?~> Msg.Dataset.InitialTeams.invalidTeams
      _ <- datasetDAO.assertUpdateAccess(dataset._id) ?~> Msg.Dataset.InitialTeams.forbidden
      _ <- teamDAO.updateAllowedTeamsForDataset(dataset._id, teamIds)
    } yield ()

  def addUploader(dataset: Dataset, _uploader: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(dataset._uploader.isEmpty) ?~> Msg.Dataset.Upload.uploaderNotEmpty
      _ <- datasetDAO.updateUploader(dataset._id, Some(_uploader)) ?~> Msg.Dataset.Upload.setUploaderForbidden
    } yield ()

  private def updateRealPathsForDataSource(pathInfo: DataSourcePathInfo)(using ctx: DBAccessContext): Fox[Unit] = {
    val datasetBox = datasetDAO.findOneByDataSourceId(pathInfo.dataSourceId).shiftBox
    datasetBox.flatMap {
      case Full(dataset) =>
        for {
          _ <- datasetMagsDAO.updateMagRealPathsForDataset(dataset._id, pathInfo.magPathInfos)
          _ <- datasetLayerAttachmentsDAO.updateAttachmentRealPathsForDataset(dataset._id, pathInfo.attachmentPathInfos)
        } yield ()
      case Empty => // Dataset reported but ignored (non-existing/forbidden org)
        Fox.successful(())
      case e: EmptyBox =>
        Fox.failure(Msg.Dataset.notFound(pathInfo.dataSourceId.directoryName), e)
    }
  }

  def updateRealPaths(pathInfos: List[DataSourcePathInfo])(using ctx: DBAccessContext): Fox[Unit] =
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

  def deleteDataset(dataset: Dataset)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      datastoreClient <- clientFor(dataset)
      _ <- if (dataset.isVirtual) {
        for {
          pathsUsedOnlyByThisDataset <- findPathsUsedOnlyByThisDataset(dataset._id)
          // Note that the datastore only deletes local paths and the external deletion service only paths on our managed S3 cloud storage
          _ <- pathDeletionService.deletePaths(datastoreClient, pathsUsedOnlyByThisDataset)
        } yield ()
      } else {
        dataset.rootPath.orElse(dataset.rootRealPath).match {
          case Some(rootPath) =>
            for {
              datastore <- dataStoreFor(dataset)
              rootPathValidated <- UPath.fromString(rootPath).toFox
              _ <- Fox.fromBool(rootPathValidated.isLocal)
              datasetsUsingDataFromThisDir <- findDatasetsUsingDataFromDir(rootPathValidated, datastore, dataset._id)
              _ <- Fox.fromBool(datasetsUsingDataFromThisDir.isEmpty) ?~> s"Cannot delete dataset because ${datasetsUsingDataFromThisDir.length} other datasets reference its data: ${
                datasetsUsingDataFromThisDir
                  .mkString(",")
              }"
              _ <- datastoreClient.deleteOnDisk(dataset._id, rootPath) ?~> Msg.Dataset.Delete.failed
            } yield ()
          case None =>
            // Non-Virtual datasets should all have root paths. In case no root path is set, we skip deleting it.
            Fox.successful(())
        }
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
      existingDatasetBox <- datasetDAO.findOne(datasetId)(using GlobalAccessContext).shiftBox
      _ <- existingDatasetBox match {
        case Full(dataset) =>
          for {
            annotationCount <- annotationDAO.countAllByDataset(dataset._id)(using GlobalAccessContext)
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
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore)(using GlobalAccessContext)
      _ = analyticsService.track(UploadDatasetEvent(user, dataset, dataStore, datasetSizeBytes))
      _ = if (!needsConversion) mailchimpClient.tagUser(user, MailchimpTag.HasUploadedOwnDataset)
    } yield ()

  private def logDatasetUploadToSlack(user: User, datasetId: ObjectId, addVariantLabel: String): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(user._organization)(using GlobalAccessContext)
      multiUser <- multiUserDAO.findOne(user._multiUser)(using GlobalAccessContext)
      resultLink = s"${conf.Http.uri}/datasets/$datasetId"
      superUserLabel = if (multiUser.isSuperUser) " (for superuser)" else ""
      _ = slackNotificationService.info(s"Dataset added ($addVariantLabel)$superUserLabel",
                                        s"For organization: ${organization.name}. <$resultLink|Result>")
    } yield ()

  def writeMirrorForVirtual(dataset: Dataset)(using ctx: DBAccessContext): Fox[Unit] =
    if (dataset.isVirtual && dataset.isUsable) {
      for {
        client <- clientFor(dataset)
        writtenPaths <- client.writeMirror(Seq(dataset._id), failOnError = true)
        _ <- Fox.runOptional(writtenPaths.headOption) {
          case (_, path) => datasetDAO.updateMirrorPath(dataset._id, path)
        }
      } yield ()
    } else Fox.successful(())

  def scanRealpathsIfVirtual(dataset: Dataset)(using ctx: DBAccessContext): Fox[Unit] =
    if (dataset.isVirtual && dataset.isUsable) {
      for {
        dataSource <- usableDataSourceFor(dataset, useRealPaths = false)
        client <- clientFor(dataset)
        _ <- client.scanRealPathsForVirtual(Seq(DataSourceWithRootPathInfo(dataSource, dataset.rootPath, dataset.rootRealPath)))
      } yield ()
    } else Fox.successful(())

  def publicWrites(dataset: Dataset,
                   requestingUserOpt: Option[User],
                   organization: Option[Organization] = None,
                   dataStore: Option[DataStore] = None,
                   requestingUserTeamManagerMemberships: Option[List[TeamMembership]] = None)(
      using ctx: DBAccessContext): Fox[JsObject] =
    for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataset._organization) ?~> Msg.Organization.notFound(dataset._organization)
      }
      dataStore <- Fox.fillOption(dataStore) {
        dataStoreFor(dataset) ?~> Msg.DataStore.notFound
      }
      teams <- teamService.allowedTeamsForDataset(dataset, cumulative = false, requestingUserOpt) ?~> Msg.Dataset.List.fetchAllowedTeamsFailed
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, Some(organization))) ?~> Msg.Dataset.List.teamWritesFailed
      teamsCumulative <- teamService.allowedTeamsForDataset(dataset, cumulative = true, requestingUserOpt) ?~> Msg.Dataset.List.fetchAllowedTeamsFailed
      teamsCumulativeJs <- Fox.serialCombined(teamsCumulative)(t => teamService.publicWrites(t, Some(organization))) ?~> Msg.Dataset.List.teamWritesFailed
      logoUrl <- logoUrlFor(dataset, Some(organization)) ?~> Msg.Dataset.List.fetchLogoUrlFailed
      isEditable <- isEditableBy(dataset, requestingUserOpt, requestingUserTeamManagerMemberships) ?~> Msg.Dataset.List.isEditableCheckFailed
      lastUsedByUser <- lastUsedTimeFor(dataset._id, requestingUserOpt) ?~> Msg.Dataset.List.fetchLastUsedTimeFailed
      dataStoreJs <- dataStoreService.publicWrites(dataStore) ?~> Msg.Dataset.List.dataStoreWritesFailed
      dataSource <- dataSourceFor(dataset) ?~> Msg.Dataset.List.fetchDataSourceFailed
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
        "isVirtual" -> dataset.isVirtual,
        "creationType" -> dataset.creationType,
        "rootPath" -> dataset.rootPath,
        "rootRealPath" -> dataset.rootRealPath,
        "mirrorPath" -> dataset.mirrorPath
      )
    }
}
