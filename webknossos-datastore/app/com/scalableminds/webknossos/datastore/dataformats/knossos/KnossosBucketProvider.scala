package com.scalableminds.webknossos.datastore.dataformats.knossos

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ExtendedTypes.ExtendedRandomAccessFile
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, Cube}
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.lang3.reflect.FieldUtils

import java.io.{FileInputStream, FileNotFoundException, RandomAccessFile}
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Path

class KnossosCube(mappedData: MappedByteBuffer, channel: FileChannel, raf: RandomAccessFile)
    extends Cube
    with LazyLogging {

  // We are using reflection here to access a couple of fields from the underlying mapped byte
  // buffer. Since the whole file will be memory mapped in the byte buffer, we can
  // read-access the buffer from different threads without locking. Using the random access file
  // or the buffer directly would need a mutex around the seeking and reading (as that is not thread safe).
  private val unsafe =
    FieldUtils.readField(mappedData, "unsafe", true)

  private val address =
    FieldUtils.readField(mappedData, "address", true).asInstanceOf[Long]

  private val arrayBaseOffset =
    FieldUtils.readField(mappedData, "arrayBaseOffset", true).asInstanceOf[Long]

  private val unsafeCopy = {
    val m = unsafe.getClass.getDeclaredMethod("copyMemory",
                                              classOf[Object],
                                              classOf[Long],
                                              classOf[Object],
                                              classOf[Long],
                                              classOf[Long])
    m.setAccessible(true)
    m
  }

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]] =
    try {
      val offset: VoxelPosition = bucket.topLeft
      val bytesPerElement = dataLayer.bytesPerElement
      val bucketLength = DataLayer.bucketLength
      val cubeLength = dataLayer.lengthOfUnderlyingCubes(bucket.resolution)
      val bucketSize = bytesPerElement * bucketLength * bucketLength * bucketLength
      val result = new Array[Byte](bucketSize)

      val x = offset.x
      var y = offset.y
      var z = offset.z

      val yMax = offset.y + bucketLength
      val zMax = offset.z + bucketLength

      var idx = 0L
      while (z < zMax) {
        y = offset.y
        while (y < yMax) {
          val cubeOffset =
            (x % cubeLength +
              y % cubeLength * cubeLength +
              z % cubeLength * cubeLength * cubeLength) * bytesPerElement
          copyTo(cubeOffset, result, idx, bucketLength.toLong * bytesPerElement)
          idx += bucketLength * bytesPerElement
          y += 1
        }
        z += 1
      }
      Full(result)
    } catch {
      case e: Exception =>
        logger.error("Failed to cut out bucket: " + e.getMessage)
        Failure("Failed to cut bucket", Full(e), Empty)
    }

  override protected def onFinalize(): Unit = {
    logger.trace(s"Closed file '${raf.getPath}'")
    channel.close()
    raf.close()
  }

  private def copyTo(offset: Long, other: Array[Byte], destPos: Long, length: java.lang.Long): Boolean =
    // Any regularly called log statements in here should be avoided as they drastically slow down this method.
    if (offset + length <= mappedData.limit()) {
      try {
        val memOffset: java.lang.Long = address + offset
        val targetOffset: java.lang.Long = destPos + arrayBaseOffset
        // Anything that might go south here can result in a segmentation fault, so be careful!
        unsafeCopy.invoke(unsafe, null, memOffset, other, targetOffset, length)
        true
      } catch {
        case e: Exception =>
          // It might be tempting, but do not access the file here without synchronized!
          logger.error(s"Failed to read data! Expected length '$length' Offset: $offset. Exception: ${e.getMessage}", e)
          false
      }
    } else {
      false
    }
}

object KnossosCube {

  def apply(file: RandomAccessFile): KnossosCube = {
    val channel = new FileInputStream(file.getPath).getChannel
    val buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size())
    new KnossosCube(buffer, channel, file)
  }
}

class KnossosBucketProvider(layer: KnossosLayer) extends BucketProvider with FoxImplicits with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[KnossosCube] =
    for {
      section <- layer.sections.find(_.doesContainCube(readInstruction.cube))
      knossosFile <- loadKnossosFile(readInstruction, section)
    } yield {
      KnossosCube(knossosFile)
    }

  private def knossosFilePath(readInstruction: DataReadInstruction, section: KnossosSection): Path =
    readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(readInstruction.dataLayer.name)
      .resolve(section.name)
      .resolve(readInstruction.cube.resolution.maxDim.toString)
      .resolve("x%04d".format(readInstruction.cube.x))
      .resolve("y%04d".format(readInstruction.cube.y))
      .resolve("z%04d".format(readInstruction.cube.z))

  private def loadKnossosFile(readInstruction: DataReadInstruction, section: KnossosSection): Box[RandomAccessFile] = {
    val dataDirectory = knossosFilePath(readInstruction, section)
    val knossosFileFilter = PathUtils.fileExtensionFilter(KnossosDataFormat.dataFileExtension) _
    PathUtils.listFiles(dataDirectory, knossosFileFilter).flatMap(_.headOption).flatMap { file =>
      try {
        logger.trace(s"Accessing file: ${file.toAbsolutePath}")
        val r = new RandomAccessFile(file.toString, "r")
        Full(r)
      } catch {
        case _: FileNotFoundException =>
          logger.info(s"DataStore couldn't find file: ${file.toAbsolutePath}")
          Empty
        case e: Exception =>
          Failure(s"An exception occurred while trying to load: ${e.getMessage}")
      }
    }
  }
}
