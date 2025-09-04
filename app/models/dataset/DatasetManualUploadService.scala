package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, TextUtils}
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
import controllers.{LinkedLayerIdentifier, ReserveManualAttachmentUploadRequest, ReserveManualUploadRequest}
import models.organization.OrganizationDAO
import models.user.User
import play.api.i18n.MessagesProvider
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DatasetManualUploadService @Inject()(datasetService: DatasetService,
                                           organizationDAO: OrganizationDAO,
                                           datasetDAO: DatasetDAO,
                                           dataStoreDAO: DataStoreDAO,
                                           datasetLayerAttachmentsDAO: DatasetLayerAttachmentsDAO,
                                           conf: WkConf)
    extends FoxImplicits
    with DataSourceValidation {

  def reserveManualUpload(parameters: ReserveManualUploadRequest, requestingUser: User, newDatasetId: ObjectId)(
      implicit ec: ExecutionContext,
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
      _ <- Fox.fromBool(parameters.dataSource.dataLayers.nonEmpty) ?~> "dataset.reserveManualUpload.noLayers"
      dataSourceWithPaths <- addPathsToDatasource(dataSourceWithNewDirectoryName, organization._id)
      dataSourceWithLayersToLink <- addLayersToLink(dataSourceWithPaths, parameters.layersToLink)
      _ <- assertValidateDataSource(dataSourceWithLayersToLink).toFox
      dataStore <- findReferencedDataStore(parameters.layersToLink)
      dataset <- datasetService.createDataset(
        dataStore,
        newDatasetId,
        parameters.datasetName,
        dataSourceWithLayersToLink.toUnusableWithStatus(DataSourceStatus.notYetManuallyUploaded),
        None,
        isVirtual = true
      )
      _ <- datasetDAO.updateFolder(newDatasetId, parameters.folderId.getOrElse(organization._rootFolder))(
        GlobalAccessContext)
      _ <- datasetService.addInitialTeams(dataset, parameters.initialTeamIds, requestingUser)
      _ <- datasetService.addUploader(dataset, requestingUser._id)(GlobalAccessContext)
    } yield dataSourceWithPaths // Note: not returning the one with layersToLink.

  private def findReferencedDataStore(
      layersToLink: Seq[LinkedLayerIdentifier])(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[DataStore] = {
    val datasetIds = layersToLink.map(_.datasetId).toSet
    for {
      datasets <- Fox.serialCombined(datasetIds)(datasetDAO.findOne)
      referencedDatastoreNames = datasets.filter(!_.isVirtual).map(_._dataStore).distinct
      _ <- Fox.fromBool(referencedDatastoreNames.length <= 1) ?~> "dataStore.ambiguous"
      dataStore <- referencedDatastoreNames.headOption match {
        case Some(firstDatastoreName) => dataStoreDAO.findOneByName(firstDatastoreName)
        case None                     => dataStoreDAO.findOneWithManualUploadsAllowed
      }
      _ <- Fox.fromBool(dataStore.allowsManualUpload) ?~> "dataStore.manualUploadNotAllowed"
    } yield dataStore
  }

  private lazy val manualUploadPrefixBox: Box[UPath] =
    conf.WebKnossos.Datasets.manualUploadPrefix match {
      case Some(fromConfigStr) =>
        for {
          fromConfig <- UPath.fromString(fromConfigStr)
        } yield fromConfig.toAbsolute
      case None =>
        for {
          datastoreBaseFolder <- Box(conf.Datastore.baseDirectory)
          fromDatastoreBaseFolder <- UPath.fromString(datastoreBaseFolder)
        } yield (fromDatastoreBaseFolder / ".manualUploads").toAbsolute
    }

  private def addPathsToDatasource(dataSource: UsableDataSource, organizationId: String)(
      implicit ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      manualUploadPrefix <- manualUploadPrefixBox.toFox ?~> "dataset.manualUpload.noPrefixConfigured"
      datasetPath = manualUploadPrefix / organizationId / dataSource.id.directoryName
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
        case _ => Fox.failure("Unknown layer type in reserveManualUpload")
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

  def reserveManualAttachmentUpload(dataset: Dataset, parameters: ReserveManualAttachmentUploadRequest)(
      implicit ec: ExecutionContext,
      mp: MessagesProvider): Fox[UPath] =
    for {
      _ <- datasetService.usableDataSourceFor(dataset)
      existingAttachmentsCount <- datasetLayerAttachmentsDAO.countAttachmentsIncludingPending(
        dataset._id,
        parameters.layerName,
        Some(parameters.attachmentName),
        parameters.attachmentType)
      _ <- Fox.fromBool(existingAttachmentsCount == 0) ?~> "attachment.name.taken"
      _ <- Fox.runIf(LayerAttachmentType.isSingletonAttachment(parameters.attachmentType)) {
        for {
          existingSingletonAttachmentsCount <- datasetLayerAttachmentsDAO.countAttachmentsIncludingPending(
            dataset._id,
            parameters.layerName,
            None,
            parameters.attachmentType
          )
          _ <- Fox.fromBool(existingSingletonAttachmentsCount == 0) ?~> "attachment.singleton.alreadyFilled"
        } yield ()
      }
      manualUploadPrefix <- manualUploadPrefixBox.toFox ?~> "dataset.manualUpload.noPrefixConfigured"
      newDirectoryName = datasetService.generateDirectoryName(dataset.directoryName, dataset._id)
      datasetPath = manualUploadPrefix / dataset._organization / newDirectoryName
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
