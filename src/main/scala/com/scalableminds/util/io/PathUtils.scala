/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.io

import java.io.{File, FilenameFilter}
import java.nio.file._

import net.liftweb.common.{Box, Failure, Full}
import com.typesafe.scalalogging.LazyLogging

import scala.collection.JavaConverters._

object PathUtils extends PathUtils

trait PathUtils extends LazyLogging {

  private def directoryFilter(path: Path) = {
    Files.isDirectory(path) && !Files.isHidden(path)
  }

  private def fileFilter(path: Path) = {
    !Files.isDirectory(path)
  }

  def parent(p: Path): Option[Path] =
    Option(p.getParent)

  def createFile(p: Path, failIfExists: Boolean): Boolean = {
    try {
      Files.createFile(p)
      true
    } catch {
      case e: FileAlreadyExistsException => !failIfExists
    }
  }

  def isTheSame(p1: Path, p2: Path): Boolean =
    p1.toAbsolutePath.compareTo(p2.toAbsolutePath) == 0

  def fileOption(p: Path): Option[File] =
    if (!Files.isDirectory(p))
      Some(p.toFile)
    else
      None

  def listDirectoryEntries(directory: Path, recursive: Boolean, filterPred: Path => Boolean): Box[List[Path]] = {
    try {
      val maxDepth = if (recursive) Int.MaxValue else 1
      val directoryStream = Files.walk(directory, maxDepth, FileVisitOption.FOLLOW_LINKS)
      val r = directoryStream.iterator().asScala.drop(1).filter(filterPred).toList
      directoryStream.close()
      Full(r)
    } catch {
      case ex: AccessDeniedException =>
        val errorMsg = s"Error access denied. Directory: ${directory.toAbsolutePath}"
        logger.error(errorMsg)
        Failure(errorMsg)
      case ex: Exception =>
        val errorMsg = s"Error: ${ex.getMessage }. Directory: ${directory.toAbsolutePath}"
        logger.error(errorMsg)
        Failure(errorMsg)
    }
  }

  def listDirectories(directory: Path, recursive: Boolean = false): Box[List[Path]] =
    listDirectoryEntries(directory, recursive, directoryFilter)

  def listFiles(directory: Path, recursive: Boolean = false): Box[List[Path]] =
    listDirectoryEntries(directory, recursive, fileFilter)

  def ensureDirectory(path: Path): Path = {
    if (!Files.exists(path) || !Files.isDirectory(path))
      Files.createDirectories(path)
    path
  }
}
