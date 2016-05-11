/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store

import java.nio.file.{Paths, Path}

import com.scalableminds.util.io.PathUtils

import scala.concurrent.Future
import akka.actor.Actor
import scala.util._
import scala.concurrent.ExecutionContext.Implicits._
import com.scalableminds.braingames.binary.{DataStoreBlock, LoadBlock, SaveBlock, MappingRequest}
import net.liftweb.common.{Full, Empty, Box}
import com.scalableminds.util.geometry.Point3D
import java.io.{File, FilenameFilter}

/**
 * Abstract Datastore defines all method a binary data source (e.q. normal file
 * system or db implementation) must implement to be used
 */

class DataNotFoundException(message: String) extends Exception(s"$message Could not find the data")

class DataStoreActor(dataStore: DataStore) extends Actor {

  def receive = {
    case request: LoadBlock =>
      val s = sender
      dataStore.load(request).onComplete {
        case Failure(e) =>
          s ! net.liftweb.common.Failure(e.getMessage, Full(e), Empty)
        case Success(d) =>
          s ! d
      }

    case request: SaveBlock =>
      val s = sender
      dataStore.save(request).onComplete {
        case Failure(e) =>
          s ! net.liftweb.common.Failure(e.getMessage, Full(e), Empty)
        case Success(d) =>
          s ! d
      }
  }
}

trait DataStore {
  /**
   * Loads the data of a given point from the data source
   */
  def load(dataInfo: LoadBlock): Future[Box[Array[Byte]]]

  /**
   * Saves the data of a given point to the data source
   */
  def save(dataInfo: SaveBlock): Future[Unit]

  def load(request: MappingRequest): Future[Box[Array[Byte]]]
}

object DataStore {

  def createFilename(dataInfo: DataStoreBlock) =
    knossosFilePath(knossosBaseDir(dataInfo), dataInfo.dataSource.id, dataInfo.resolution, dataInfo.block)

  def knossosBaseDir(dataInfo: DataStoreBlock) =
    Paths.get(dataInfo.dataLayer.baseDir).resolve(dataInfo.dataLayerSection.baseDir)

  def knossosDir(dataSetDir: Path, resolution: Int, block: Point3D) = {
    val x = "x%04d".format(block.x)
    val y = "y%04d".format(block.y)
    val z = "z%04d".format(block.z)
    dataSetDir.resolve(resolution.toString).resolve(x).resolve(y).resolve(z)
  }

  def knossosFilePath(dataSetDir: Path, id: String, resolution: Int, block: Point3D) = {
    val x = "x%04d".format(block.x)
    val y = "y%04d".format(block.y)
    val z = "z%04d".format(block.z)
    val fileName = s"${id}_mag${resolution}_${x}_${y}_${z}.raw"
    knossosDir(dataSetDir, resolution, block).resolve(fileName)
  }

  def fuzzyKnossosFile(dataSetDir: Path, id: String, resolution: Int, block: Point3D): Option[File] = {
    val dir = knossosDir(dataSetDir, resolution, block)
    Option(dir.toFile.listFiles(new FilenameFilter() {
      override def accept(dir: File, name: String): Boolean = {
        name.endsWith(".raw")
      }
    })).getOrElse(Array.empty).headOption
  }
}