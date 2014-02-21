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
import braingames.binary.repository.ProgressTracking.ProgressTracker
import scala.collection.immutable.Queue
import braingames.util.ExtendedTypes.CappedQueue

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

object ProgressTracking {

  trait ProgressTracker {
    def track(d: Double): Unit
  }

}

trait ProgressTracking {
  private val progress = Agent[Map[String, Double]](Map.empty)

  val finishedProgress = Agent[Queue[(String, Finished)]](Queue.empty)

  val Max = 50

  trait ProgressState

  case class Finished(success: Boolean) extends ProgressState

  case class InProgress(progress: Double) extends ProgressState

  case object NotStarted extends ProgressState

  protected class ProgressTrackerImpl(key: String) extends ProgressTracker {
    def track(d: Double): Unit = {
      progress.send(_ + (key -> d))
    }
  }

  protected def progressFor(key: String): ProgressState =
    progress()
      .get(key)
      .map(InProgress(_))
      .orElse(finishedProgress().find(_._1 == key).map(_._2))
      .getOrElse(NotStarted)

  protected def progressTrackerFor(key: String) =
    new ProgressTrackerImpl(key)

  protected def finishTrackerFor(key: String, success: Boolean): Unit = {
    progress.send(_ - key)
    finishedProgress.send( _.enqueueCapped(key -> Finished(success), Max))
  }

  protected def clearAllTrackers(key: String): Unit = {
    progress.send(_ - key)
    finishedProgress.send(_.filterNot(_._1 == key))
  }
}

object DataSourceRepository extends ProgressTracking {

  val dataSources = Agent[List[DataSourceLike]](Nil)

  val types = List(KnossosDataSourceType, TiffDataSourceType)

  val DataSourceJson = "datasource.json"

  def guessRepositoryType(source: Path) =
    types.maxBy(_.chanceOfInboxType(source))

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

  def transformToDataSource(unusableDataSource: UnusableDataSource): Future[Option[UsableDataSource]] = Future {
    clearAllTrackers(importTrackerId(unusableDataSource.id))
    types
      .maxBy(_.chanceOfInboxType(unusableDataSource.sourceFolder))
      .importDataSource(unusableDataSource, progressTrackerFor(importTrackerId(unusableDataSource.id)))
      .flatMap {
      dataSource =>
        finishTrackerFor(importTrackerId(unusableDataSource.id), true)
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
}
