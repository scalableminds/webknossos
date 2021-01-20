package com.scalableminds.util.io

import java.io.File
import java.nio.file.{Path, _}

import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}

import scala.collection.JavaConverters._

object PathUtils extends PathUtils

trait PathUtils extends LazyLogging {

  def directoryFilter(path: Path): Boolean =
    Files.isDirectory(path) && !Files.isHidden(path)

  def fileFilter(path: Path): Boolean =
    !Files.isDirectory(path)

  def fileExtensionFilter(ext: String)(path: Path): Boolean =
    path.toString.endsWith(s".$ext")

  def parent(p: Path): Option[Path] =
    Option(p.getParent)

  def createFile(p: Path, failIfExists: Boolean): Boolean =
    try {
      Files.createFile(p)
      true
    } catch {
      case _: FileAlreadyExistsException => !failIfExists
    }

  def isTheSame(p1: Path, p2: Path): Boolean =
    p1.toAbsolutePath.compareTo(p2.toAbsolutePath) == 0

  def commonPrefix(p1: Path, p2: Path): Path =
    Paths.get(p1.iterator.asScala.zip(p2.iterator.asScala).takeWhile(Function.tupled(_ == _)).map(_._1).mkString("/"))

  def commonPrefix(ps: List[Path]): Path =
    ps.reduce(commonPrefix)

  def fileOption(p: Path): Option[File] =
    if (!Files.isDirectory(p))
      Some(p.toFile)
    else
      None

  def listDirectoryEntries[A](directory: Path, maxDepth: Int, dropCount: Int, filters: (Path => Boolean)*)(
      f: Iterator[Path] => Box[A]): Box[A] =
    try {
      val directoryStream = Files.walk(directory, maxDepth, FileVisitOption.FOLLOW_LINKS)
      val r = f(directoryStream.iterator().asScala.drop(dropCount).filter(d => filters.forall(_(d))))
      directoryStream.close()
      r
    } catch {
      case _: AccessDeniedException =>
        val errorMsg = s"Error access denied. Directory: ${directory.toAbsolutePath}"
        logger.error(errorMsg)
        Failure(errorMsg)
      case _: NoSuchFileException =>
        val errorMsg = s"No such directory. Directory: ${directory.toAbsolutePath}"
        logger.error(errorMsg)
        Failure(errorMsg)
      case ex: Exception =>
        val errorMsg =
          s"Error: ${ex.getClass.getCanonicalName} - ${ex.getMessage}. Directory: ${directory.toAbsolutePath}"
        logger.error(ex.getClass.getCanonicalName)
        Failure(errorMsg)
    }

  def listDirectories(directory: Path, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, 1, 1, filters :+ directoryFilter _: _*)(r => Full(r.toList))

  def listDirectoriesRecursive(directory: Path, maxDepth: Int, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, maxDepth, 0, filters :+ directoryFilter _: _*)(r => Full(r.toList))

  def listFiles(directory: Path, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, 1, 1, filters :+ fileFilter _: _*)(r => Full(r.toList))

  def lazyFileStream[A](directory: Path, filters: (Path => Boolean)*)(f: Iterator[Path] => Box[A]): Box[A] =
    listDirectoryEntries(directory, 1, 1, filters :+ fileFilter _: _*)(f)

  def lazyFileStreamRecursive[A](directory: Path, filters: (Path => Boolean)*)(f: Iterator[Path] => Box[A]): Box[A] =
    listDirectoryEntries(directory, Int.MaxValue, 1, filters :+ fileFilter _: _*)(f)

  def ensureDirectory(path: Path): Path = {
    if (!Files.exists(path) || !Files.isDirectory(path))
      Files.createDirectories(path)
    path
  }

  def ensureDirectoryBox(dir: Path): Box[Path] =
    try {
      Full(PathUtils.ensureDirectory(dir))
    } catch {
      case _: AccessDeniedException => Failure("Could not create directory: Access denied")
    }

  // not following symlinks
  def listDirectoriesRaw(directory: Path) = Box[List[Path]] {
    try {
      val directoryStream = Files.walk(directory, 1)
      val r = directoryStream.iterator().asScala.toList
      directoryStream.close()
      Full(r)
    } catch {
      case ex: Exception =>
        val errorMsg =
          s"Error: ${ex.getClass.getCanonicalName} - ${ex.getMessage}. Directory: ${directory.toAbsolutePath}"
        logger.error(ex.getClass.getCanonicalName)
        Failure(errorMsg)
    }
  }

}
