package com.scalableminds.webknossos.datastore.dataformats.zarr

import java.lang.Thread.currentThread
import java.net.URI
import java.nio.file.spi.FileSystemProvider
import java.nio.file.{FileSystem, FileSystemAlreadyExistsException, FileSystems}
import java.nio.{ByteBuffer, ByteOrder}
import java.text.MessageFormat
import java.util.ServiceLoader

import com.google.common.collect.ImmutableMap
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, DataCube}
import com.scalableminds.webknossos.datastore.jzarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Full}

class ZarrCube(zarrArray: ZarrArray) extends DataCube with LazyLogging {

  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]] = {
    val offset = Array(0, 0, bucket.globalZ, bucket.globalY, bucket.globalX)
    val shape = Array(1, 1, bucket.bucketLength, bucket.bucketLength, bucket.bucketLength)
    logger.info("Cut out bucket!")
    Full(toByteArray(zarrArray.read(shape, offset).asInstanceOf[Array[Short]]))
  }

  private def toByteArray(dataShort: Array[Short]): Array[Byte] = {
    val buffer = ByteBuffer.allocate(dataShort.length * 2).order(ByteOrder.LITTLE_ENDIAN)
    buffer.asShortBuffer().put(dataShort)
    buffer.array()
  }

  override protected def onFinalize(): Unit = ()

}

object FileSystemHolder extends LazyLogging {

  def findS3Provider: Option[FileSystemProvider] = {
    val i = ServiceLoader.load(classOf[FileSystemProvider], currentThread().getContextClassLoader).iterator()
    while (i.hasNext) {
      val p = i.next()
      if (p.getScheme.equalsIgnoreCase(s3Uri.getScheme)) {
        return Some(p)
      }
    }
    None
  }

  val s3AccessKey = ""
  val s3SecretKey = ""
  val s3Server = "s3.amazonaws.com"

  val env: ImmutableMap[String, Any] = ImmutableMap
    .builder[String, Any]
    .put(com.upplication.s3fs.AmazonS3Factory.ACCESS_KEY, s3AccessKey)
    .put(com.upplication.s3fs.AmazonS3Factory.SECRET_KEY, s3SecretKey)
    .build

  private val s3Uri = URI.create(MessageFormat.format("s3://{0}", s3Server))
  private val s3UriWithKey = URI.create(MessageFormat.format("s3://{0}@{1}", s3AccessKey, s3Server))

  logger.info(s"Loading file system for uri $s3Uri")

  val s3fs: Option[FileSystem] = try {
    Some(FileSystems.newFileSystem(s3Uri, env, currentThread().getContextClassLoader))
  } catch {
    case e: FileSystemAlreadyExistsException =>
      logger.info("newFileSystem errored:", e)
      try {
        findS3Provider.map(_.getFileSystem(s3UriWithKey))
      } catch {
        case e2: Exception =>
          logger.error("getFileSytem errored:", e2)
          None
      }
  }

  logger.info(s"Loaded file system $s3fs for uri $s3Uri")
}

class ZarrBucketProvider(layer: ZarrLayer) extends BucketProvider with LazyLogging {

  override def loadFromUnderlying(readInstruction: DataReadInstruction): Box[ZarrCube] = {
    val useS3 = true
    FileSystemHolder.s3fs.map { s3fs =>
      val layerPath = if (useS3) {
        s3fs.getPath("/webknossos-zarr/demodata/6001251.zarr/0/")
      } else {
        readInstruction.baseDir
          .resolve(readInstruction.dataSource.id.team)
          .resolve(readInstruction.dataSource.id.name)
          .resolve(readInstruction.dataLayer.name)
      }

      if (useS3 || layerPath.toFile.exists()) {
        logger.info(s"opening: $layerPath")
        Full(ZarrArray.open(layerPath)).map(new ZarrCube(_))
      } else Empty
    }.getOrElse(Empty)
  }

}
