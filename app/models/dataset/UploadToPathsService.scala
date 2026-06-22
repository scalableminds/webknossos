package models.dataset

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Failure, Fox, FoxImplicits, Full, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentDataformat.LayerAttachmentDataformat
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentType.LayerAttachmentType
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerAttachments, DataSourceId, DataSourceStatus, LayerAttachment, LayerAttachmentDataformat, LayerAttachmentType, StaticColorLayer, StaticLayer, StaticSegmentationLayer, UsableDataSource}
import com.scalableminds.webknossos.datastore.services.{BaseDirConfig, BaseDirConfigReader, DataSourceValidation}
import com.scalableminds.webknossos.datastore.services.uploading.LinkedLayerIdentifier
import controllers.{PathDeletionService, ReserveAttachmentUploadToPathRequest, ReserveDatasetUploadToPathsForPreliminaryRequest, ReserveDatasetUploadToPathsRequest, ReserveMagUploadToPathRequest}
import models.folder.FolderDAO
import models.organization.{OrganizationDAO, OrganizationService}
import models.user.User
import play.api.http.Status.FORBIDDEN
import utils.WkConf
import security.RandomIDGenerator

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class UploadToPathsService @Inject()(datasetService: DatasetService,
                                     organizationService: OrganizationService,
                                     organizationDAO: OrganizationDAO,
                                     datasetDAO: DatasetDAO,
                                     dataStoreDAO: DataStoreDAO,
                                     layerToLinkService: LayerToLinkService,
                                     datasetLayerAttachmentsDAO: DatasetLayerAttachmentDAO,
                                     datasetMagDAO: DatasetMagDAO,
                                     pathDeletionService: PathDeletionService,
                                     folderDAO: FolderDAO,
                                     conf: WkConf)
    extends FoxImplicits
    with DataSourceValidation {

  def reserveDatasetUploadToPaths(
      parameters: ReserveDatasetUploadToPathsRequest,
      requestingUser: User,
      newDatasetId: ObjectId)(using ec: ExecutionContext, ctx: DBAccessContext): Fox[UsableDataSource] =
    for {
      organization <- organizationDAO.findOne(requestingUser._organization)
      _ <- organizationService.assertUsedStorageNotExceeded(organization) ?~> Msg.Dataset.Upload.storageExceeded ~> FORBIDDEN
      _ <- Fox.runIf(parameters.requireUniqueName)(
        datasetService.checkNameAvailable(parameters.datasetName, organization._id))
      _ <- datasetService.assertValidDatasetName(parameters.datasetName)
      _ <- Fox.serialCombined(parameters.dataSource.dataLayers)(layer =>
        datasetService.assertValidLayerNameLax(layer.name))
      _ <- Fox.serialCombined(parameters.layersToLink.flatMap(_.newLayerName))(newLayerName =>
        datasetService.assertValidLayerNameLax(newLayerName))
      newDirectoryName = datasetService.generateDirectoryName(parameters.datasetName, newDatasetId)
      dataSourceWithNewDirectoryName = parameters.dataSource.copy(id = DataSourceId(newDirectoryName, organization._id))
      _ <- Fox.fromBool(parameters.dataSource.dataLayers.nonEmpty) ?~> Msg.Dataset.Upload.noLayers
      dataSourceWithPaths <- addPathsToDatasource(dataSourceWithNewDirectoryName,
                                                  organization._id,
                                                  parameters.pathPrefix)
      dataSourceWithLayersToLink <- layerToLinkService.addLayersToLinkToDataSource(dataSourceWithPaths,
                                                                                   parameters.layersToLink)
      _ <- assertValidDataSource(dataSourceWithLayersToLink).toFox
      folderIdWithFallback = parameters.folderId.getOrElse(organization._rootFolder)
      _ <- folderDAO.assertUpdateAccess(folderIdWithFallback) ?~> Msg.Folder.noWriteAccess
      dataStore <- findReferencedDataStore(parameters.layersToLink)
      dataset <- datasetService.createDataset(
        dataStore,
        newDatasetId,
        parameters.datasetName,
        dataSourceWithLayersToLink.toUnusableWithStatus(DataSourceStatus.notYetUploadedToPaths),
        isVirtual = true,
        creationType = DatasetCreationType.UploadToPaths
      )
      _ <- datasetDAO.updateFolder(newDatasetId, parameters.folderId.getOrElse(organization._rootFolder))(using GlobalAccessContext)
      _ <- datasetService.addInitialTeams(dataset, parameters.initialTeamIds, requestingUser) // called with user access context. Should be fine now that the folder is set correctly
      _ <- datasetService.addUploader(dataset, requestingUser._id)(using GlobalAccessContext)
    } // Note: not returning the one with layersToLink. Those are managed by the server entirely, so the client doesn’t need their paths.
    yield dataSourceWithPaths

  // Used by the convert_to_wkw worker job to upload a converting dataset to the final paths.
  def reserveDatasetUploadToPathsForPreliminary(
      parameters: ReserveDatasetUploadToPathsForPreliminaryRequest,
      requestingUser: User,
      dataset: Dataset)(using ec: ExecutionContext, ctx: DBAccessContext): Fox[UsableDataSource] =
    for {
      _ <- Fox.fromBool(dataset.status == DataSourceStatus.notYetUploaded) ?~> s"Dataset is not in uploading status, got ${dataset.status}."
      _ <- Fox.fromBool(dataset._uploader.contains(requestingUser._id)) ?~> s"Cannot reserve paths for a dataset someone else uploaded."
      dataSourceWithFixedDirectoryName = parameters.dataSource.copy(
        id = DataSourceId(dataset.directoryName, requestingUser._organization),
        statusOpt = Some(DataSourceStatus.notYetUploaded))
      dataSourceWithPaths <- addPathsToDatasource(dataSourceWithFixedDirectoryName,
                                                  requestingUser._organization,
                                                  parameters.pathPrefix)
      _ <- assertValidDataSource(dataSourceWithPaths).toFox
      _ <- datasetDAO.updateDataSource(dataset._id,
                                       dataset._dataStore,
                                       dataSourceWithPaths.hashCode(),
                                       dataSourceWithPaths,
                                       isUsable = false)
    } yield dataSourceWithPaths

  private def findReferencedDataStore(
      layersToLink: Seq[LinkedLayerIdentifier])(using ctx: DBAccessContext, ec: ExecutionContext): Fox[DataStore] = {
    val datasetIds = layersToLink.map(_.datasetId).toSet
    for {
      datasets <- Fox.serialCombined(datasetIds)(datasetDAO.findOne)
      referencedDatastoreNames = datasets.filter(!_.isVirtual).map(_._dataStore).distinct
      _ <- Fox.fromBool(referencedDatastoreNames.length <= 1) ?~> Msg.DataStore.ambiguous
      dataStore <- referencedDatastoreNames.headOption match {
        case Some(firstDatastoreName) => dataStoreDAO.findOneByName(firstDatastoreName)
        case None                     => dataStoreDAO.findOneWithUploadsToPathsAllowed
      }
      _ <- Fox.fromBool(dataStore.allowsUploadToPaths) ?~> Msg.DataStore.uploadToPathsNotAllowed
    } yield dataStore
  }

  private lazy val configuredUploadToPathsPrefixes: Box[Seq[UPath]] = {
    val datastoreBaseDirConfigs: Seq[BaseDirConfig] = new BaseDirConfigReader().read(conf.Datastore.baseDirectories)
    val fallbackFromBaseFolder = for {
      selected <- Box(datastoreBaseDirConfigs.find(c => c.path.isLocal && c.allowsUpload && c.organizationId.isEmpty))
    } yield Seq(selected.path)
    conf.WebKnossos.Datasets.UploadToPaths.prefixes match {
      case None => fallbackFromBaseFolder
      case Some(fromConfigStrs) if fromConfigStrs.isEmpty =>
        fallbackFromBaseFolder
      case Some(fromConfigStrs) =>
        (for {
          fromConfig <- fromConfigStrs.map(UPath.fromString)
        } yield fromConfig.map(_.toAbsolute)).toList.toSingleBox("Could not parse config uploadToPaths.prefixes")
    }
  }

  private def selectPathPrefix(requestedPrefix: Option[UPath]): Box[UPath] =
    for {
      configuredPrefixes <- configuredUploadToPathsPrefixes
      selectedPrefix <- requestedPrefix match {
        case Some(requested) =>
          if (configuredPrefixes.contains(requested)) Full(requested)
          else Failure("Requested path prefix is not in list of configured ones.")
        case None => Box(configuredPrefixes.headOption)
      }
    } yield selectedPrefix

  private lazy val uploadToPathsInfixOpt: Option[String] = conf.WebKnossos.Datasets.UploadToPaths.infix match {
    case Some(infix) if infix == "" => None
    case other                      => other
  }

  private def selectPathPrefixDatasetParent(requestedPrefix: Option[UPath], organizationId: String)(
      implicit ec: ExecutionContext): Fox[UPath] =
    for {
      uploadToPathsPrefix <- selectPathPrefix(requestedPrefix).toFox ?~> Msg.Dataset.Upload.ToPaths.noMatchingPrefix
      withOrgaDirOrSame = if (conf.WebKnossos.Datasets.UploadToPaths.insertOrganizationDirectory)
        uploadToPathsPrefix / organizationId
      else uploadToPathsPrefix
      withInfixOrSame = uploadToPathsInfixOpt.map(infix => withOrgaDirOrSame / infix).getOrElse(withOrgaDirOrSame)
    } yield withInfixOrSame

  private def addPathsToDatasource(
      dataSource: UsableDataSource,
      organizationId: String,
      requestedPrefix: Option[UPath])(implicit ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      datasetParent <- selectPathPrefixDatasetParent(requestedPrefix, organizationId)
      datasetPath = datasetParent / dataSource.id.directoryName
      layersWithPaths <- Fox.serialCombined(dataSource.dataLayers)(layer => addPathsToLayer(layer, datasetPath))
    } yield dataSource.copy(dataLayers = layersWithPaths)

  private def addPathsToLayer(dataLayer: StaticLayer, dataSourcePath: UPath)(
      implicit ec: ExecutionContext): Fox[StaticLayer] =
    for {
      layerPath <- Fox.successful(dataSourcePath / dataLayer.name)
      magsWithPaths = dataLayer.mags.map(mag => addPathToMag(mag, layerPath))
      attachmentsWithPaths <- addPathsToAttachments(dataLayer.attachments, layerPath)
      layerUpdated <- dataLayer match {
        case l: StaticColorLayer => Fox.successful(l.copy(mags = magsWithPaths, attachments = attachmentsWithPaths))
        case l: StaticSegmentationLayer =>
          Fox.successful(l.copy(mags = magsWithPaths, attachments = attachmentsWithPaths))
        case _ => Fox.failure("Unknown layer type in reserveUploadToPaths")
      }
    } yield layerUpdated

  private def addPathToMag(mag: MagLocator, layerPath: UPath): MagLocator =
    mag.copy(path = Some(layerPath / mag.mag.toMagLiteral(allowScalar = true)))

  private def addPathsToAttachments(attachmentsOpt: Option[DataLayerAttachments], layerPath: UPath)(
      implicit ec: ExecutionContext): Fox[Option[DataLayerAttachments]] =
    attachmentsOpt match {
      case None => Fox.successful(None)
      case Some(attachments) =>
        Fox.successful(
          Some(
            attachments.copy(
              meshes = attachments.meshes.map(attachment =>
                addGeneratedPathToAttachment(attachment, LayerAttachmentType.mesh, layerPath)),
              agglomerates = attachments.agglomerates.map(attachment =>
                addGeneratedPathToAttachment(attachment, LayerAttachmentType.agglomerate, layerPath)),
              segmentIndex = attachments.segmentIndex.map(attachment =>
                addGeneratedPathToAttachment(attachment, LayerAttachmentType.segmentIndex, layerPath)),
              connectomes = attachments.connectomes.map(attachment =>
                addGeneratedPathToAttachment(attachment, LayerAttachmentType.connectome, layerPath)),
              cumsum = attachments.cumsum.map(attachment =>
                addGeneratedPathToAttachment(attachment, LayerAttachmentType.cumsum, layerPath)),
            )))
    }

  private def addGeneratedPathToAttachment(attachment: LayerAttachment,
                                           attachmentType: LayerAttachmentType,
                                           layerPath: UPath): LayerAttachment =
    attachment.copy(path = generateAttachmentPath(attachment.name, attachment.dataFormat, attachmentType, layerPath))

  private def generateAttachmentPath(attachmentName: String,
                                     attachmentDataformat: LayerAttachmentDataformat,
                                     attachmentType: LayerAttachmentType,
                                     layerPath: UPath): UPath = {
    val defaultDirName = LayerAttachmentType.defaultDirectoryNameFor(attachmentType)
    val suffix = LayerAttachmentDataformat.suffixFor(attachmentDataformat)
    val safeAttachmentName =
      TextUtils
        .normalizeStrong(attachmentName)
        .getOrElse(s"${attachmentType}__${RandomIDGenerator.generateBlocking(12)}")
    layerPath / defaultDirName / (safeAttachmentName + suffix)
  }

  def generateAiModelPath(id: ObjectId, organizationId: String, pathPrefix: Option[UPath])(
      implicit ec: ExecutionContext): Fox[UPath] =
    for {
      uploadToPathsPrefix <- selectPathPrefix(pathPrefix).toFox ?~> Msg.Dataset.Upload.ToPaths.noMatchingPrefix
    } yield uploadToPathsPrefix / organizationId / ".aiModels" / id

  private def generateMagPath(mag: Vec3Int, layerPath: UPath): UPath =
    layerPath / f"${mag.toMagLiteral(allowScalar = true)}__${RandomIDGenerator.generateBlocking(12)}"

  def reserveAttachmentUploadToPath(dataset: Dataset, parameters: ReserveAttachmentUploadToPathRequest)(
      implicit ec: ExecutionContext): Fox[UPath] =
    for {
      _ <- datasetService.usableDataSourceFor(dataset)
      _ <- handleExistingPendingAttachment(dataset,
                                           parameters.layerName,
                                           parameters.attachmentType,
                                           parameters.attachmentName,
                                           parameters.overwritePending.getOrElse(false))
      isSingletonAttachment = LayerAttachmentType.isSingletonAttachment(parameters.attachmentType)
      existingAttachmentsCount <- datasetLayerAttachmentsDAO.countAttachmentsIncludingPending(
        dataset._id,
        parameters.layerName,
        if (isSingletonAttachment) None else Some(parameters.attachmentName),
        parameters.attachmentType)
      existsError = if (isSingletonAttachment) Msg.Dataset.Layer.attachmentSingletonAlreadyFilled
      else Msg.Dataset.Layer.attachmentNameTaken
      _ <- Fox.fromBool(existingAttachmentsCount == 0) ?~> existsError
      datasetParent <- selectPathPrefixDatasetParent(parameters.pathPrefix, dataset._organization)
      datasetPath = datasetParent / dataset.directoryName
      attachmentPath = generateAttachmentPath(parameters.attachmentName,
                                              parameters.attachmentDataformat,
                                              parameters.attachmentType,
                                              datasetPath / parameters.layerName)
      _ <- datasetLayerAttachmentsDAO.insertWithUploadToPathPending(dataset._id,
                                                                    parameters.layerName,
                                                                    parameters.attachmentName,
                                                                    parameters.attachmentType,
                                                                    parameters.attachmentDataformat,
                                                                    attachmentPath)
    } yield attachmentPath

  def reserveMagUploadToPath(dataset: Dataset, parameters: ReserveMagUploadToPathRequest)(
      implicit ec: ExecutionContext): Fox[UPath] =
    for {
      _ <- datasetService.usableDataSourceFor(dataset)
      _ <- handleExistingPendingMag(dataset, parameters.layerName, parameters.mag, parameters.overwritePending)
      datasetParent <- selectPathPrefixDatasetParent(parameters.pathPrefix, dataset._organization)
      datasetPath = datasetParent / dataset.directoryName
      magPath = generateMagPath(parameters.mag, datasetPath / parameters.layerName)
      _ <- datasetMagDAO.insertWithUploadToPathPending(dataset._id,
                                                       parameters.layerName,
                                                       parameters.mag,
                                                       parameters.axisOrder,
                                                       parameters.channelIndex,
                                                       magPath)
    } yield magPath

  def handleExistingPendingMag(dataset: Dataset, layerName: String, mag: Vec3Int, overwritePending: Boolean)(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      withPendingUploadToPathsBox <- datasetMagDAO.findOneWithPendingUploadToPath(dataset._id, layerName, mag).shiftBox
      withPendingUploadBox <- datasetMagDAO.findOneWithPendingUpload(dataset._id, layerName, mag).shiftBox
      _ <- if (overwritePending) {
        for {
          _ <- Fox.runOptional(withPendingUploadToPathsBox.toOption) { oldPending =>
            deletePathsForOldPending(dataset, oldPending.path)
          }
          _ <- datasetMagDAO.deletePendingMagLocator(dataset._id, layerName, mag)
        } yield ()
      } else
        Fox.runIf(withPendingUploadToPathsBox.isDefined || withPendingUploadBox.isDefined) {
          Fox.failure(Msg.Dataset.Upload.ToPaths.magAlreadyPending)
        }
    } yield ()

  def handleExistingPendingAttachment(dataset: Dataset,
                                      layerName: String,
                                      attachmentType: LayerAttachmentType,
                                      attachmentName: String,
                                      overwritePending: Boolean)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      withPendingUploadToPathsBox <- datasetLayerAttachmentsDAO
        .findOneWithPendingUploadToPath(dataset._id, layerName, attachmentType, attachmentName)
        .shiftBox
      withPendingUploadBox <- datasetLayerAttachmentsDAO
        .findOneWithPendingUpload(dataset._id, layerName, attachmentType, attachmentName)
        .shiftBox
      _ <- if (overwritePending) {
        datasetLayerAttachmentsDAO.deletePendingAttachment(dataset._id, layerName, attachmentType, attachmentName)
      } else
        Fox.runIf(withPendingUploadToPathsBox.isDefined || withPendingUploadBox.isDefined) {
          Fox.failure("Conflict with existing pending attachment. Pass overwritePending to overwrite.")
        }
    } yield ()

  private def deletePathsForOldPending(dataset: Dataset, pathOpt: Option[UPath])(
      implicit ec: ExecutionContext): Fox[Unit] =
    Fox.runOptional(pathOpt) { path =>
      for {
        client <- datasetService.clientFor(dataset)(using GlobalAccessContext)
        _ <- pathDeletionService.deletePaths(client, Seq(path))
      } yield ()
    }.map(_ => ())

}
