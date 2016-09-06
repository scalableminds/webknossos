/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store

import java.io.{File, FileInputStream, FileNotFoundException, FileOutputStream, InputStream, OutputStream}
import java.nio.file.{Files, Path, Paths}

import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.io.PathUtils

import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import com.scalableminds.braingames.binary.{LoadBlock, MappingRequest, SaveBlock}
import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends DataStore with LazyLogging with FoxImplicits {

  import FileDataStore._
  import DataStore._

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def load(dataInfo: LoadBlock): Fox[Array[Byte]] = {
    val fileSize = dataInfo.dataSource.blockSize * dataInfo.dataLayer.bytesPerElement
    load(knossosBaseDir(dataInfo), dataInfo.dataSource.id, dataInfo.resolution, dataInfo.block, fileSize)
  }

  def load(dataSetDir: Path, dataSetId: String, resolution: Int, block: Point3D, fileSize: Int): Fox[Array[Byte]] = {
    load(knossosFilePath(dataSetDir, dataSetId, resolution, block), Some(fileSize), fuzzyKnossosFile(dataSetDir, dataSetId, resolution, block))
  }

  def load(path: Path, fileSize: Option[Int] = None, fallback: Option[File] = None): Fox[Array[Byte]] = {
    Future {
      try {
        Box(PathUtils.fileOption(path)
          .filter(_.exists())
          .orElse(fallback)
          .map { file =>
            inputStreamToByteArray(new FileInputStream(file), fileSize.getOrElse(file.length().toInt))
          })
      } catch {
        case e: FileNotFoundException =>
          logger.info("File data store couldn't find file: " + path.toAbsolutePath)
          Failure("Couldn't find file: " + e.getMessage, Full(e), Empty)
        case e: Exception =>
          Failure("An exception occurred while trying to load: " + e.getMessage, Full(e), Empty)
      }
    }.recover{
      case e =>
        Failure("An exception on feature occurred while trying to load: " + e.getMessage, Full(e), Empty)
    }
  }

  def load(request: MappingRequest): Fox[Array[Byte]] = {
    load(Paths.get(request.dataLayerMappingPath))
  }

  def save(dataInfo: SaveBlock): Fox[Boolean] = {
    save(knossosBaseDir(dataInfo), dataInfo.dataSource.id, dataInfo.resolution, dataInfo.block, dataInfo.data)
  }

  def save(dataSetDir: Path, dataSetId: String, resolution: Int, block: Point3D, data: Array[Byte]): Fox[Boolean] = {
    Future {
      val path = knossosFilePath(dataSetDir, dataSetId, resolution, block)
      logger.info(s"Attempting write to: $path")
      try {
        PathUtils.parent(path.toAbsolutePath).map(p => Files.createDirectories(p))
        logger.info(s"Attempting write to: $path")
        val binaryStream = Files.newOutputStream(path)
        logger.info("Created FileOutputStream")
        byteArrayToOutputStream(binaryStream, data)
        logger.info("Data was written")
        Full(true)
      } catch {
        case e: FileNotFoundException =>
          logger.error("File datastore couldn't write to file: " + path.toAbsolutePath)
          Failure("Couldn't write to file: " + e)
        case e: Exception =>
          logger.error("Unhandled exception while writing to file: " + e)
          Failure("Unhandled exception while writing to file: " + e)
      }
    }.recover{
      case e =>
        Failure("An exception on feature occurred while trying to load: " + e.getMessage, Full(e), Empty)
    }
  }
}

object FileDataStore {
  /**
   * Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream, dataInfo: LoadBlock): Array[Byte] =
    inputStreamToByteArray(is, dataInfo.dataSource.blockSize * dataInfo.dataLayer.bytesPerElement)

  def inputStreamToByteArray(is: InputStream, size: Int) = {
    val byteArray = new Array[Byte](size)
    is.read(byteArray, 0, size)
    is.close()
    byteArray
  }

  /**
   * Writes bytearray contents to a FileOutputStream
   */
  def byteArrayToOutputStream(os: OutputStream, dataInfo: SaveBlock): Unit =
    byteArrayToOutputStream(os, dataInfo.data)

  def byteArrayToOutputStream(os: OutputStream, data: Array[Byte]): Unit = {
    os.write(data)
    os.close()
  }
}