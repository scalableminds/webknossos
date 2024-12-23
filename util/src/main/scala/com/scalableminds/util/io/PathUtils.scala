package com.scalableminds.util.io

import java.io.File
import java.nio.file.{Path, _}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Failure, Full}
import org.apache.commons.io.FileUtils

import scala.jdk.CollectionConverters.IteratorHasAsScala
import scala.reflect.io.Directory
import scala.util.Random

object PathUtils extends PathUtils

trait PathUtils extends LazyLogging {

  private def directoryFilter(path: Path): Boolean =
    Files.isDirectory(path) && !Files.isHidden(path)

  private def fileFilter(path: Path): Boolean =
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

  def commonPrefix(p1: Path, p2: Path): Path = {
    val elements = p1.iterator.asScala.zip(p2.iterator.asScala).takeWhile(Function.tupled(_ == _)).map(_._1)
    val joined = elements.mkString("/")
    val absoluteIfNeeded = if (p1.startsWith("/")) f"/$joined" else joined
    Paths.get(absoluteIfNeeded)
  }

  def commonPrefix(ps: List[Path]): Path =
    ps.reduce(commonPrefix)

  def fileOption(p: Path): Option[File] =
    if (!Files.isDirectory(p))
      Some(p.toFile)
    else
      None

  private def listDirectoryEntries[A](directory: Path,
                                      maxDepth: Int,
                                      dropCount: Int,
                                      silent: Boolean,
                                      filters: (Path => Boolean)*)(f: Iterator[Path] => Box[A]): Box[A] =
    try {
      val directoryStream = Files.walk(directory, maxDepth, FileVisitOption.FOLLOW_LINKS)
      val r = f(directoryStream.iterator().asScala.drop(dropCount).filter(d => filters.forall(_(d))))
      directoryStream.close()
      r
    } catch {
      case _: AccessDeniedException =>
        val errorMsg = s"Error access denied. Directory: ${directory.toAbsolutePath}"
        if (!silent) {
          logger.warn(errorMsg)
        }
        Failure(errorMsg)
      case _: NoSuchFileException =>
        val errorMsg = s"No such directory. Directory: ${directory.toAbsolutePath}"
        if (!silent) {
          logger.warn(errorMsg)
        }
        Failure(errorMsg)
      case ex: Exception =>
        val errorMsg =
          s"Error: ${ex.getClass.getCanonicalName} - ${ex.getMessage}. Directory: ${directory.toAbsolutePath}"
        if (!silent) {
          logger.warn(ex.getClass.getCanonicalName)
        }
        Failure(errorMsg)
    }

  def containsFile(directory: Path, maxDepth: Int, silent: Boolean, filters: (Path => Boolean)*): Box[Boolean] =
    listDirectoryEntries(directory, maxDepth, dropCount = 0, silent, filters :+ fileFilter _: _*)(r => Full(r.nonEmpty))

  def listDirectories(directory: Path, silent: Boolean, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, 1, 1, silent, filters :+ directoryFilter _: _*)(r => Full(r.toList))

  def listDirectoriesRecursive(directory: Path,
                               silent: Boolean,
                               maxDepth: Int,
                               filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, maxDepth, 0, silent, filters :+ directoryFilter _: _*)(r => Full(r.toList))

  def listFiles(directory: Path, silent: Boolean, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, 1, 1, silent, filters :+ fileFilter _: _*)(r => Full(r.toList))

  def listFilesRecursive(directory: Path,
                         silent: Boolean,
                         maxDepth: Int,
                         filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, maxDepth, 1, silent, filters :+ fileFilter _: _*)(r => Full(r.toList))

  def lazyFileStream[A](directory: Path, silent: Boolean, filters: (Path => Boolean)*)(
      f: Iterator[Path] => Box[A]): Box[A] =
    listDirectoryEntries(directory, 1, 1, silent, filters :+ fileFilter _: _*)(f)

  def lazyFileStreamRecursive[A](directory: Path, silent: Boolean, filters: (Path => Boolean)*)(
      f: Iterator[Path] => Box[A]): Box[A] =
    listDirectoryEntries(directory, Int.MaxValue, 1, silent, filters :+ fileFilter _: _*)(f)

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
  def listDirectoriesRaw(directory: Path): Box[List[Path]] =
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

  /*
   * removes the end of a path, after the last occurrence of any of excludeFromPrefix
   * example:  /path/to/color/layer/that/is/named/color/and/has/files
   *    becomes  /path/to/color/layer/that/is/named/color
   *    if "color" is in excludeFromPrefix
   */
  def cutOffPathAtLastOccurrenceOf(path: Path, cutOffList: List[String]): Path = {
    var lastCutOffIndex = -1
    path.iterator().asScala.zipWithIndex.foreach {
      case (subPath, idx) =>
        cutOffList.foreach(e => {
          if (subPath.toString.contains(e)) {
            lastCutOffIndex = idx
          }
        })
    }
    lastCutOffIndex match {
      case -1 => path
      // subpath(0, 0) is forbidden, therefore we handle this special case ourselves
      case 0 => Paths.get("")
      case i => path.subpath(0, i)
    }
  }

  // Remove a single file name from previously computed common prefix
  def removeSingleFileNameFromPrefix(prefix: Path, fileNames: List[String]): Path = {
    def isFileNameInPrefix(prefix: Path, fileName: String) = prefix.endsWith(Paths.get(fileName).getFileName)

    fileNames match {
      case head :: tail if tail.isEmpty && isFileNameInPrefix(prefix, head) =>
        removeOneName(prefix)
      case _ => prefix
    }
  }

  private def removeOneName(path: Path): Path =
    if (path.getNameCount == 1) {
      Paths.get("")
    } else path.getParent

  def deleteDirectoryRecursively(path: Path): Box[Unit] = {
    val directory = new Directory(new File(path.toString))
    if (!directory.exists)
      Full(())
    else if (directory.deleteRecursively()) {
      Full(())
    } else Failure(f"Failed to delete directory $path")
  }

  // use when you want to move a directory to a subdir of itself. Otherwise, just go for FileUtils.moveDirectory
  def moveDirectoryViaTemp(source: Path, dst: Path): Box[Unit] = tryo {
    val tmpId = Random.alphanumeric.take(10).mkString("")
    val tmpPath = source.getParent.resolve(s".${tmpId}")
    FileUtils.moveDirectory(source.toFile, tmpPath.toFile)
    FileUtils.moveDirectory(tmpPath.toFile, dst.toFile)
  }

  def recurseSubdirsUntil(path: Path, condition: Path => Boolean, maxDepth: Int = 10): Box[Path] = {
    def recurse(p: Path, depth: Int): Box[Path] =
      if (depth > maxDepth) {
        Failure("Max depth reached")
      } else if (condition(p)) {
        Full(p)
      } else {
        val subdirs = listDirectories(p, silent = true)
        subdirs.flatMap { dirs =>
          dirs.foldLeft(Failure("No matching subdir found"): Box[Path]) { (acc, dir) =>
            acc match {
              case Full(_) => acc
              case _       => recurse(dir, depth + 1)
            }
          }
        }
      }
    recurse(path, 0)
  }

}
