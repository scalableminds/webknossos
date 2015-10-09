/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path
import com.scalableminds.braingames.binary.models.{UnusableDataSource, DataSource}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import play.api.Logger

trait DataSourceTypeHandler {
  def importDataSource(unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker): Option[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def fileExtension: String

  def chanceOfInboxType(filelist: Stream[Path]) = {
    filelist
      .take(MaxNumberOfFilesForGuessing)
      .filter(_.getFileName.toString.endsWith(fileExtension))
      .size.toFloat / MaxNumberOfFilesForGuessing
  }
}

object DataSourceTypeGuessers extends DataSourceTypes{
  def lazyFileFinder(source: Path, excludeDirs: Seq[String]): Stream[Path] = {
    Logger.trace(s"accessing files of $source")
    Option(PathUtils.listFiles(source)).getOrElse(Nil)
      .toStream #::: {
      if (source.toFile.isDirectory && !excludeDirs.contains(source.getFileName.toString) && !source.toFile.isHidden) {
        Logger.trace(s"accessing direc of $source")
        PathUtils.listDirectories(source).toStream.flatMap(d => lazyFileFinder(d, excludeDirs))
      }
      else
        Stream.empty
    }
  }
  
  def guessRepositoryType(source: Path) = {
    val paths = lazyFileFinder(source, Seq("target"))
    types.maxBy(_.chanceOfInboxType(paths))
  }
}

trait DataSourceTypes{
  val types = List(KnossosDataSourceType, TiffDataSourceType, PngDataSourceType, JpegDataSourceType)
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}
