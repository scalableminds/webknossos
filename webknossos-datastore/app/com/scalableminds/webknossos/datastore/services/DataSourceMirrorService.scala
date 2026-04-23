package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayerAttachments,
  LayerAttachment,
  LayerAttachmentDataformat,
  LayerAttachmentType,
  StaticLayer,
  UsableDataSource
}
import play.api.libs.json.Json

import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DataSourceMirrorService @Inject()(
    config: DataStoreConfig,
) extends FoxImplicits {
  val dataBaseDir: Path = config.Datastore.baseDirectory

  private def getMirrorDir(dataSource: UsableDataSource) =
    dataBaseDir.resolve(dataSource.id.organizationId).resolve(".mirror").resolve(dataSource.id.directoryName)

  def writeMirror(dataSource: UsableDataSource)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(dataSource.allExplicitPaths.forall(_.isLocal)) ?~> "dataset.writeMirror.nonLocalPaths"
      mirrorDir = getMirrorDir(dataSource)
      _ <- ensureMirrorParent(mirrorDir)
      _ <- Fox.runIf(Files.exists(mirrorDir)) {
        tryo(Files.delete(mirrorDir)).toFox
      }
      _ <- tryo(Files.createDirectory(mirrorDir)).toFox
      updatedLayers <- Fox.serialCombined(dataSource.dataLayers)(writeMirrorLayer(_, mirrorDir))
      mirrorDataSource = dataSource.copy(dataLayers = updatedLayers)
      _ <- writeMirrorProperties(mirrorDataSource, mirrorDir)
    } yield ()

  private def writeMirrorLayer(layer: StaticLayer, mirrorDir: Path)(implicit ec: ExecutionContext): Fox[StaticLayer] = {
    val layerDir = mirrorDir.resolve(layer.name)
    for {
      _ <- tryo(Files.createDirectory(layerDir)).toFox
      updatedMags <- Fox.serialCombined(layer.mags.toList)(writeMirrorMag(_, layerDir))
      updatedAttachmentsOpt <- writeMirrorAttachments(layer.attachments, layerDir)
      layerWithUpdatedMags = layer.mapped(newMags = Some(updatedMags))
      updatedLayer = updatedAttachmentsOpt.fold(layerWithUpdatedMags)(layerWithUpdatedMags.withAttachments)
    } yield updatedLayer
  }

  private def writeMirrorMag(mag: MagLocator, layerDir: Path)(implicit ec: ExecutionContext): Fox[MagLocator] =
    mag.path match {
      case None => Fox.failure("Mag does not have explicit path. This should never happen for virtual datasets")
      case Some(explicitPath) =>
        val defaultMagPath = layerDir.resolve(mag.mag.toMagLiteral(allowScalar = true))
        for {
          _ <- tryo(Files.createSymbolicLink(defaultMagPath, explicitPath.toLocalPathUnsafe)).toFox
        } yield mag.copy(path = None)
    }

  private def writeMirrorAttachments(attachmentsOpt: Option[DataLayerAttachments], layerDir: Path)(
      implicit ec: ExecutionContext): Fox[Option[DataLayerAttachments]] =
    Fox.runOptional(attachmentsOpt) { attachments =>
      for {
        updatedMeshes <- Fox.serialCombined(attachments.meshes.toList)(
          writeMirrorAttachment(_, LayerAttachmentType.mesh, layerDir))
        updatedAgglomerates <- Fox.serialCombined(attachments.agglomerates.toList)(
          writeMirrorAttachment(_, LayerAttachmentType.agglomerate, layerDir))
        updatedSegmentIndex <- Fox.runOptional(attachments.segmentIndex)(
          writeMirrorAttachment(_, LayerAttachmentType.segmentIndex, layerDir))
        updatedConnectomes <- Fox.serialCombined(attachments.connectomes.toList)(
          writeMirrorAttachment(_, LayerAttachmentType.connectome, layerDir))
        updatedCumsum <- Fox.runOptional(attachments.cumsum)(
          writeMirrorAttachment(_, LayerAttachmentType.cumsum, layerDir))
      } yield
        DataLayerAttachments(
          meshes = updatedMeshes,
          agglomerates = updatedAgglomerates,
          segmentIndex = updatedSegmentIndex,
          connectomes = updatedConnectomes,
          cumsum = updatedCumsum
        )
    }

  private def writeMirrorAttachment(attachment: LayerAttachment,
                                    attachmentType: LayerAttachmentType.LayerAttachmentType,
                                    layerDir: Path)(implicit ec: ExecutionContext): Fox[LayerAttachment] = {
    val attachmentTypeDir = layerDir.resolve(LayerAttachmentType.defaultDirectoryNameFor(attachmentType))
    val suffix = LayerAttachmentDataformat.suffixFor(attachment.dataFormat)
    val defaultAttachmentPath = attachmentTypeDir.resolve(attachment.name + suffix)
    for {
      _ <- tryo(Files.createDirectories(attachmentTypeDir)).toFox
      _ <- tryo(Files.createSymbolicLink(defaultAttachmentPath, attachment.path.toLocalPathUnsafe)).toFox
    } yield attachment.copy(path = UPath.fromLocalPath(defaultAttachmentPath))
  }

  private def writeMirrorProperties(dataSource: UsableDataSource, mirrorDir: Path)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    val propertiesFile = mirrorDir.resolve(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
    val dataSourceWithRelativizedPaths = dataSource.copy(
      dataLayers = dataSource.dataLayers.map(_.relativizePaths(UPath.fromLocalPath(mirrorDir)))
    )
    JsonHelper
      .writeToFile(propertiesFile,
                   JsonHelper.removeKeyRecursively(Json.toJson(dataSourceWithRelativizedPaths), Set("resolutions")))
      .toFox ?~> "dataset.writeMirror.propertiesWriteFailed"
  }

  private def ensureMirrorParent(mirrorDir: Path)(implicit ec: ExecutionContext): Fox[Unit] =
    if (Files.exists(mirrorDir.getParent)) {
      Fox.fromBool(Files.isWritable(mirrorDir.getParent)) ?~> "Mirror dir not writable."
    } else {
      tryo {
        Files.createDirectory(mirrorDir.getParent)
      }.map(_ => ()).toFox ?~> "Could not create dataset mirror dir"
    }
}
