/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store

import java.nio.file.{Path, Paths}

import com.scalableminds.braingames.binary.MappingRequest
import com.scalableminds.util.geometry.Point3D
import java.io.{File, FilenameFilter, RandomAccessFile}

import com.scalableminds.braingames.binary.models.{DataStoreBlock, LoadBlock, SaveBlock}
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
/**
  * Abstract Datastore defines all method a binary data source (e.q. normal file
  * system or db implementation) must implement to be used
  */

class DataNotFoundException(message: String) extends Exception(s"$message Could not find the data")

trait DataStore {
  /**
    * Loads the data of a given point from the data source
    */
  def load(dataInfo: LoadBlock): Fox[RandomAccessFile]

  /**
    * Saves the data of a given point to the data source
    */
  def save(dataInfo: SaveBlock): Fox[Boolean]

  def load(request: MappingRequest): Fox[Array[Byte]]
}

object DataStore extends LazyLogging{

  def knossosBaseDir(dataInfo: DataStoreBlock): Path =
    Paths.get(dataInfo.dataLayer.baseDir).resolve(dataInfo.dataLayerSection.baseDir)


  def knossosDirToCube(dataInfo: DataStoreBlock, path: Path): Option[(Int, Point3D)] = {
    val rel = Paths.get(dataInfo.dataLayerSection.baseDir).relativize(path)
    if(rel.getNameCount >= 5){
      for{
        resolution <- rel.getName(rel.getNameCount - 5).toString.toIntOpt
        x <- rel.getName(rel.getNameCount - 4).toString.drop(1).toIntOpt
        y <- rel.getName(rel.getNameCount - 3).toString.drop(1).toIntOpt
        z <- rel.getName(rel.getNameCount - 2).toString.drop(1).toIntOpt
      } yield (resolution, Point3D(x,y,z))
    } else {
      None
    }
  }

  private def knossosDir(dataSetDir: Path, resolution: Int, block: Point3D) = {
    val x = "x%04d".format(block.x)
    val y = "y%04d".format(block.y)
    val z = "z%04d".format(block.z)
    dataSetDir.resolve(resolution.toString).resolve(x).resolve(y).resolve(z)
  }

  def knossosFilePath(dataSetDir: Path, id: String, resolution: Int, block: Point3D, fileExt: String): Path = {
    val x = "x%04d".format(block.x)
    val y = "y%04d".format(block.y)
    val z = "z%04d".format(block.z)
    val fileName = s"${id}_mag${resolution}_${x}_${y}_${z}.$fileExt"
    knossosDir(dataSetDir, resolution, block).resolve(fileName)
  }

  def fuzzyKnossosFile(dataSetDir: Path, id: String, resolution: Int, block: Point3D, extensions: List[String]): Option[File] = {
    val dir = knossosDir(dataSetDir, resolution, block)
    Option(dir.toFile.listFiles(new FilenameFilter() {
      override def accept(dir: File, name: String): Boolean = {
        extensions.exists(e => name.endsWith(s".$e"))
      }
    })).getOrElse(Array.empty).headOption
  }
}