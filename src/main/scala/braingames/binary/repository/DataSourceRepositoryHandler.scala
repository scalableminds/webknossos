/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import braingames.binary.models._
import braingames.binary.watcher.DirectoryChangeHandler
import braingames.util.{JsonHelper, PathUtils}
import scalax.file.{PathMatcher, Path}
import java.nio.file.{Path => JavaPath}
import net.liftweb.common.Full
import net.liftweb.common.Full
import braingames.binary.models.UnusableDataSource

class DataSourceRepositoryHandler(dataSourceRepository: DataSourceRepository) extends DirectoryChangeHandler with PathUtils{

  import braingames.binary.Logger._

  val defaultTeam = "Structure of Neocortical Circuits Group"

  val maxRecursiveLayerDepth = 2

  def onStart(jpath: JavaPath, recursive: Boolean): Unit = {
    try{
      val path = Path(jpath.toFile)
      if (path.isDirectory) {
        val foundInboxSources = path.children(PathMatcher.IsDirectory).toList.flatMap(teamAwareInboxSourcesIn)
        dataSourceRepository.foundDataSources(foundInboxSources)
        DataSourceRepository.dataSources.send(foundInboxSources)
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
    JsonHelper.JsonFromFile(path / "datasource.json").flatMap( _.validate(UsableDataSource.usableDataSourceFormat).asOpt) match {
      case Full(usableDataSource) =>
        usableDataSource
      case _ =>
        UnusableDataSource(path.name, path.toAbsolute.path, team, DataSourceRepository.guessRepositoryType(path).name)
    }
  }
}
