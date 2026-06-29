package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.Msg
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
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
import org.apache.commons.io.FileUtils
import play.api.libs.json.Json

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DataSourceMirrorService @Inject() (
    config: DataStoreConfig,
    baseDirService: BaseDirService
) extends LazyLogging {

  private def getMirrorDir(dataSource: UsableDataSource, createIfMissing: Boolean): Box[Path] =
    for {
      orgaDir <- baseDirService.getOneLocalForOrga(
        dataSource.id.organizationId,
        createIfMissing = createIfMissing,
        checkWritable = true
      )
    } yield orgaDir.resolve(".mirror").resolve(dataSource.id.directoryName)

  def writeMirror(dataSource: UsableDataSource, datasetId: ObjectId)(implicit
      ec: ExecutionContext
  ): Fox[Option[String]] =
    if (dataSource.allExplicitPaths.forall(_.isLocal)) {
      for {
        mirrorDir <- getMirrorDir(dataSource, createIfMissing = true).toFox
        tempMirrorDir = mirrorDir.resolveSibling(mirrorDir.getFileName.toString + ".new")
        _ = logger.info(s"Writing dataset mirror for $datasetId at $mirrorDir...")
        _ <- ensureMirrorParent(mirrorDir)
        _ <- Fox.runIf(Files.exists(tempMirrorDir)) {
          tryo(FileUtils.deleteDirectory(tempMirrorDir.toFile)).toFox
        } ?~> Msg.Dataset.Mirror.deleteStaleTempMirrorFailed
        _ <- tryo(Files.createDirectory(tempMirrorDir)).toFox ?~> Msg.Dataset.Mirror.createTempMirrorDirFailed
        updatedLayers <- Fox.serialCombined(dataSource.dataLayers)(
          writeMirrorLayer(_, tempMirrorDir)
        ) ?~> Msg.Dataset.Mirror.writeMirrorLayersFailed
        mirrorDataSource = dataSource.copy(dataLayers = updatedLayers)
        _ <- writeMirrorProperties(mirrorDataSource, tempMirrorDir) ?~> Msg.Dataset.Mirror.writeMirrorPropertiesFailed
        _ <- writeReadme(tempMirrorDir, datasetId) ?~> Msg.Dataset.Mirror.writeReadmeFailed
        _ <- Fox.runIf(Files.exists(mirrorDir)) {
          tryo(FileUtils.deleteDirectory(mirrorDir.toFile)).toFox
        } ?~> Msg.Dataset.Mirror.deleteExistingMirrorFailed
        _ <- tryo(Files.move(tempMirrorDir, mirrorDir)).toFox ?~> Msg.Dataset.Mirror.moveTempMirrorFailed
      } yield Some(mirrorDir.toString)
    } else Fox.successful(None)

  private def writeMirrorLayer(layer: StaticLayer, mirrorDir: Path)(implicit ec: ExecutionContext): Fox[StaticLayer] = {
    val layerDir = mirrorDir.resolve(layer.name)
    for {
      _ <- tryo(Files.createDirectory(layerDir)).toFox ?~> Msg.Dataset.Mirror.createLayerDirFailed
      updatedMags <- Fox.serialCombined(layer.mags.toList)(
        writeMirrorMag(_, layerDir)
      ) ?~> Msg.Dataset.Mirror.writeMagsFailed
      updatedAttachmentsOpt <- writeMirrorAttachments(
        layer.attachments,
        layerDir
      ) ?~> Msg.Dataset.Mirror.writeAttachmentsFailed
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
          explicitPathLocal <- explicitPath.toLocalPath.toFox
          _ <- tryo(Files.createSymbolicLink(defaultMagPath, explicitPathLocal)).toFox
        } yield mag.copy(path = Some(UPath.fromLocalPath(defaultMagPath)))
    }

  private def writeMirrorAttachments(attachmentsOpt: Option[DataLayerAttachments], layerDir: Path)(implicit
      ec: ExecutionContext
  ): Fox[Option[DataLayerAttachments]] =
    Fox.runOptional(attachmentsOpt) { attachments =>
      for {
        updatedMeshes <- Fox.serialCombined(attachments.meshes.toList)(
          writeMirrorAttachment(_, LayerAttachmentType.mesh, layerDir)
        )
        updatedAgglomerates <- Fox.serialCombined(attachments.agglomerates.toList)(
          writeMirrorAttachment(_, LayerAttachmentType.agglomerate, layerDir)
        )
        updatedSegmentIndex <- Fox.runOptional(attachments.segmentIndex)(
          writeMirrorAttachment(_, LayerAttachmentType.segmentIndex, layerDir)
        )
        updatedConnectomes <- Fox.serialCombined(attachments.connectomes.toList)(
          writeMirrorAttachment(_, LayerAttachmentType.connectome, layerDir)
        )
        updatedCumsum <- Fox.runOptional(attachments.cumsum)(
          writeMirrorAttachment(_, LayerAttachmentType.cumsum, layerDir)
        )
      } yield DataLayerAttachments(
        meshes = updatedMeshes,
        agglomerates = updatedAgglomerates,
        segmentIndex = updatedSegmentIndex,
        connectomes = updatedConnectomes,
        cumsum = updatedCumsum
      )
    }

  private def writeMirrorAttachment(
      attachment: LayerAttachment,
      attachmentType: LayerAttachmentType.LayerAttachmentType,
      layerDir: Path
  )(implicit ec: ExecutionContext): Fox[LayerAttachment] = {
    val attachmentTypeDir = layerDir.resolve(LayerAttachmentType.defaultDirectoryNameFor(attachmentType))
    val suffix = LayerAttachmentDataformat.suffixFor(attachment.dataFormat)
    val defaultAttachmentPath = attachmentTypeDir.resolve(attachment.name + suffix)
    for {
      _ <- tryo(Files.createDirectories(attachmentTypeDir)).toFox
      localAttachmentPath <- attachment.localPath.toFox
      _ <- tryo(Files.createSymbolicLink(defaultAttachmentPath, localAttachmentPath)).toFox
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
      _ <- tryo(Files.write(readmeFile, content.getBytes(StandardCharsets.UTF_8))).toFox
    } yield ()
  }

  private def writeMirrorProperties(dataSource: UsableDataSource, mirrorDir: Path)(implicit
      ec: ExecutionContext
  ): Fox[Unit] = {
    val propertiesFile = mirrorDir.resolve(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
    val dataSourceWithRelativizedPaths = dataSource.copy(
      dataLayers = dataSource.dataLayers.map(_.relativizePaths(UPath.fromLocalPath(mirrorDir)))
    )
    JsonHelper
      .writeToFile(
        propertiesFile,
        JsonHelper.removeKeyRecursively(Json.toJson(dataSourceWithRelativizedPaths), Set("resolutions"))
      )
      .toFox
  }

  private def ensureMirrorParent(mirrorDir: Path)(implicit ec: ExecutionContext): Fox[Unit] =
    if (Files.exists(mirrorDir.getParent)) {
      Fox.fromBool(Files.isWritable(mirrorDir.getParent)) ?~> Msg.Dataset.Mirror.parentNotWritable
    } else {
      tryo {
        Files.createDirectory(mirrorDir.getParent)
      }.map(_ => ()).toFox ?~> Msg.Dataset.Mirror.createParentDirFailed
    }
}
