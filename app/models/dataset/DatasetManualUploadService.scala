package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.UPath
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
    extends FoxImplicits {

  def reserveManualUpload(parameters: ReserveManualUploadRequest, requestingUser: User, newDatasetId: ObjectId)(
      implicit ec: ExecutionContext,
      ctx: DBAccessContext,
      mp: MessagesProvider): Fox[UsableDataSource] =
    for {
      organization <- organizationDAO.findOne(requestingUser._organization)
      _ <- Fox.runIf(parameters.requireUniqueName)(
        datasetService.checkNameAvailable(parameters.datasetName, organization._id))
      newDirectoryName = datasetService.generateDirectoryName(parameters.datasetName, newDatasetId)
      _ <- Fox.fromBool(parameters.dataSource.dataLayers.nonEmpty) ?~> "dataset.reserveManualUpload.noLayers"
      dataSourceWithPaths <- addPathsToDatasource(parameters.dataSource, organization._id, newDatasetId)
      dataSourceWithLayersToLink <- addLayersToLink(dataSourceWithPaths, parameters.layersToLink)
      dataStore <- findReferencedDataStore(parameters.layersToLink)
      dataset <- datasetService.createDataset(
        dataStore,
        newDatasetId,
        parameters.datasetName,
        dataSourceWithLayersToLink
          .copy(id = DataSourceId(newDirectoryName, organization._id))
          .toUnusableWithStatus(DataSourceStatus.notYetManuallyUploaded),
        None,
        isVirtual = true
      )

      _ <- datasetDAO.updateFolder(newDatasetId, parameters.folderId.getOrElse(organization._rootFolder))(
        GlobalAccessContext)
      _ <- datasetService.addInitialTeams(dataset, parameters.initialTeamIds, requestingUser)
      _ <- datasetService.addUploader(dataset, requestingUser._id)(GlobalAccessContext)
    } yield dataSourceWithPaths

  private def findReferencedDataStore(
      layersToLink: Seq[LinkedLayerIdentifier])(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[DataStore] = {
    val datasetIds = layersToLink.map(_.datasetId).toSet
    for {
      datasets <- Fox.serialCombined(datasetIds)(datasetDAO.findOne)
      referencedDatastoreNames = datasets.filter(!_.isVirtual).map(_._dataStore)
      _ <- Fox.fromBool(referencedDatastoreNames.length <= 1) ?~> "dataStore.ambiguous"
      dataStore <- referencedDatastoreNames.headOption match {
        case Some(firstDatastoreName) => dataStoreDAO.findOneByName(firstDatastoreName)
        case None                     => dataStoreDAO.findOneWithManualUploadsAllowed
      }
      _ <- Fox.fromBool(dataStore.allowsManualUpload) ?~> "dataStore.manualUploadNotAllowed"
    } yield dataStore
  }

  private lazy val manualUploadPrefixBox: Box[UPath] = for {
    fromConfig <- UPath.fromString(conf.WebKnossos.Datasets.manualUploadPrefix)
    absolute <- fromConfig.toAbsolute
  } yield absolute

  private def addPathsToDatasource(dataSource: UsableDataSource, organizationId: String, datasetId: ObjectId)(
      implicit ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      manualUploadPrefix <- manualUploadPrefixBox.toFox
      datasetPath = manualUploadPrefix / organizationId / datasetId.toString
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
                addPathToAttachment(attachment, LayerAttachmentType.mesh, layerPath)),
              agglomerates = attachments.agglomerates.map(attachment =>
                addPathToAttachment(attachment, LayerAttachmentType.agglomerate, layerPath)),
              segmentIndex = attachments.segmentIndex.map(attachment =>
                addPathToAttachment(attachment, LayerAttachmentType.segmentIndex, layerPath)),
              connectomes = attachments.connectomes.map(attachment =>
                addPathToAttachment(attachment, LayerAttachmentType.connectome, layerPath)),
              cumsum = attachments.cumsum.map(attachment =>
                addPathToAttachment(attachment, LayerAttachmentType.cumsum, layerPath)),
            )))
    }

  private def addPathToAttachment(attachment: LayerAttachment,
                                  attachmentType: LayerAttachmentType,
                                  layerPath: UPath): LayerAttachment = {
    val defaultDirName = LayerAttachmentType.defaultDirectoryNameFor(attachmentType)
    val suffix = LayerAttachmentDataformat.suffixFor(attachment.dataFormat)
    val path = layerPath / defaultDirName / (attachment.name + suffix)
    attachment.copy(path = path)
  }

  private def addLayersToLink(dataSource: UsableDataSource, layersToLink: Seq[LinkedLayerIdentifier])(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider,
      ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      linkedLayers <- Fox.serialCombined(layersToLink)(resolveLayerToLink) ?~> "dataset.layerToLink.failed"
    } yield dataSource.copy(dataLayers = dataSource.dataLayers ++ linkedLayers)

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
      manualUploadPrefix <- manualUploadPrefixBox.toFox
      newDirectoryName = datasetService.generateDirectoryName(dataset.directoryName, dataset._id)
      datasetPath = manualUploadPrefix / dataset._organization / newDirectoryName
      attachmentPath = datasetPath / parameters.layerName / LayerAttachmentType.defaultDirectoryNameFor(
        parameters.attachmentType) / (TextUtils
        .normalizeStrong(parameters.attachmentName)
        .getOrElse("") + "-" + ObjectId.generate.toString)
      _ <- datasetLayerAttachmentsDAO.insertPending(dataset._id,
                                                    parameters.layerName,
                                                    parameters.attachmentName,
                                                    parameters.attachmentType,
                                                    parameters.attachmentDataformat,
                                                    attachmentPath)
    } yield attachmentPath
}
