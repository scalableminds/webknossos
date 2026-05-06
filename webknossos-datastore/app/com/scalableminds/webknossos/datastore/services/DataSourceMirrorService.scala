package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
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
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DataSourceMirrorService @Inject()(
    config: DataStoreConfig,
) extends FoxImplicits
    with LazyLogging {
  val dataBaseDir: Path = config.Datastore.baseDirectory

  private def getMirrorDir(dataSource: UsableDataSource) =
    dataBaseDir.resolve(dataSource.id.organizationId).resolve(".mirror").resolve(dataSource.id.directoryName)

  def writeMirror(dataSource: UsableDataSource, datasetId: ObjectId)(implicit ec: ExecutionContext): Fox[Unit] =
    if (dataSource.allExplicitPaths.forall(_.isLocal)) {
      for {
        _ <- Fox.fromBool(dataSource.allExplicitPaths.forall(_.isLocal)) ?~> "dataset.writeMirror.nonLocalPaths"
        mirrorDir = getMirrorDir(dataSource)
        _ = logger.info(s"Writing dataset mirror for $datasetId at $mirrorDir...")
        _ <- ensureMirrorParent(mirrorDir)
        _ <- Fox.runIf(Files.exists(mirrorDir)) {
          tryo(Files.delete(mirrorDir)).toFox
        } ?~> "dataset.writeMirror.deleteExistingMirrorFailed"
        _ <- tryo(Files.createDirectory(mirrorDir)).toFox ?~> "dataset.writeMirror.createMirrorDirFailed"
        updatedLayers <- Fox.serialCombined(dataSource.dataLayers)(writeMirrorLayer(_, mirrorDir)) ?~> "dataset.writeMirror.writeMirrorLayersFailed"
        mirrorDataSource = dataSource.copy(dataLayers = updatedLayers)
        _ <- writeMirrorProperties(mirrorDataSource, mirrorDir) ?~> "dataset.writeMirror.writeMirrorPropertiesFailed"
        _ <- writeReadme(mirrorDir, datasetId) ?~> "dataset.writeMirror.writeReadmeFailed"
      } yield ()
    } else Fox.successful(())

  private def writeMirrorLayer(layer: StaticLayer, mirrorDir: Path)(implicit ec: ExecutionContext): Fox[StaticLayer] = {
    val layerDir = mirrorDir.resolve(layer.name)
    for {
      _ <- tryo(Files.createDirectory(layerDir)).toFox ?~> "dataset.writeMirror.createLayerDirFailed"
      updatedMags <- Fox.serialCombined(layer.mags.toList)(writeMirrorMag(_, layerDir)) ?~> "dataset.writeMirror.writeMirrorMagsFailed"
      updatedAttachmentsOpt <- writeMirrorAttachments(layer.attachments, layerDir) ?~> "dataset.writeMirror.writeMirrorAttachmentsFailed"
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
        } yield mag.copy(path = Some(UPath.fromLocalPath(defaultMagPath)))
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

  private def writeReadme(mirrorDir: Path, datasetId: ObjectId)(implicit ec: ExecutionContext): Fox[Unit] = {
    val readmeFile = mirrorDir.resolve("readme.txt")
    val content =
      s"""This directory is a read-only mirror of a database-based (virtual) dataset in WEBKNOSSOS.
        |
        |It was auto-generated and reflects the dataset’s layer structure. The mag and attachment paths
        |contain symbolic links pointing to the actual data files.
        |
        |Manual changes made here will NOT propagate back to WEBKNOSSOS. To update the dataset, use
        |the WEBKNOSSOS UI or python interface instead.
        |
        |Dataset ID: $datasetId
        |Last mirror update: ${Instant.now}
        |""".stripMargin
    for {
      _ <- tryo(Files.write(readmeFile, content.getBytes(StandardCharsets.UTF_8))).toFox ?~> "dataset.writeMirror.readmeWriteFailed"
    } yield ()
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
