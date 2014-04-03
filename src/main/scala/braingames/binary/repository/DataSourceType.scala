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