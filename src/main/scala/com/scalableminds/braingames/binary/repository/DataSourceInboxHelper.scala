/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path

import com.scalableminds.braingames.binary.requester.DataRequester
import com.scalableminds.braingames.binary.models.{FiledDataSource, UnusableDataSource, UsableDataSource}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits, InProgress, ProgressTracking}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import org.apache.commons.io.FileUtils
import play.api.i18n.{I18nSupport, Messages}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

trait DataSourceInboxHelper
  extends ProgressTracking
          with FoxImplicits
          with LockKeeperHelper
          with I18nSupport
          with LazyLogging{

  val DataSourceJson = "datasource.json"

  def serverUrl: String

  def dataRequester: DataRequester

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
    val dsTypeGuesser = new DataSourceTypeGuessers(messagesApi) 
    
    withLock(unusableDataSource.sourceFolder) {
      clearAllTrackers(importTrackerId(unusableDataSource.id))
      cleanUp(unusableDataSource.sourceFolder)
      val importResult = dsTypeGuesser.guessRepositoryType(unusableDataSource.sourceFolder)
        .importDataSource(dataRequester, unusableDataSource, progressTrackerFor(importTrackerId(unusableDataSource.id)))
        .flatMap { dataSource =>
            val filedDS = FiledDataSource(unusableDataSource.sourceType, dataSource)
            writeDataSourceToFile(unusableDataSource.sourceFolder, filedDS)
        }
      
      importResult.futureBox.map {
        case Full(r) =>
          logger.info("Datasource import finished for " + unusableDataSource.id)
          Full(r.toUsable(serverUrl, unusableDataSource.owningTeam))
        case Empty =>
          logger.warn("Datasource import failed for " + unusableDataSource.id)
          Failure(Messages("dataSet.import.failedWithoutError", unusableDataSource.id))
        case f: Failure =>
          f
      }.toFox
    }.flatMap(x => x).futureBox.recover {
      case e: Exception =>
        logger.error("Failed to import dataset: " + e.getMessage, e)
        Failure(Messages("dataSet.import.failedWithError", e.getMessage), Full(e), Empty)
    }.map { result =>
      finishTrackerFor(importTrackerId(unusableDataSource.id), result.map(_ => true))
      result
    }
  }
}
