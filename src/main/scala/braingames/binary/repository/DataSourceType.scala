/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.{PathMatcher, PathSet, Path}
import scala.concurrent.Future
import net.liftweb.common.Box
import braingames.binary.models.{UsableDataSource, DataSourceLike, UnusableDataSource, DataSource}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import braingames.binary.Logger._
import braingames.geometry.Point3D
import braingames.util.ProgressTracking.ProgressTracker
import braingames.util.{InProgress, FoxImplicits, Fox, ProgressTracking}
import net.liftweb.common.{Empty, Full, Failure}

trait DataSourceTypeHandler {
  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def fileExtension: String

  private def lazyFileFinder(source: Path, excludeDirs: Seq[String]): Stream[Path] = {
    def tail = {
      (source * PathMatcher.IsDirectory).filterNot( path => excludeDirs.contains(path.name)).foldLeft(Stream.empty[Path]){
        case (stream, path) =>
          stream ++ lazyFileFinder(path, excludeDirs)
      }
    }
    (source * PathMatcher.IsFile).toStream ++ tail
  }

  def chanceOfInboxType(source: Path) = {
    lazyFileFinder(source, Seq("target"))
      .take(MaxNumberOfFilesForGuessing)
      .filter(_.name.endsWith(fileExtension))
      .size.toFloat / MaxNumberOfFilesForGuessing
  }
}

object DataSourceTypeGuessers extends DataSourceTypes{
  def guessRepositoryType(source: Path) = {
    types.maxBy(_.chanceOfInboxType(source))
  }
}

trait DataSourceTypes{
  val types = List(KnossosDataSourceType, TiffDataSourceType)
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}
