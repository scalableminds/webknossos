package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Failure, Fox, FoxImplicits, Full, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentDataformat.LayerAttachmentDataformat
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachmentType.LayerAttachmentType
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayerAttachments,
  DataSourceId,
  DataSourceStatus,
  LayerAttachment,
  LayerAttachmentDataformat,
  LayerAttachmentType,
  StaticColorLayer,
  StaticLayer,
  StaticSegmentationLayer,
  UsableDataSource
}
import com.scalableminds.webknossos.datastore.services.DataSourceValidation
import controllers.{
  LinkedLayerIdentifier,
  ReserveAttachmentUploadToPathRequest,
  ReserveDatasetUploadToPathsRequest,
  ReserveDatasetUploadToPathsForPreliminaryRequest
}
import models.organization.OrganizationDAO
import models.user.User
import play.api.i18n.MessagesProvider
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DatasetUploadToPathsService @Inject()(datasetService: DatasetService,
                                            organizationDAO: OrganizationDAO,
                                            datasetDAO: DatasetDAO,
                                            dataStoreDAO: DataStoreDAO,
                                            datasetLayerAttachmentsDAO: DatasetLayerAttachmentsDAO,
                                            conf: WkConf)
    extends FoxImplicits
    with DataSourceValidation {

  def reserveDatasetUploadToPaths(parameters: ReserveDatasetUploadToPathsRequest,
                                  requestingUser: User,
                                  newDatasetId: ObjectId)(implicit ec: ExecutionContext,
                                                          ctx: DBAccessContext,
                                                          mp: MessagesProvider): Fox[UsableDataSource] =
    for {
      organization <- organizationDAO.findOne(requestingUser._organization)
      _ <- Fox.runIf(parameters.requireUniqueName)(
        datasetService.checkNameAvailable(parameters.datasetName, organization._id))
      _ <- datasetService.assertValidDatasetName(parameters.datasetName)
      _ <- Fox.serialCombined(parameters.dataSource.dataLayers)(layer =>
        datasetService.assertValidLayerNameLax(layer.name))
      _ <- Fox.serialCombined(parameters.layersToLink.flatMap(_.newLayerName))(newLayerName =>
        datasetService.assertValidLayerNameLax(newLayerName))
      newDirectoryName = datasetService.generateDirectoryName(parameters.datasetName, newDatasetId)
      dataSourceWithNewDirectoryName = parameters.dataSource.copy(id = DataSourceId(newDirectoryName, organization._id))
      _ <- Fox.fromBool(parameters.dataSource.dataLayers.nonEmpty) ?~> "dataset.reserveUploadToPaths.noLayers"
      dataSourceWithPaths <- addPathsToDatasource(dataSourceWithNewDirectoryName,
                                                  organization._id,
                                                  parameters.pathPrefix)
      dataSourceWithLayersToLink <- addLayersToLink(dataSourceWithPaths, parameters.layersToLink)
      _ <- assertValidDataSource(dataSourceWithLayersToLink).toFox
      dataStore <- findReferencedDataStore(parameters.layersToLink)
      dataset <- datasetService.createDataset(
        dataStore,
        newDatasetId,
        parameters.datasetName,
        dataSourceWithLayersToLink.toUnusableWithStatus(DataSourceStatus.notYetUploadedToPaths),
        None,
        isVirtual = true
      )
      _ <- datasetDAO.updateFolder(newDatasetId, parameters.folderId.getOrElse(organization._rootFolder))(
        GlobalAccessContext)
      _ <- datasetService.addInitialTeams(dataset, parameters.initialTeamIds, requestingUser)
      _ <- datasetService.addUploader(dataset, requestingUser._id)(GlobalAccessContext)
    } // Note: not returning the one with layersToLink. Those are managed by the server entirely, so the client doesn’t need their paths.
    yield dataSourceWithPaths

  // Used by the convert_to_wkw worker job to upload a converting dataset to the final paths.
  def reserveDatasetUploadToPathsForPreliminary(
      parameters: ReserveDatasetUploadToPathsForPreliminaryRequest,
      requestingUser: User,
      dataset: Dataset)(implicit ec: ExecutionContext, ctx: DBAccessContext): Fox[UsableDataSource] =
    for {
      _ <- Fox.fromBool(dataset.status == DataSourceStatus.notYetUploaded) ?~> s"Dataset is not in uploading status, got ${dataset.status}."
      _ <- Fox.fromBool(dataset._uploader.contains(requestingUser._id)) ?~> s"Cannot reserve paths for a dataset someone else uploaded."
      dataSourceWithFixedDirectoryName = parameters.dataSource.copy(
        id = DataSourceId(dataset.directoryName, requestingUser._organization))
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
      layersToLink: Seq[LinkedLayerIdentifier])(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[DataStore] = {
    val datasetIds = layersToLink.map(_.datasetId).toSet
    for {
      datasets <- Fox.serialCombined(datasetIds)(datasetDAO.findOne)
      referencedDatastoreNames = datasets.filter(!_.isVirtual).map(_._dataStore).distinct
      _ <- Fox.fromBool(referencedDatastoreNames.length <= 1) ?~> "dataStore.ambiguous"
      dataStore <- referencedDatastoreNames.headOption match {
        case Some(firstDatastoreName) => dataStoreDAO.findOneByName(firstDatastoreName)
        case None                     => dataStoreDAO.findOneWithUplaodsToPathsAllowed
      }
      _ <- Fox.fromBool(dataStore.allowsUploadToPaths) ?~> "dataStore.uploadToPathsNotAllowed"
    } yield dataStore
  }

  private lazy val configuredUploadToPathsPrefixes: Box[Seq[UPath]] =
    conf.WebKnossos.Datasets.uploadToPathsPrefixes match {
      case Some(fromConfigStrs) =>
        (for {
          fromConfig <- fromConfigStrs.map(UPath.fromString)
        } yield fromConfig.map(_.toAbsolute)).toList.toSingleBox("Could not parse config uploadToPathsPrefixes")
      case None =>
        for {
          datastoreBaseFolder <- Box(conf.Datastore.baseDirectory)
          fromDatastoreBaseFolder <- UPath.fromString(datastoreBaseFolder)
        } yield Seq(fromDatastoreBaseFolder.toAbsolute)
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

  private lazy val uploadToPathsInfixOpt: Option[String] = conf.WebKnossos.Datasets.uploadToPathsInfix

  private def addPathsToDatasource(
      dataSource: UsableDataSource,
      organizationId: String,
      requestedPrefix: Option[UPath])(implicit ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      uploadToPathsPrefix <- selectPathPrefix(requestedPrefix).toFox ?~> "dataset.uploadToPaths.noPrefixConfigured"
      orgaDir = uploadToPathsPrefix / organizationId
      datasetParent = uploadToPathsInfixOpt.map(infix => orgaDir / infix).getOrElse(orgaDir)
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
    mag.copy(path = Some(layerPath / mag.mag.toMagLiteral()))

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
      TextUtils.normalizeStrong(attachmentName).getOrElse(s"$attachmentType-${ObjectId.generate}")
    layerPath / defaultDirName / (safeAttachmentName + suffix)
  }

  private def addLayersToLink(dataSource: UsableDataSource, layersToLink: Seq[LinkedLayerIdentifier])(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider,
      ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      linkedLayers <- Fox.serialCombined(layersToLink)(resolveLayerToLink) ?~> "dataset.layerToLink.failed"
      allLayers = linkedLayers ++ dataSource.dataLayers
      _ <- Fox.fromBool(allLayers.length == allLayers.map(_.name).distinct.length) ?~> "dataset.duplicateLayerNames"
    } yield dataSource.copy(dataLayers = allLayers)

  private def resolveLayerToLink(layerToLink: LinkedLayerIdentifier)(implicit ctx: DBAccessContext,
                                                                     ec: ExecutionContext,
                                                                     mp: MessagesProvider): Fox[StaticLayer] =
    for {
      dataset <- datasetDAO.findOne(layerToLink.datasetId) ?~> "dataset.notFound"
      usableDataSource <- datasetService.usableDataSourceFor(dataset)
      layer: StaticLayer <- usableDataSource.dataLayers
        .find(_.name == layerToLink.layerName)
        .toFox ?~> "dataset.layerToLink.layerNotFound"
      newName = layerToLink.newLayerName.getOrElse(layer.name)
      layerRenamed: StaticLayer <- layer match {
        case l: StaticColorLayer        => Fox.successful(l.copy(name = newName))
        case l: StaticSegmentationLayer => Fox.successful(l.copy(name = newName))
        case _                          => Fox.failure("Unknown layer type for link")
      }
    } yield layerRenamed

  def reserveAttachmentUploadToPath(dataset: Dataset, parameters: ReserveAttachmentUploadToPathRequest)(
      implicit ec: ExecutionContext,
      mp: MessagesProvider): Fox[UPath] =
    for {
      _ <- datasetService.usableDataSourceFor(dataset)
      isSingletonAttachment = LayerAttachmentType.isSingletonAttachment(parameters.attachmentType)
      existingAttachmentsCount <- datasetLayerAttachmentsDAO.countAttachmentsIncludingPending(
        dataset._id,
        parameters.layerName,
        if (isSingletonAttachment) None else Some(parameters.attachmentName),
        parameters.attachmentType)
      existsError = if (isSingletonAttachment) "attachment.singleton.alreadyFilled" else "attachment.name.taken"
      _ <- Fox.fromBool(existingAttachmentsCount == 0) ?~> existsError
      uploadToPathsPrefix <- selectPathPrefix(parameters.pathPrefix).toFox ?~> "dataset.uploadToPaths.noPrefixConfigured"
      newDirectoryName = datasetService.generateDirectoryName(dataset.directoryName, dataset._id)
      datasetPath = uploadToPathsPrefix / dataset._organization / newDirectoryName
      attachmentPath = generateAttachmentPath(parameters.attachmentName,
                                              parameters.attachmentDataformat,
                                              parameters.attachmentType,
                                              datasetPath / parameters.layerName)
      _ <- datasetLayerAttachmentsDAO.insertPending(dataset._id,
                                                    parameters.layerName,
                                                    parameters.attachmentName,
                                                    parameters.attachmentType,
                                                    parameters.attachmentDataformat,
                                                    attachmentPath)
    } yield attachmentPath
}
