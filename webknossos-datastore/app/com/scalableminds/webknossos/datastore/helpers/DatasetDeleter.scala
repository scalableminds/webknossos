package com.scalableminds.webknossos.datastore.helpers
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{DSRemoteWebknossosClient, RemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import java.io.File
import java.nio.file.{Files, Path}
import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

trait DatasetDeleter extends LazyLogging with DirectoryConstants {
  def dataBaseDir: Path

  def deleteOnDisk(organizationId: String,
                   datasetName: String,
                   isInConversion: Boolean = false,
                   reason: Option[String] = None)(implicit ec: ExecutionContext): Fox[Unit] = {
    @tailrec
    def deleteWithRetry(sourcePath: Path, targetPath: Path, retryCount: Int = 0): Fox[Unit] =
      try {
        val deduplicatedTargetPath =
          if (retryCount == 0) targetPath else targetPath.resolveSibling(f"${targetPath.getFileName} ($retryCount)")
        val path = Files.move(sourcePath, deduplicatedTargetPath)
        if (path == null) {
          throw new Exception("Deleting dataset failed")
        }
        logger.info(s"Successfully moved dataset from $sourcePath to $targetPath...")
        Fox.successful(())
      } catch {
        case _: java.nio.file.FileAlreadyExistsException => deleteWithRetry(sourcePath, targetPath, retryCount + 1)
        case e: Exception                                => Fox.failure(s"Deleting dataset failed: ${e.toString}", Full(e))
      }

    def moveToTrash(organizationId: String,
                    datasetName: String,
                    dataSourcePath: Path,
                    reason: Option[String] = None): Fox[Unit] =
      if (Files.exists(dataSourcePath)) {
        val trashPath: Path = dataBaseDir.resolve(organizationId).resolve(trashDir)
        val targetPath = trashPath.resolve(datasetName)
        new File(trashPath.toString).mkdirs()

        logger.info(s"Deleting dataset by moving it from $dataSourcePath to $targetPath${if (reason.isDefined)
          s" because ${reason.getOrElse("")}"
        else "..."}")
        deleteWithRetry(dataSourcePath, targetPath)
      } else {
        Fox.successful(logger.info(
          s"Dataset deletion requested for dataset at $dataSourcePath, but it does not exist. Skipping deletion on disk."))
      }

    val dataSourcePath =
      if (isInConversion) dataBaseDir.resolve(organizationId).resolve(forConversionDir).resolve(datasetName)
      else dataBaseDir.resolve(organizationId).resolve(datasetName)

    for {
      _ <- moveSymlinks(organizationId, datasetName)
      _ <- moveToTrash(organizationId, datasetName, dataSourcePath, reason)
    } yield ()
  }

  def remoteWKClient: Option[DSRemoteWebknossosClient]

  private def moveSymlinks(organizationId: String, datasetName: String)(implicit ec: ExecutionContext) =
    for {
      dataSourceId <- Fox.successful(DataSourceId(datasetName, organizationId))
      layersAndLinkedMags <- Fox.runOptional(remoteWKClient)(_.fetchPaths(dataSourceId))
      _ = layersAndLinkedMags match {
        case Some(value) =>
          (value.map(lmli => handleLayerSymlinks(dataSourceId, lmli.layerName, lmli.magLinkInfos.toList)))
        case None => None
      }
    } yield ()

  private def layerMayBeMoved(dataSourceId: DataSourceId,
                              layerName: String,
                              linkedMags: List[MagLinkInfo]): Option[(DataSourceId, String)] = {
    val allMagsLocal = linkedMags.forall(_.mag.hasLocalData)
    val allLinkedDatasetLayers = linkedMags.map(_.linkedMags.map(lm => (lm.dataSourceId, lm.dataLayerName)))
    // Get combinations of datasetId, layerName that link to EVERY mag
    val linkedToByAllMags = allLinkedDatasetLayers.reduce((a, b) => a.intersect(b))
    if (allMagsLocal) {
      linkedToByAllMags.headOption
    } else {
      None
    }
  }

  private def moveLayer(sourceDataSource: DataSourceId,
                        sourceLayer: String,
                        moveToDataSource: DataSourceId,
                        moveToDataLayer: String,
                        layerMags: List[MagLinkInfo]) = {
    // Move layer physically
    val layerPath =
      dataBaseDir.resolve(sourceDataSource.organizationId).resolve(sourceDataSource.directoryName).resolve(sourceLayer)
    val targetPath = dataBaseDir
      .resolve(moveToDataSource.organizationId)
      .resolve(moveToDataSource.directoryName)
      .resolve(moveToDataLayer)
    if (Files.exists(targetPath) && Files.isSymbolicLink(targetPath)) {
      Files.delete(targetPath)
    }
    Files.move(layerPath, targetPath)

    // All symlinks are now broken, we need to recreate them
    // For every mag that links to this layer, create a symlink to the new location
    // TODO: Note that this may create more symlinks than before? Handle self-streaming.
    // TODO: If there are more symlinked layers, they should also be handled as layer symlinks, not mags!
    layerMags.foreach { magLinkInfo =>
      val mag = magLinkInfo.mag
      val newMagPath = targetPath.resolve(mag.mag.toString) // TODO: Does this work?
      magLinkInfo.linkedMags.foreach { linkedMag =>
        val linkedMagPath = dataBaseDir
          .resolve(linkedMag.dataSourceId.organizationId)
          .resolve(linkedMag.dataSourceId.directoryName)
          .resolve(linkedMag.dataLayerName)
          .resolve(linkedMag.mag.toString)
        // Remove old symlink
        if (Files.exists(linkedMagPath) && Files.isSymbolicLink(linkedMagPath)) {
          Files.delete(linkedMagPath)
          Files.createSymbolicLink(linkedMagPath, newMagPath)
        } else {
          // Hmmm..
          // One reason this would happen is for the newly moved layer (since it is not a symlink anymore)
        }
      }
    }
  }

  private def handleLayerSymlinks(dataSourceId: DataSourceId, layerName: String, linkedMags: List[MagLinkInfo]) = {
    // TODO exception handling
    val moveLayerTo = layerMayBeMoved(dataSourceId, layerName, linkedMags)
    moveLayerTo match {
      case Some((moveToDataset, moveToDataLayer)) =>
        logger.info(
          s"Found complete symlinks to layer; Moving layer $layerName from $dataSourceId to $moveToDataset/$moveToDataLayer")
        moveLayer(dataSourceId, layerName, moveToDataset, moveToDataLayer, linkedMags)
      // Move all linked mags to dataset
      // Move all symlinks to this dataset to link to the moved dataset
      case None =>
        logger.info(s"Found incomplete symlinks to layer; Moving mags from $dataSourceId to other datasets")
        linkedMags.foreach { magLinkInfo =>
          val magToDelete = magLinkInfo.mag
          if (magLinkInfo.linkedMags.nonEmpty) {
            if (magToDelete.hasLocalData) {
              // Move mag to a different dataset
              val magPath = dataBaseDir
                .resolve(dataSourceId.organizationId)
                .resolve(dataSourceId.directoryName)
                .resolve(layerName)
                .resolve(magToDelete.mag.toString)
              val target = magLinkInfo.linkedMags.head
              val targetPath = dataBaseDir
                .resolve(target.dataSourceId.organizationId)
                .resolve(target.dataSourceId.directoryName)
                .resolve(target.dataLayerName)
                .resolve(target.mag.toString)
              Files.move(magPath, targetPath)

              // Move all symlinks to this mag to link to the moved mag
              magLinkInfo.linkedMags.tail.foreach { linkedMag =>
                val linkedMagPath = dataBaseDir
                  .resolve(linkedMag.dataSourceId.organizationId)
                  .resolve(linkedMag.dataSourceId.directoryName)
                  .resolve(linkedMag.dataLayerName)
                  .resolve(linkedMag.mag.toString)
                if (Files.exists(linkedMagPath) && Files.isSymbolicLink(linkedMagPath)) { // TODO: we probably need to update datasource.json files
                  Files.delete(linkedMagPath)
                  Files.createSymbolicLink(linkedMagPath, targetPath)
                } else {
                  // Hmmm..
                }
              }
            } else {
              // TODO In this case we need to find out what the this mag actually links to
            }

          }
        }
    }
  }
}
