package com.scalableminds.webknossos.datastore.storage

import ch.systemsx.cisd.hdf5.{
  HDF5FactoryProvider,
  IHDF5ByteReader,
  IHDF5DoubleReader,
  IHDF5LongReader,
  IHDF5Reader,
  IHDF5ShortReader,
  IHDF5StringReader
}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Failure, Full}
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable
import com.scalableminds.webknossos.datastore.models.datasource.LayerAttachment
import com.scalableminds.webknossos.datastore.services.ArrayArtifactHashing
import com.scalableminds.webknossos.datastore.services.mesh.MeshFileUtils
import com.typesafe.scalalogging.LazyLogging

import java.nio.file.Path
import scala.util.Using

class CachedHdf5File(reader: IHDF5Reader)
    extends SafeCachable
    with AutoCloseable
    with ArrayArtifactHashing
    with MeshFileUtils
    with LazyLogging {

  override protected def onFinalize(): Unit = reader.close()

  override def close(): Unit = this.finishAccess()

  lazy val uint8Reader: IHDF5ByteReader = reader.uint8()
  lazy val uint16Reader: IHDF5ShortReader = reader.uint16()
  lazy val uint64Reader: IHDF5LongReader = reader.uint64()
  lazy val int64Reader: IHDF5LongReader = reader.int64()
  lazy val stringReader: IHDF5StringReader = reader.string()
  lazy val float64Reader: IHDF5DoubleReader = reader.float64()

  // For MeshFile
  lazy val nBuckets: Long = uint64Reader.getAttr("/", attrKeyNBuckets)
  lazy val meshFormat: String = stringReader.getAttr("/", attrKeyMeshFormat)
  lazy val mappingName: String = stringReader.getAttr("/", attrKeyMappingName)

  // For MeshFile and SegmentIndexFile
  lazy val hashFunction: Long => Long = getHashFunction(stringReader.getAttr("/", attrKeyHashFunction))

  lazy val artifactSchemaVersion: Long = int64Reader.getAttr("/", "artifact_schema_version")
}

object CachedHdf5File {
  def fromPath(path: Path): CachedHdf5File = {
    val reader = HDF5FactoryProvider.get.openForReading(path.toFile)
    new CachedHdf5File(reader)
  }
}

class Hdf5FileCache(val maxEntries: Int) extends LRUConcurrentCache[String, CachedHdf5File] {
  override def onElementRemoval(key: String, value: CachedHdf5File): Unit =
    value.scheduleForRemoval()

  def getCachedHdf5File(attachment: LayerAttachment)(loadFn: Path => CachedHdf5File): Box[CachedHdf5File] =
    for {
      localPath <- tryo(attachment.localPath)
    } yield getCachedHdf5File(localPath)(loadFn)

  def getCachedHdf5File(filePath: Path)(loadFn: Path => CachedHdf5File): CachedHdf5File = {
    val fileKey = filePath.toString

    def handleUncachedHdf5File() = {
      val hdf5File = loadFn(filePath)
      // We don't need to check the return value of the `tryAccess` call as we just created the hdf5 file handle and use it only to increase the access counter.
      hdf5File.tryAccess()
      put(fileKey, hdf5File)
      hdf5File
    }

    this.synchronized {
      get(fileKey) match {
        case Some(hdf5File) =>
          if (hdf5File.tryAccess()) hdf5File else handleUncachedHdf5File()
        case _ => handleUncachedHdf5File()
      }
    }
  }

  def withCachedHdf5[T](filePath: Path)(block: CachedHdf5File => T): Box[T] =
    for {
      _ <- if (filePath.toFile.exists()) {
        Full(true)
      } else {
        Failure("mesh.file.open.failed")
      }
      result = Using(this.getCachedHdf5File(filePath)(CachedHdf5File.fromPath)) {
        block
      }
      boxedResult <- result match {
        case scala.util.Success(result) => Full(result)
        case scala.util.Failure(e)      => Failure(e.toString)
      }
    } yield boxedResult

  def withCachedHdf5[T](attachment: LayerAttachment)(block: CachedHdf5File => T): Box[T] =
    for {
      localAttachmentPath <- tryo(attachment.localPath)
      result <- withCachedHdf5(localAttachmentPath)(block)
    } yield result

}
