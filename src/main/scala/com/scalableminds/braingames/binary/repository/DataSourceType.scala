/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.Path
import javax.inject.Inject

import com.scalableminds.braingames.binary.DataRequester
import com.scalableminds.braingames.binary.models.{DataSource, UnusableDataSource}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Full}
import play.api.i18n.{Messages, MessagesApi}

trait DataSourceTypeHandler {
  def importDataSource(dataRequester: DataRequester, unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker)(implicit messages: Messages): Fox[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def fileExtension: String

  def chanceOfInboxType(filelist: Stream[Path]) = {
    filelist
      .take(MaxNumberOfFilesForGuessing)
      .count(_.getFileName.toString.endsWith(fileExtension))
      .toFloat / MaxNumberOfFilesForGuessing
  }
}

class DataSourceTypeGuessers(val messagesApi: MessagesApi) extends LazyLogging{
  val types = List(new KnossosDataSourceType(messagesApi), TiffDataSourceType, PngDataSourceType, JpegDataSourceType)
  
  def lazyFileFinder(source: Path, excludeDirs: Seq[String]): Stream[Path] = {
    def isTraversableDirectory(source: Path) = {
      source.toFile.isDirectory && !excludeDirs.contains(source.getFileName.toString) && !source.toFile.isHidden
    }

    PathUtils.listFiles(source) match {
      case Full(files) =>
        files.toStream #::: {
          if (isTraversableDirectory(source)) {
            PathUtils.listDirectories(source) match {
              case Full(dirs) =>
                dirs.toStream.flatMap(d => lazyFileFinder(d, excludeDirs))
              case e =>
                logger.error(s"Failed to list directories for '$source': $e")
                Stream.empty
            }
          }
          else
            Stream.empty
        }
      case e =>
        logger.error(s"Failed to list files for '$source': $e")
        Stream.empty
    }
  }
  
  def guessRepositoryType(source: Path): DataSourceType = {
    val paths = lazyFileFinder(source, Seq("target"))
    types.maxBy(_.chanceOfInboxType(paths))
  }
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}
