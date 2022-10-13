package com.scalableminds.webknossos.datastore.storage

import ch.systemsx.cisd.hdf5.{HDF5FactoryProvider, IHDF5Reader}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable
import net.liftweb.common.{Box, Failure, Full}

import java.nio.file.Path
import scala.util.Using

case class CachedHdf5File(reader: IHDF5Reader) extends SafeCachable with AutoCloseable {
  override protected def onFinalize(): Unit = reader.close()

  override def close(): Unit = this.finishAccess()
}

object CachedHdf5File {
  def fromPath(path: Path): CachedHdf5File = {
    val reader = HDF5FactoryProvider.get.openForReading(path.toFile)
    CachedHdf5File(reader)
  }
}

class Hdf5FileCache(val maxEntries: Int) extends LRUConcurrentCache[String, CachedHdf5File] {
  override def onElementRemoval(key: String, value: CachedHdf5File): Unit =
    value.scheduleForRemoval()

  def withCache(filePath: Path)(loadFn: Path => CachedHdf5File): CachedHdf5File = {
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
}

object CachedHdf5Utils {
  def executeWithCachedHdf5[T](filePath: Path, meshFileCache: Hdf5FileCache)(block: CachedHdf5File => T): Box[T] =
    for {
      _ <- if (filePath.toFile.exists()) {
        Full(true)
      } else {
        Failure("mesh.file.open.failed")
      }
      result = Using(meshFileCache.withCache(filePath)(CachedHdf5File.fromPath)) {
        block
      }
      boxedResult <- result match {
        case scala.util.Success(result) => Full(result)
        case scala.util.Failure(e)      => Failure(e.toString)
      }
    } yield boxedResult
}
