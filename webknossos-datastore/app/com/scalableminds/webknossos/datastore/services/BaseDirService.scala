package com.scalableminds.webknossos.datastore.services

import java.io.IOException
import java.nio.file.{Files, Path, Paths}

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

import scala.concurrent.ExecutionContext

class BaseDirService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext) extends LazyLogging with FoxImplicits {
  private val baseDir = Paths.get(config.Braingames.Binary.baseFolder)
  private val additionalDirs = config.Braingames.Binary.additionalFolders.map(Paths.get(_))

  def updateSymlinks() : Fox[Unit] = {
    for {
      organizationDirectoriesNested <- additionalDirs.map(dir => PathUtils.listDirectories(dir)).toSingleBox("listDirectories failed").toFox
      datasetDirectoriesNested <- organizationDirectoriesNested.flatten.map(dir => PathUtils.listDirectories(dir)).toSingleBox("listDirectories failed").toFox
      _ <- createMissingSymlinks(datasetDirectoriesNested.flatten)
      // _ <- cleanUpDanglingSymlinks()
    } yield ()
  }

  private def createMissingSymlinks(datasetDirectories: List[Path]) = {
    Fox.serialCombined(datasetDirectories) {
      directory => createSymlink(baseDir.resolve(directory.getParent.getFileName).resolve(directory.getFileName), directory)
    }
  }

  private def createSymlink(linkLocation: Path, actualDirLocation: Path) = {
    try {
      if (Files.exists(linkLocation)) {
        if (Files.isSymbolicLink(linkLocation) && Files.isSameFile(Files.readSymbolicLink(linkLocation), actualDirLocation)) {
          // link is already in place, pass.
        } else {
          logger.warn(s"Could not create symlink at $linkLocation pointing to $actualDirLocation because there is already something else there.")
        }
        Fox.successful(())
      } else {
        logger.info(s"Creating symlink at $linkLocation pointing to $actualDirLocation")
        Fox.successful(Files.createSymbolicLink(linkLocation.toAbsolutePath, actualDirLocation.toAbsolutePath))
      }
    } catch {
      case e: IOException => Fox.failure(s"Failed to create symbolic link at $linkLocation ${e.getMessage}")
    }
  }

  private def cleanUpDanglingSymlinks() = {
    for {
      organizationDirectories <- PathUtils.listDirectories(baseDir).toFox
      dataSetDirectories <- organizationDirectories.map(dir => PathUtils.listDirectoriesRaw(dir)).toSingleBox("listDirectories failed").toFox
      _ <- Fox.serialCombined(dataSetDirectories.flatten)(cleanUpIfDanglingSymlink)
    } yield ()
  }

  private def cleanUpIfDanglingSymlink(directory: Path): Fox[Unit] = {
    try {
      logger.info(s"testing for symlinkness: $directory")
      if (Files.isSymbolicLink(directory) && Files.notExists(Files.readSymbolicLink(directory))) {
        logger.info(s"Deleting dangling symbolic link at $directory which pointed to ${Files.readSymbolicLink(directory)}")
        Fox.successful(Files.delete(directory))
      } else {
        Fox.successful(())
      }
    } catch {
      case e: IOException => Fox.failure(s"Failed to analyze possible symlink for cleanup at $directory: ${e.getMessage}")
    }
  }

}
