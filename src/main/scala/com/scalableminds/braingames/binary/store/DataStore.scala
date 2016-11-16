/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store

import java.nio.file.{Path, Paths}

import com.scalableminds.util.io.PathUtils

import scala.concurrent.Future
import akka.actor.Actor

import scala.util._
import scala.concurrent.ExecutionContext.Implicits._
import com.scalableminds.braingames.binary.{DataStoreBlock, LoadBlock, MappingRequest, SaveBlock}
import net.liftweb.common.{Box, Empty, Full}
import com.scalableminds.util.geometry.Point3D
import java.io.{File, FilenameFilter}

import com.scalableminds.util.tools.Fox

/**
  * Abstract Datastore defines all method a binary data source (e.q. normal file
  * system or db implementation) must implement to be used
  */

class DataNotFoundException(message: String) extends Exception(s"$message Could not find the data")

trait DataStore {
  /**
    * Loads the data of a given point from the data source
    */
  def load(dataInfo: LoadBlock): Fox[Array[Byte]]

  /**
    * Saves the data of a given point to the data source
    */
  def save(dataInfo: SaveBlock): Fox[Boolean]

  def load(request: MappingRequest): Fox[Array[Byte]]
}

object DataStore {

  def knossosBaseDir(dataInfo: DataStoreBlock): Path =
    Paths.get(dataInfo.dataLayer.baseDir).resolve(dataInfo.dataLayerSection.baseDir)

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