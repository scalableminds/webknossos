package com.scalableminds.util.io

import com.scalableminds.util.box.{Box, Failure, Full}
import java.io.File
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.box.Box.tryo
import org.apache.commons.io.FileUtils

import scala.jdk.CollectionConverters.IteratorHasAsScala
import java.nio.file.{
  AccessDeniedException,
  FileAlreadyExistsException,
  FileVisitOption,
  Files,
  NoSuchFileException,
  Path
}
import scala.util.Random

object PathUtils extends LazyLogging {

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
    Path.of(absoluteIfNeeded)
  }

  def commonPrefix(ps: List[Path]): Path =
    if (ps.isEmpty) Path.of("") else ps.reduce(commonPrefix)

  def fileOption(p: Path): Option[File] =
    if (!Files.isDirectory(p))
      Some(p.toFile)
    else
      None

  private def listDirectoryEntries[A](
      directory: Path,
      maxDepth: Int,
      dropCount: Int,
      silent: Boolean,
      filters: (Path => Boolean)*
  )(f: Iterator[Path] => Box[A]): Box[A] =
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
    listDirectoryEntries(directory, maxDepth, dropCount = 0, silent, filters :+ fileFilter*)(r => Full(r.nonEmpty))

  def listDirectories(directory: Path, silent: Boolean, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, 1, 1, silent, filters :+ directoryFilter*)(r => Full(r.toList))

  def listDirectoriesRecursive(
      directory: Path,
      silent: Boolean,
      maxDepth: Int,
      filters: (Path => Boolean)*
  ): Box[List[Path]] =
    listDirectoryEntries(directory, maxDepth, 0, silent, filters :+ directoryFilter*)(r => Full(r.toList))

  def listFiles(directory: Path, silent: Boolean, filters: (Path => Boolean)*): Box[List[Path]] =
    listDirectoryEntries(directory, 1, 1, silent, filters :+ fileFilter*)(r => Full(r.toList))

  def listFilesRecursive(
      directory: Path,
      silent: Boolean,
      maxDepth: Int,
      filters: (Path => Boolean)*
  ): Box[List[Path]] =
    listDirectoryEntries(directory, maxDepth, 1, silent, filters :+ fileFilter*)(r => Full(r.toList))

  def lazyFileStream[A](directory: Path, silent: Boolean, filters: (Path => Boolean)*)(
      f: Iterator[Path] => Box[A]
  ): Box[A] =
    listDirectoryEntries(directory, 1, 1, silent, filters :+ fileFilter*)(f)

  def lazyFileStreamRecursive[A](directory: Path, silent: Boolean, filters: (Path => Boolean)*)(
      f: Iterator[Path] => Box[A]
  ): Box[A] =
    listDirectoryEntries(directory, Int.MaxValue, 1, silent, filters :+ fileFilter*)(f)

  def ensureDirectory(path: Path): Path = {
    if (!Files.exists(path) || !Files.isDirectory(path))
      Files.createDirectories(path)
    path
  }

  def ensureDirectoryBox(dir: Path): Box[Path] =
    try
      Full(PathUtils.ensureDirectory(dir))
    catch {
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

  // Longest common prefix of paths, truncated so it doesn't reach past a boundaryDirNames match,
  // with a lone remaining filename stripped off.
  def findCommonRootDirectory(paths: List[Path], boundaryDirNames: List[String]): Path = {
    val longestCommonPrefix = commonPrefix(paths)
    val truncatedAtLastBoundary = cutOffPathAtLastOccurrenceOf(longestCommonPrefix, boundaryDirNames)
    removeSingleFileNameFromPrefix(truncatedAtLastBoundary, paths)
  }

  // Cuts path off right before the last element that exactly matches a name in boundaryDirNames (path
  // should be relative to the directory the search is limited to, so unrelated elements can't accidentally match).
  private def cutOffPathAtLastOccurrenceOf(path: Path, boundaryDirNames: List[String]): Path = {
    val lastMatchingIndex = path
      .iterator()
      .asScala
      .zipWithIndex
      .collect { case (subPath, idx) if boundaryDirNames.contains(subPath.toString) => idx }
      .toList
      .lastOption
      .getOrElse(-1)
    lastMatchingIndex match {
      case -1 => path
      // subpath(0, 0) is forbidden, therefore we handle this special case ourselves
      case 0 => Path.of("")
      case i =>
        val cutOff = path.subpath(0, i)
        // subpath drops the root element, so re-add it for absolute paths
        Option(path.getRoot).map(_.resolve(cutOff)).getOrElse(cutOff)
    }
  }

  // Strips prefix's last name if it is in fact paths' one lone entry's file name (i.e. commonPrefix of a single file).
  private def removeSingleFileNameFromPrefix(prefix: Path, paths: List[Path]): Path =
    paths match {
      case singlePath :: Nil if prefix.endsWith(singlePath.getFileName) => removeOneName(prefix)
      case _                                                            => prefix
    }

  private def removeOneName(path: Path): Path =
    if (path.getNameCount == 1) {
      Path.of("")
    } else path.getParent

  def deleteDirectoryRecursively(path: Path, enforceContainedIn: Option[Path] = None): Box[Unit] =
    try
      enforceContainedIn match {
        case Some(ancestor) if !isContainedIn(path, ancestor) =>
          Failure(s"Refusing to delete $path: it is not contained within expected parent directory $ancestor")
        case _ =>
          if (Files.exists(path)) {
            FileUtils.deleteDirectory(path.toFile) // Using Apache Commons IO
          }
          Full(())
      }
    catch {
      case ex: Exception => Failure(s"Failed to delete directory $path: ${ex.getMessage}")
    }

  private def isContainedIn(path: Path, parent: Path): Boolean = {
    val normalizedParent = parent.normalize()
    val normalizedPath = path.normalize()
    normalizedPath.startsWith(normalizedParent) && normalizedPath != normalizedParent
  }

  // use when you want to move a directory to a subdir of itself. Otherwise, just go for FileUtils.moveDirectory
  def moveDirectoryViaTemp(source: Path, dst: Path): Box[Unit] = tryo {
    val tmpId = Random.alphanumeric.take(10).mkString("")
    val tmpPath = source.getParent.resolve(s".$tmpId")
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
