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
      _ <- Fox.successful(())
      organizationDirectoriesNested <- additionalDirs.map(dir => PathUtils.listDirectories(dir)).toSingleBox("listDirectories failed").toFox
      organizationDirectories: List[Path] = organizationDirectoriesNested.flatten
      datasetDirectoriesNested <- organizationDirectories.map(dir => PathUtils.listDirectories(dir)).toSingleBox("listDirectories failed").toFox
      datasetDirectories: List[Path] = datasetDirectoriesNested.flatten
      _ <- Fox.serialCombined(datasetDirectories){ directory => createSymlink(baseDir.resolve(directory.getParent.getFileName).resolve(directory.getFileName), directory) }
      _ = logger.info(s"$datasetDirectories")
    } yield ()
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

}
