/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, InProgress, FoxImplicits, ProgressTracking}
import com.scalableminds.braingames.binary.models.{FiledDataSource, UnusableDataSource, UsableDataSource}
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import com.scalableminds.braingames.binary.Logger._
import com.scalableminds.util.tools.InProgress
import net.liftweb.common.{Empty, Full, Failure}
import play.api.libs.concurrent.Execution.Implicits._

trait DataSourceInboxHelper extends ProgressTracking with FoxImplicits with LockKeeperHelper{

  val DataSourceJson = "datasource.json"

  def serverUrl: String

  protected def writeDataSourceToFile(path: Path, filedDataSource: FiledDataSource) = {
    PathUtils.fileOption(path.resolve(DataSourceJson)).map {
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

  def cleanUp(source: Path): Unit = {
    FileUtils.deleteQuietly(source.resolve(DataSourceJson).toFile)
    FileUtils.deleteQuietly(source.resolve("target").toFile)
  }

  def transformToDataSource(unusableDataSource: UnusableDataSource): Fox[UsableDataSource] = {
    withLock(unusableDataSource.sourceFolder){
      clearAllTrackers(importTrackerId(unusableDataSource.id))
      cleanUp(unusableDataSource.sourceFolder)
      DataSourceTypeGuessers.guessRepositoryType(unusableDataSource.sourceFolder)
        .importDataSource(unusableDataSource, progressTrackerFor(importTrackerId(unusableDataSource.id)))
        .toFox
        .flatMap {
        dataSource =>
          writeDataSourceToFile(
            unusableDataSource.sourceFolder,
            FiledDataSource(unusableDataSource.owningTeam, unusableDataSource.sourceType, dataSource))
      }.futureBox.map{
        case Full(r) =>
          logger.info("Datasource import finished for " + unusableDataSource.id)
          finishTrackerFor(importTrackerId(unusableDataSource.id), success = true)
          Full(r.toUsable(serverUrl))
        case _ =>
          logger.warn("Datasource import failed for " + unusableDataSource.id)
          finishTrackerFor(importTrackerId(unusableDataSource.id), success = false)
          Empty
      }.toFox
    }.flatMap(x => x).futureBox.recover {
      case e: Exception =>
        logger.error("Failed to import dataset: " + e.getMessage, e)
        finishTrackerFor(importTrackerId(unusableDataSource.id), success = false)
        Failure("Failed to import dataset.", Full(e), Empty)
    }
  }
}
