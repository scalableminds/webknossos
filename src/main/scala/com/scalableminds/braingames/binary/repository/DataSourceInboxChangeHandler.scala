/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Paths, Files, PathMatcher, Path}
import javax.inject.Inject

import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.watcher.DirectoryChangeHandler
import com.scalableminds.util.tools.JsonHelper
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.Full
import com.scalableminds.util.io.PathUtils

protected class DataSourceInboxChangeHandler(dataSourceRepository: DataSourceRepository, serverUrl: String)(val messagesApi: MessagesApi) extends DirectoryChangeHandler with PathUtils{

  import com.scalableminds.braingames.binary.Logger._

  val defaultTeam = "Structure of Neocortical Circuits Group"

  val maxRecursiveLayerDepth = 2

  def onStart(path: Path, recursive: Boolean): Unit = {
    try{
      if (path != null && Files.isDirectory(path)) {
        val foundInboxSources = PathUtils.listDirectories(path).flatMap(teamAwareInboxSourcesIn)
        dataSourceRepository.updateDataSources(foundInboxSources)
        dataSourceRepository.updateInboxSources(foundInboxSources)

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
    onStart(path.getParent, false)
  }

  def onDelete(path: Path): Unit = {
    onStart(path.getParent, false)
  }

  def teamAwareInboxSourcesIn(path: Path): List[DataSourceLike] = {
    val team = path.getFileName.toString
    val subdirs = PathUtils.listDirectories(path)
    if(subdirs == Nil){
      logger.error(s"Failed to read datasets for team $team. Empty path: $path")
      Nil
    } else {
      val inbox = subdirs.map{ p =>
        dataSourceFromFolder(p, team)
      }
      logger.info(s"Datasets for team $team: ${inbox.map(_.id).mkString(", ")}")
      inbox  
    }
    
  }

  def dataSourceFromFolder(path: Path, team: String): DataSourceLike = {
    logger.info(s"Handling $team at $path")
    JsonHelper.JsonFromFile(path.resolve("datasource.json")).flatMap( _.validate(FiledDataSource.filedDataSourceFormat).asOpt) match {
      case Full(filedDataSource) =>
        filedDataSource.toUsable(serverUrl)
      case _ =>
        UnusableDataSource(serverUrl, path.getFileName.toString, path.toAbsolutePath.toString, team, 
          new DataSourceTypeGuessers(messagesApi).guessRepositoryType(path).name)
    }
  }
}
