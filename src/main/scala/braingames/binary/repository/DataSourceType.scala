/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.{PathSet, Path}
import braingames.binary.models.{UsableDataSource, DataSourceLike, UnusableDataSource, DataSource}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import braingames.binary.Logger._
import braingames.util.ProgressTracking.ProgressTracker
import braingames.util.{InProgress, FoxImplicits, Fox, ProgressTracking}
import net.liftweb.common.{Empty, Full, Failure}

trait DataSourceTypeHandler {
  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def fileExtension: String

  def chanceOfInboxType(source: Path) = {
    val filteredByExtension = source ** s"*.$fileExtension"

    val files =
      if((source / "target").isDirectory)
        filteredByExtension --- ((source / "target") ***)
      else
        filteredByExtension

    files
      .take(MaxNumberOfFilesForGuessing)
      .size.toFloat / MaxNumberOfFilesForGuessing
  }
}

trait DataSourceTypes{
  val types = List(KnossosDataSourceType, TiffDataSourceType)
}

object DataSourceTypeGuessers extends DataSourceTypes{
  def guessRepositoryType(source: Path) = {
    types.maxBy(_.chanceOfInboxType(source))
  }
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}

trait DataSourceInboxHelper extends ProgressTracking with FoxImplicits with LockKeeperHelper{

  val DataSourceJson = "datasource.json"

  protected def writeDataSourceToFile(path: Path, usableDataSource: UsableDataSource) = {
    (path / DataSourceJson).fileOption.map {
      file =>
        val json = Json.toJson(usableDataSource)
        FileUtils.write(file, Json.prettyPrint(json))
        usableDataSource
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
            UsableDataSource(unusableDataSource.owningTeam, unusableDataSource.sourceType, dataSource))
      } match {
        case Some(r) =>
          logger.info("Datasource import finished for " + unusableDataSource.id)
          finishTrackerFor(importTrackerId(unusableDataSource.id), true)
          Some(r)
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
