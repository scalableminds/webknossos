/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import braingames.binary.models._
import braingames.binary.watcher.DirectoryChangeHandler
import braingames.util.{JsonHelper, PathUtils}
import java.nio.file.{Path => JavaPath}
import scalax.file.{PathMatcher, Path}
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.Full
import play.api.Play

protected class DataSourceInboxChangeHandler(dataSourceRepository: DataSourceRepository, serverUrl: String) extends DirectoryChangeHandler with PathUtils{

  import braingames.binary.Logger._

  val defaultTeam = "Structure of Neocortical Circuits Group"

  val maxRecursiveLayerDepth = 2

  def onStart(jpath: JavaPath, recursive: Boolean): Unit = {
    try{
      val path = Path(jpath.toFile)
      if (path.isDirectory) {
        val foundInboxSources = path.children(PathMatcher.IsDirectory).toList.flatMap(teamAwareInboxSourcesIn)
        dataSourceRepository.updateDataSources(foundInboxSources)
        dataSourceRepository.updateInboxSources(foundInboxSources)
      }
    } catch {
      case e: Exception =>
        logger.error("Failed to execute onStart. Exception: " + e.getMessage, e)
    }
  }

  def onTick(path: JavaPath, recursive: Boolean): Unit = {
    onStart(path, recursive)
  }

  def onCreate(path: JavaPath): Unit = {
    onStart(path.getParent, false)
  }

  def onDelete(path: JavaPath): Unit = {
    onStart(path.getParent, false)
  }

  def teamAwareInboxSourcesIn(path: Path): List[DataSourceLike] = {
    val team = path.name
    val inbox = PathUtils.listDirectories(path).map{ p =>
      dataSourceFromFolder(p, team)
    }
    logger.info(s"Datasets for team $team: ${inbox.map(_.id).mkString(", ")}")
    inbox
  }

  def dataSourceFromFolder(path: Path, team: String): DataSourceLike = {
    logger.info(s"Handling $team at ${path.path}")
    JsonHelper.JsonFromFile(path / "datasource.json").flatMap( _.validate(FiledDataSource.filedDataSourceFormat).asOpt) match {
      case Full(filedDataSource) =>
        filedDataSource.toUsable(serverUrl)
      case _ =>
        UnusableDataSource(serverUrl, path.name, path.toAbsolute.path, team, DataSourceTypeGuessers.guessRepositoryType(path).name)
    }
  }
}
