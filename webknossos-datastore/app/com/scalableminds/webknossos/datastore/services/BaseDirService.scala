package com.scalableminds.webknossos.datastore.services

import java.nio.file.{Files, Path, Paths}

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

class BaseDirService @Inject()(config: DataStoreConfig) extends LazyLogging {
  val baseDir = Paths.get(config.Braingames.Binary.baseFolder)
  val additionalDirs = config.Braingames.Binary.additionalFolders.map(Paths.get(_))

  def updateSymlinks() : Fox[Unit] = {
    for {
      _ <- Fox.successful(())
      directoriesNested <- additionalDirs.map(dir => PathUtils.listDirectories(dir)).toSingleBox("listDirectories failed")
      directories: Seq[Path] = directoriesNested.flatten
      _ = logger.info(s"$directories")
    } yield ()
  }

}
