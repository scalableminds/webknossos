/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.Path
import braingames.binary.models.{UsableDataSource, DataSourceLike, UnusableDataSource, DataSource}
import akka.agent.Agent
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import braingames.binary.Logger._
import scala.concurrent.Future
import braingames.util.ProgressTracking.ProgressTracker
import braingames.util.ProgressTracking

trait DataSourceTypeHandler {
  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def chanceOfInboxType(source: Path): Double
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}

object DataSourceRepository extends ProgressTracking {

  lazy val dataSources = Agent[List[DataSourceLike]](Nil)

  val types = List(KnossosDataSourceType, TiffDataSourceType)

  val DataSourceJson = "datasource.json"

  def guessRepositoryType(source: Path) = {
    cleanUp(source)
    types.maxBy(_.chanceOfInboxType(source))
  }

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

  def transformToDataSource(unusableDataSource: UnusableDataSource): Future[Option[UsableDataSource]] = {
    val f = Future {
      clearAllTrackers(importTrackerId(unusableDataSource.id))
      cleanUp(unusableDataSource.sourceFolder)
      types
        .maxBy(_.chanceOfInboxType(unusableDataSource.sourceFolder))
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
    }
    f.onFailure {
      case e =>
        logger.error("Failed to import dataset: " + e.getMessage, e)
        finishTrackerFor(importTrackerId(unusableDataSource.id), false)
        None
    }
    f
  }
}
