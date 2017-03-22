/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store

import java.io._
import java.nio.file.{Files, Path, Paths}

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.io.PathUtils

import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import com.scalableminds.braingames.binary.MappingRequest
import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.{FilenameUtils, IOUtils}
import org.xerial.snappy.SnappyFramedInputStream

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
  def load(dataInfo: CubeReadInstruction): Fox[RandomAccessFile] = {
    load(knossosBaseDir(dataInfo), dataInfo.dataSource.id, dataInfo.position)
  }

  def load(dataSetDir: Path,
           dataSetId: String,
           cube: CubePosition): Fox[RandomAccessFile] = {
    lazy val fallback = fuzzyKnossosFile(dataSetDir, dataSetId, cube)
    load(knossosFilePath(dataSetDir, dataSetId, cube), fallback)
  }

  private def load(
    path: Path,
    fallback: => Option[File]): Fox[RandomAccessFile] = {

    Future {
      try {
        Box(PathUtils.fileOption(path)
          .filter(_.exists())
          .orElse(fallback)
          .map { file =>
            logger.trace("Accessing file: " + path)
            val t = System.currentTimeMillis
            val r = new RandomAccessFile(file, "r")
            NewRelic.recordResponseTimeMetric("Custom/FileDataStore/files-response-time", System.currentTimeMillis - t)
            NewRelic.incrementCounter("Custom/FileDataStore/files-loaded")
            r
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
    logger.info("Loading mapping file: " + request.dataLayerMappingPath)
    load(Paths.get(request.dataLayerMappingPath), None).map{ f =>
      val document = new Array[Byte](f.length.toInt)
      f.readFully(document)
      document
    }
  }

  def save(dataInfo: BucketWriteInstruction): Fox[Boolean] = {
    save(knossosBaseDir(dataInfo), dataInfo)
  }

  private def copyBucketToCube(outputFile: RandomAccessFile, dataInfo: BucketWriteInstruction) = {
    val bucketPosition = dataInfo.position.topLeft
    val bucketLength = dataInfo.dataLayer.lengthOfLoadedBuckets
    val cubeLength = dataInfo.dataLayer.cubeLength
    val bytesPerElement = dataInfo.dataLayer.bytesPerElement
    val bucketOffset = (bucketPosition.x % cubeLength +
      bucketPosition.y % cubeLength * cubeLength +
      bucketPosition.z % cubeLength * cubeLength * cubeLength) * bytesPerElement
    var y = 0
    var z = 0
    while (z < bucketLength) {
      y = 0
      while (y < bucketLength) {
        val offsetInCubeFile = bucketOffset + (y * cubeLength + z * cubeLength * cubeLength) * bytesPerElement
        outputFile.seek(offsetInCubeFile)
        val dataOffset = (bucketLength * y + bucketLength * bucketLength * z) * bytesPerElement
        outputFile.write(dataInfo.data, dataOffset, bucketLength * bytesPerElement)
        y += 1
      }
      z += 1
    }
  }

  def save(dataSetDir: Path, dataInfo: BucketWriteInstruction): Fox[Boolean] = {
    Future {
      val cubePosition = dataInfo.position.toCube(dataInfo.dataLayer.cubeLength)

      val path = knossosFilePath(dataSetDir, dataInfo.dataSource.id, cubePosition)
      var outputFile: RandomAccessFile = null
      try {
        PathUtils.parent(path.toAbsolutePath).map(p => Files.createDirectories(p))
        outputFile = new RandomAccessFile(path.toFile, "rwd")

        copyBucketToCube(outputFile, dataInfo)
        logger.trace(s"Data was saved. Compressed: false Size: ${dataInfo.data.length} Location: $path")
        Full(true)
      } catch {
        case e: FileNotFoundException =>
          logger.error("File datastore couldn't write to file: " + path.toAbsolutePath)
          Failure("Couldn't write to file: " + e)
        case e: Exception =>
          logger.error("Unhandled exception while writing to file: " + e)
          Failure("Unhandled exception while writing to file: " + e)
      } finally {
        if(outputFile != null) outputFile.close()
      }
    }.recover{
      case e =>
        Failure("An exception on feature occurred while trying to load: " + e.getMessage, Full(e), Empty)
    }
  }
}

object FileDataStore {
  /**
    * Read file contents to a byte array
    */
  def inputStreamToByteArray(is: InputStream): Array[Byte] = {
    val result = IOUtils.toByteArray(is)
    is.close()
    result
  }

  def inputStreamToByteArray(is: InputStream, size: Int): Array[Byte] = {
    val byteArray = new Array[Byte](size)
    IOUtils.read(is, byteArray, 0, size)
    is.close()
    byteArray
  }

  /**
    * Writes byte array contents to a FileOutputStream
    */
  def byteArrayToOutputStream(os: OutputStream, data: Array[Byte]): Unit = {
    IOUtils.write(data, os)
  }
}
