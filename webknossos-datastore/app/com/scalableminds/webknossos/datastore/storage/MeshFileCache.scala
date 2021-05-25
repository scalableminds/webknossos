package com.scalableminds.webknossos.datastore.storage

import java.nio.file.Path

import ch.systemsx.cisd.hdf5.IHDF5Reader
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.dataformats.SafeCachable

case class CachedMeshFile(reader: IHDF5Reader) extends SafeCachable {
  override protected def onFinalize(): Unit = reader.close()
}

class MeshFileCache(val maxEntries: Int) extends LRUConcurrentCache[String, CachedMeshFile] {
  override def onElementRemoval(key: String, value: CachedMeshFile): Unit =
    value.scheduleForRemoval()

  def withCache(filePath: Path)(loadFn: Path => CachedMeshFile): CachedMeshFile = {
    val fileKey = filePath.toString

    def handleUncachedMeshFile() = {
      val meshFile = loadFn(filePath)
      // We don't need to check the return value of the `tryAccess` call as we just created the mesh file and use it only to increase the access counter.
      meshFile.tryAccess()
      put(fileKey, meshFile)
      meshFile
    }

    this.synchronized {
      get(fileKey) match {
        case Some(meshFile) =>
          if (meshFile.tryAccess()) meshFile else handleUncachedMeshFile()
        case _ => handleUncachedMeshFile()
      }
    }
  }
}
