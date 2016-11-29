/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Files, Path}

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.watcher.DirectoryChangeHandler
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.JsonHelper
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full
import play.api.i18n.MessagesApi

protected class DataSourceInboxChangeHandler(dataSourceRepository: DataSourceRepository, serverUrl: String)
                                            (val messagesApi: MessagesApi)
  extends DirectoryChangeHandler with PathUtils with LazyLogging {

  val maxRecursiveLayerDepth = 2

  def onStart(path: Path, recursive: Boolean): Unit = {
    try {
      if (path != null && Files.isDirectory(path)) {
        PathUtils.listDirectories(path) match {
          case Full(dirs) =>
            val foundInboxSources = dirs.flatMap(teamAwareInboxSourcesIn)
            dataSourceRepository.updateDataSources(foundInboxSources)
            dataSourceRepository.updateInboxSources(foundInboxSources)
            logger.info(s"Finished scanning inbox.")
          case e =>
            logger.error(s"Failed to execute onStart. Error during list directories on '$path': $e")
        }
      }
    } catch {
      case e: Exception =>
        logger.error("Failed to execute onStart. Exception: " + e.getMessage, e)
        logger.error(e.getStackTrace.mkString("\n"))
    }
  }

  def onTick(path: Path, recursive: Boolean): Unit = {
    onStart(path, recursive)
  }

  def onCreate(path: Path): Unit = {
    onStart(path.getParent, recursive = false)
  }

  def onDelete(path: Path): Unit = {
    onStart(path.getParent, recursive = false)
  }

  def teamAwareInboxSourcesIn(path: Path): List[DataSourceLike] = {
    val team = path.getFileName.toString
    PathUtils.listDirectories(path) match {
      case Full(Nil) =>
        logger.error(s"Failed to read datasets for team $team. Empty path: $path")
        Nil
      case Full(subdirs) =>
        val inbox = subdirs.map(p => dataSourceFromFolder(p, team))
        logger.debug(s"Datasets for team $team: ${inbox.map(_.id).mkString(", ") }")
        inbox
      case e =>
        logger.error(s"Failed to list directories for team $team at path $path")
        Nil
    }
  }

  def dataSourceFromFolder(path: Path, team: String): DataSourceLike = {
    logger.debug(s"Handling $team at $path")
    JsonHelper
      .jsonFromFile(path.resolve("datasource.json"), path)
      .flatMap(json => json.validate(FiledDataSource.filedDataSourceFormat).asOpt) match {
      case Full(filedDataSource) =>
        filedDataSource.toUsable(serverUrl)
      case _ =>
        UnusableDataSource(serverUrl,
                           path.getFileName.toString,
                           path.toAbsolutePath.toString,
                           team,
                           new DataSourceTypeGuessers(messagesApi).guessRepositoryType(path).name)
    }
  }
}
