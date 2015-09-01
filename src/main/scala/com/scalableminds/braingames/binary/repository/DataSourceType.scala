/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path
import com.scalableminds.braingames.binary.models.{UnusableDataSource, DataSource}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker

trait DataSourceTypeHandler {
  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def fileExtension: String

  private def lazyFileFinder(source: Path, excludeDirs: Seq[String]): Stream[Path] = {
    def tail = {
      PathUtils.listDirectories(source).filterNot( path => excludeDirs.contains(path.getFileName.toString)).foldLeft(Stream.empty[Path]){
        case (stream, path) =>
          stream ++ PathUtils.listFiles(path) ++ lazyFileFinder(path, excludeDirs)
      }
    }
    PathUtils.listFiles(source).toStream ++ tail
  }

  def chanceOfInboxType(source: Path) = {
    lazyFileFinder(source, Seq("target"))
      .take(MaxNumberOfFilesForGuessing)
      .filter(_.getFileName.toString.endsWith(fileExtension))
      .size.toFloat / MaxNumberOfFilesForGuessing
  }
}

object DataSourceTypeGuessers extends DataSourceTypes{
  def guessRepositoryType(source: Path) = {
    types.maxBy(_.chanceOfInboxType(source))
  }
}

trait DataSourceTypes{
  val types = List(KnossosDataSourceType, TiffDataSourceType, PngDataSourceType, JpegDataSourceType)
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}
