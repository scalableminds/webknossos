package com.scalableminds.webknossos.datastore.helpers
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayerWithMagLocators,
  DataSource,
  DataSourceId,
  GenericDataSource
}
import com.scalableminds.webknossos.datastore.services.DSRemoteWebknossosClient
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import org.apache.commons.io.FileUtils

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
                    reason: Option[String]): Fox[Unit] =
      if (Files.exists(dataSourcePath)) {
        val trashPath: Path = dataBaseDir.resolve(organizationId).resolve(trashDir)
        val targetPath = trashPath.resolve(datasetName)
        new File(trashPath.toString).mkdirs()

        logger.info(
          s"Deleting dataset by moving it from $dataSourcePath to $targetPath ${reason.map(r => s"because $r").getOrElse("...")}")
        deleteWithRetry(dataSourcePath, targetPath)
      } else {
        Fox.successful(logger.info(
          s"Dataset deletion requested for dataset at $dataSourcePath, but it does not exist. Skipping deletion on disk."))
      }

    val dataSourcePath =
      if (isInConversion) dataBaseDir.resolve(organizationId).resolve(forConversionDir).resolve(datasetName)
      else dataBaseDir.resolve(organizationId).resolve(datasetName)

    for {
      _ <- moveSymlinks(organizationId, datasetName) ?~> "Failed to remake symlinks"
      _ <- moveToTrash(organizationId, datasetName, dataSourcePath, reason)
    } yield ()
  }

  def remoteWebknossosClient: DSRemoteWebknossosClient

  // Handle references to layers and mags that are deleted

  private def moveSymlinks(organizationId: String, datasetName: String)(implicit ec: ExecutionContext) =
    for {
      dataSourceId <- Fox.successful(DataSourceId(datasetName, organizationId))
      layersAndLinkedMags <- remoteWebknossosClient.fetchPaths(dataSourceId)
      exceptionBoxes = layersAndLinkedMags.map(layerMagLinkInfo =>
        handleLayerSymlinks(dataSourceId, layerMagLinkInfo.layerName, layerMagLinkInfo.magLinkInfos.toList))
      _ <- Fox.combined(exceptionBoxes.map(Fox.box2Fox)) ?~> "Failed to move symlinks"
      affectedDataSources = layersAndLinkedMags
        .flatMap(_.magLinkInfos.map(m => m.linkedMags.map(_.dataSourceId)))
        .flatten
      _ <- updateDatasourceProperties(affectedDataSources)
    } yield ()

  private def getFullyLinkedLayers(linkedMags: List[MagLinkInfo]): Seq[(DataSourceId, String)] = {
    val allMagsLocal = linkedMags.forall(_.mag.hasLocalData)
    val allLinkedDatasetLayers = linkedMags.map(_.linkedMags.map(lm => (lm.dataSourceId, lm.dataLayerName)))
    // Get combinations of datasourceId, layerName that link to EVERY mag
    val linkedToByAllMags = allLinkedDatasetLayers.reduce((a, b) => a.intersect(b))
    if (allMagsLocal && linkedToByAllMags.nonEmpty) {
      linkedToByAllMags
    } else {
      Seq()
    }
  }

  private def relativizeSymlinkPath(targetPath: Path, originPath: Path): Path = {
    val absoluteTargetPath = targetPath.toAbsolutePath
    val relativeTargetPath = originPath.getParent.toAbsolutePath.relativize(absoluteTargetPath)
    relativeTargetPath
  }

  private def getPossibleMagPaths(basePath: Path, magInfo: DataSourceMagInfo): List[Path] = {
    val layerPath = basePath
      .resolve(magInfo.dataSourceId.organizationId)
      .resolve(magInfo.dataSourceId.directoryName)
      .resolve(magInfo.dataLayerName)
    List(layerPath.resolve(magInfo.mag.toMagLiteral(allowScalar = true)),
         layerPath.resolve(magInfo.mag.toMagLiteral(allowScalar = false)))
  }

  private def updateDatasourceProperties(dataSourceIds: List[DataSourceId])(
      implicit ec: ExecutionContext): Fox[List[Unit]] =
    // We need to update locally explored datasets, since they now may have symlinks where previously they only had the
    // path property set.
    Fox.serialCombined(dataSourceIds)(dataSourceId => {
      val propertiesPath = dataBaseDir
        .resolve(dataSourceId.organizationId)
        .resolve(dataSourceId.directoryName)
        .resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
      if (Files.exists(propertiesPath)) {
        JsonHelper.validatedJsonFromFile[DataSource](propertiesPath, dataBaseDir) match {
          case Full(dataSource) =>
            val updatedDataSource = dataSource.copy(dataLayers = dataSource.dataLayers.map {
              case dl: DataLayerWithMagLocators =>
                if (dl.mags.forall(_.path.exists(_.startsWith(s"${DataVaultService.schemeFile}://")))) {
                  // Setting path to None means using resolution of layer/mag directories to access data
                  dl.mapped(magMapping = _.copy(path = None))
                } else {
                  dl
                }
              case dl => dl
            })
            // Write properties back
            tryo(Files.delete(propertiesPath)) match {
              case Full(_) => JsonHelper.jsonToFile(propertiesPath, updatedDataSource)
              case e       => e
            }
          case _ => Full(())
        }
      } else {
        Full(())
      }
    })

  private def updateMagSymlinks(targetMagPath: Path, linkedMag: DataSourceMagInfo): Unit = {
    val linkedMagPaths = getPossibleMagPaths(dataBaseDir, linkedMag)
    // Before deleting, check write permissions at linkedMagPath
    if (!Files.isWritable(linkedMagPaths.head.getParent)) {
      throw new Exception(s"Cannot update symlink at ${linkedMagPaths.head}, no write permissions!")
    }
    val existingLinkedMagPath = linkedMagPaths.find(p => Files.exists(p) || Files.isSymbolicLink(p))

    existingLinkedMagPath match {
      case Some(linkedMagPath) =>
        Files.delete(linkedMagPath)
        logger.info(s"Deleting symlink and recreating it at $linkedMagPath")
        Files.createSymbolicLink(linkedMagPath, relativizeSymlinkPath(targetMagPath, linkedMagPath))
      case None =>
        val linkedMagPath = linkedMagPaths.head
        if (!Files.exists(linkedMagPath) && linkedMag.path == linkedMag.realPath) {
          // This is the case for locally explored datasets
          // Since locally explored datasets are always fully linked layers when explored, this case can
          // only happen if one of the mags was manually edited in the properties file.
          Files.createSymbolicLink(linkedMagPath, relativizeSymlinkPath(targetMagPath, linkedMagPath))
        } else {
          logger.warn(s"Trying to recreate symlink at mag $linkedMagPath, but it does not exist!")
        }
    }
  }

  private def moveLayer(sourceDataSource: DataSourceId,
                        sourceLayer: String,
                        fullLayerLinks: Seq[(DataSourceId, String)],
                        layerMags: List[MagLinkInfo]): Unit = {
    // Move layer on disk
    val layerPath =
      dataBaseDir.resolve(sourceDataSource.organizationId).resolve(sourceDataSource.directoryName).resolve(sourceLayer)

    if (fullLayerLinks.isEmpty) {
      throw new IllegalArgumentException(
        s"Cannot move layer $sourceLayer from $sourceDataSource, no fully linked layers provided!")
    }

    // Select one of the fully linked layers as target to move layer to
    // Selection of the first one is arbitrary, is there anything to distinguish between them?
    val target = fullLayerLinks.head
    val moveToDataSource = target._1
    val moveToDataLayer = target._2
    val targetPath = dataBaseDir
      .resolve(moveToDataSource.organizationId)
      .resolve(moveToDataSource.directoryName)
      .resolve(moveToDataLayer)

    // Before deleting, check write permissions at targetPath
    if (!Files.isWritable(targetPath.getParent)) {
      throw new Exception(s"Cannot move layer $sourceLayer to $targetPath, no write permissions!")
    }

    logger.info(
      s"Found complete symlinks to layer; Moving layer $sourceLayer from $sourceDataSource to $moveToDataSource/$moveToDataLayer")
    if (Files.exists(targetPath) && Files.isSymbolicLink(targetPath)) {
      Files.delete(targetPath)
    }
    if (Files.exists(targetPath) && Files.isDirectory(targetPath)) {
      // This happens when the fully linked layer consists of mag symlinks. The directory exists and is full of symlinked mags.
      // We need to delete the directory before moving the layer.
      FileUtils.deleteDirectory(targetPath.toFile)
    }
    Files.move(layerPath, targetPath)

    // All symlinks are now broken, we need to recreate them
    // There may be more layers that are "fully linked", where we need to add only one symlink

    fullLayerLinks.tail.foreach { linkedLayer =>
      val linkedLayerPath =
        dataBaseDir.resolve(linkedLayer._1.organizationId).resolve(linkedLayer._1.directoryName).resolve(linkedLayer._2)
      // Before deleting, check write permissions at linkedLayerPath
      if (!Files.isWritable(linkedLayerPath.getParent)) {
        throw new Exception(s"Cannot move layer $sourceLayer to $targetPath, no write permissions!")
      }
      if (Files.exists(linkedLayerPath) || Files.isSymbolicLink(linkedLayerPath)) {
        // Two cases exist here: 1. The layer is a regular directory where each mag is a symlink
        // 2. The layer is a symlink to the other layer itself.
        // We can handle both by deleting the layer and creating a new symlink.
        Files.delete(linkedLayerPath)
        logger.info(
          s"Deleting existing symlink at $linkedLayerPath linking to $sourceDataSource/$sourceLayer, creating new symlink")
        Files.createSymbolicLink(linkedLayerPath, relativizeSymlinkPath(targetPath, linkedLayerPath))
      } else {
        if (!Files.exists(linkedLayerPath)) {
          // This happens when the layer is a locally explored dataset, where the path is directly written into the properties
          // and no layer directory actually exists.
          Files.createSymbolicLink(linkedLayerPath, relativizeSymlinkPath(targetPath, linkedLayerPath))
        } else {
          // This should not happen, since we got the info from WK that a layer exists here
          logger.warn(s"Trying to recreate symlink at layer $linkedLayerPath, but it does not exist!")
        }
      }
    }

    // For every mag that linked to this layer, we need to update the symlink
    // We need to discard the already handled mags (fully linked layers)

    layerMags.foreach { magLinkInfo =>
      val mag = magLinkInfo.mag
      val newMagPath =
        Seq(targetPath.resolve(mag.mag.toMagLiteral(true)), targetPath.resolve(mag.mag.toMagLiteral(false)))
          .find(Files.exists(_))
          .getOrElse(
            throw new Exception(s"Cleaning up move failed for $mag, no local data found ${targetPath.resolve(mag.mag
              .toMagLiteral(true))} or ${targetPath.resolve(mag.mag.toMagLiteral(false))}, failed to create symlink!"))
      magLinkInfo.linkedMags
        .filter(linkedMag => !fullLayerLinks.contains((linkedMag.dataSourceId, linkedMag.dataLayerName))) // Filter out mags that are fully linked layers, we already handled them
        .foreach { linkedMag =>
          updateMagSymlinks(newMagPath, linkedMag)
        }
    }

  }

  private def handleLayerSymlinks(dataSourceId: DataSourceId,
                                  layerName: String,
                                  linkedMags: List[MagLinkInfo]): Box[Unit] =
    tryo {
      val fullyLinkedLayers = getFullyLinkedLayers(linkedMags)
      if (fullyLinkedLayers.nonEmpty) {
        moveLayer(dataSourceId, layerName, fullyLinkedLayers, linkedMags)
      } else {
        logger.info(s"Found incomplete symlinks to layer; Moving mags from $dataSourceId to other datasets")
        linkedMags.foreach { magLinkInfo =>
          val magToDelete = magLinkInfo.mag
          if (magLinkInfo.linkedMags.nonEmpty) {
            if (magToDelete.hasLocalData) {
              // Move mag to a different dataset
              val magPath = getPossibleMagPaths(dataBaseDir, magToDelete).find(Files.exists(_)).getOrElse {
                throw new IllegalArgumentException(
                  s"Cannot move mag $magToDelete, no local data found at ${magToDelete.path}!")
              }
              // Select an arbitrary linked mag to move to
              val target = magLinkInfo.linkedMags.head
              val possibleMagTargetPaths = getPossibleMagPaths(dataBaseDir, target)

              // Before deleting, check write permissions at targetPath
              if (!Files.isWritable(possibleMagTargetPaths.head.getParent)) {
                throw new Exception(
                  s"Cannot move mag $magToDelete to ${possibleMagTargetPaths.head.getParent}, no write permissions!")
              }

              val targetPathExistingSymlink = possibleMagTargetPaths.find(Files.isSymbolicLink)
              targetPathExistingSymlink match {
                case Some(targetPath) =>
                  logger.info(
                    s"Deleting existing symlink at $targetPath linking to ${Files.readSymbolicLink(targetPath)}")
                  Files.delete(targetPath)
                case _ => ()
              }
              val targetPath = targetPathExistingSymlink.getOrElse(possibleMagTargetPaths.head)
              Files.move(magPath, targetPath)

              // Move all symlinks to this mag to link to the moved mag
              magLinkInfo.linkedMags.tail.foreach { linkedMag =>
                updateMagSymlinks(targetPath, linkedMag)
              }
            } else {
              // The mag has no local data but there are links to it...
              // Mags without local data are either
              // 1. remote and thus they have no mags that can be linked to (but also we do not need to delete anything more here)
              // 2. are links themselves to other mags. In this case, there can't be any links to this here since they
              // would be resolved to the other mag.
              // 3. locally explored datasets. They don't have layer directories that could have symlinks to them, so
              // this is also not a problem.
              // So this should not happen.
              logger.warn(s"Trying to move mag $magToDelete, but it has no local data!")
            }
          }
        }
      }
    }
}
