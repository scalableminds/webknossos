/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.io

import play.api.Logger
import java.io.{File, FilenameFilter}
import java.nio.file
import java.nio.file._
import scala.collection.breakOut
import scala.collection.JavaConverters._

object PathUtils extends PathUtils

trait PathUtils {

  val directoryFilter = new FilenameFilter {
    override def accept(dir: File, name: String): Boolean = {
      val f = new File(dir, name)
      f.isDirectory && !f.isHidden
    }
  }

  val fileFilter = new FilenameFilter {
    override def accept(f: File, name: String): Boolean =
      new File(f, name).isFile
  }

  def createFile(p: Path, failIfExists: Boolean) = {
    try{
      Files.createFile(p)
      true
    } catch{
      case e: FileAlreadyExistsException => !failIfExists
    }
  }

  def isTheSame(p1: Path, p2: Path) =
    p1.toAbsolutePath.compareTo(p2.toAbsolutePath) == 0

  def fileOption(p: Path): Option[File] =
    if(!Files.isDirectory(p))
      Some(p.toFile)
    else
      None

  def parent(p: Path): Option[Path] =
    Option(p.getParent)

  def listDirectories(p: Path): List[Path] =
    if (Files.isDirectory(p)){
      val dirs = p.toFile.list(directoryFilter)
      if(dirs != null) {
        dirs.map(s => p.resolve(s))(breakOut)
      } else {
        System.err.println("Failed to list files in directory: " + p.toString)
        Nil
      }
    }
      
    else
      Nil

  def listFiles(directory: Path): List[Path] = {
    try {
      val directoryStream = Files.newDirectoryStream(directory)

      val r = directoryStream.iterator().asScala.toList
      directoryStream.close()
      r.filter(_.toFile.isFile)
    } catch {
      case ex =>
        Logger.error("Failed to list files for directory: " + directory.toAbsolutePath)
        Nil
    }
  }

  def ensureDirectory(path: Path): Path = {
    if (!Files.exists(path) || !Files.isDirectory(path))
      Files.createDirectories(path)
    path
  }
}
