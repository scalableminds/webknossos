/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import braingames.util.{Fox, InProgress, FoxImplicits, ProgressTracking}
import scalax.file.Path
import braingames.binary.models.{FiledDataSource, UnusableDataSource, UsableDataSource}
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import braingames.binary.Logger._
import braingames.util.InProgress
import scala.Some
import net.liftweb.common.{Empty, Full, Failure}
import play.api.libs.concurrent.Execution.Implicits._

trait DataSourceInboxHelper extends ProgressTracking with FoxImplicits with LockKeeperHelper{

  val DataSourceJson = "datasource.json"

  def serverUrl: String

  protected def writeDataSourceToFile(path: Path, filedDataSource: FiledDataSource) = {
    (path / DataSourceJson).fileOption.map {
      file =>
        val json = Json.toJson(filedDataSource)
        FileUtils.write(file, Json.prettyPrint(json))
        filedDataSource
    }
  }

  def importTrackerId(id: String) = "import-" + id

  def progressForImport(id: String) = progressFor(importTrackerId(id))

  def isImportInProgress(id: String) = progressForImport(id) match {
    case InProgress(_) => true
    case _ => false
  }

  def cleanUp(source: Path) = {
    (source / DataSourceJson).deleteIfExists()
    (source / "target").deleteRecursively()
  }

  def transformToDataSource(unusableDataSource: UnusableDataSource): Fox[UsableDataSource] = {
    withLock[Option[UsableDataSource]](unusableDataSource.sourceFolder){
      clearAllTrackers(importTrackerId(unusableDataSource.id))
      cleanUp(unusableDataSource.sourceFolder)
      DataSourceTypeGuessers.guessRepositoryType(unusableDataSource.sourceFolder)
        .importDataSource(unusableDataSource, progressTrackerFor(importTrackerId(unusableDataSource.id)))
        .flatMap {
        dataSource =>
          writeDataSourceToFile(
            unusableDataSource.sourceFolder,
            FiledDataSource(unusableDataSource.owningTeam, unusableDataSource.sourceType, dataSource))
      } match {
        case Some(r) =>
          logger.info("Datasource import finished for " + unusableDataSource.id)
          finishTrackerFor(importTrackerId(unusableDataSource.id), true)
          Some(r.toUsable(serverUrl))
        case None =>
          logger.warn("Datasource import failed for " + unusableDataSource.id)
          finishTrackerFor(importTrackerId(unusableDataSource.id), false)
          None
      }
    }.flatMap(x => x).futureBox.recover {
      case e: Exception =>
        logger.error("Failed to import dataset: " + e.getMessage, e)
        finishTrackerFor(importTrackerId(unusableDataSource.id), false)
        Failure("Failed to import dataset.", Full(e), Empty)
    }
  }
}
