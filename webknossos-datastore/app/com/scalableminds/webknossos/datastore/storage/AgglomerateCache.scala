package com.scalableminds.webknossos.datastore.storage

import ch.systemsx.cisd.hdf5.IHDF5Reader
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.Cube
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage
import net.liftweb.common.{Box, Empty, Failure, Full}
import spire.math.{UByte, UInt, ULong, UShort}

import scala.concurrent.ExecutionContext.Implicits.global

case class CachedReader(reader: IHDF5Reader) extends Cube {
  override def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]] = Empty

  override protected def onFinalize(): Unit = reader.close()
}

case class CachedAgglomerateFile(
    organization: String,
    dataSourceName: String,
    dataLayerName: String,
    agglomerateName: String
)

object CachedAgglomerateFile {

  def from(dataRequest: DataServiceDataRequest): CachedAgglomerateFile =
    storage.CachedAgglomerateFile(dataRequest.dataSource.id.team,
                                  dataRequest.dataSource.id.name,
                                  dataRequest.dataLayer.name,
                                  dataRequest.settings.appliedAgglomerate.get)
}

case class CachedAgglomerate(organization: String,
                             dataSourceName: String,
                             dataLayerName: String,
                             agglomerateName: String,
                             segmentId: Long)

object CachedAgglomerate {
  def from(dataRequest: DataServiceDataRequest, segmentId: Long) =
    storage.CachedAgglomerate(dataRequest.dataSource.id.team,
                              dataRequest.dataSource.id.name,
                              dataRequest.dataLayer.name,
                              dataRequest.settings.appliedAgglomerate.get,
                              segmentId)
}

class AgglomerateFileCache(val maxEntries: Int)
    extends LRUConcurrentCache[CachedAgglomerateFile, Fox[CachedReader]]
    with FoxImplicits {
  override def onElementRemoval(key: CachedAgglomerateFile, value: Fox[CachedReader]): Unit =
    value.map(_.scheduleForRemoval())

  def withCache(dataRequest: DataServiceDataRequest)(
      loadFn: DataServiceDataRequest => Fox[CachedReader]): Fox[CachedReader] = {
    val cachedAgglomerateFile = CachedAgglomerateFile.from(dataRequest)

    def handleUncachedAgglomerateFile() = {
      val readerFox = loadFn(dataRequest).futureBox.map {
        case Full(readerInstance) =>
          if (readerInstance.tryAccess()) Full(readerInstance) else Empty
        case f: Failure =>
          remove(cachedAgglomerateFile)
          f
        case _ =>
          Empty
      }.toFox

      put(cachedAgglomerateFile, readerFox)
      readerFox.map { reader =>
        val result = reader.copy()
        reader.finishAccess()
        result
      }
    }

    get(cachedAgglomerateFile) match {
      case Some(reader) => reader
      case _            => handleUncachedAgglomerateFile()
    }
  }
}

class AgglomerateCache(val maxEntries: Int) extends LRUConcurrentCache[CachedAgglomerate, Fox[Long]] with FoxImplicits {
  val name = "/segment_to_agglomerate"

  def withCache(dataRequest: DataServiceDataRequest, segmentId: Long, cachedFileHandles: AgglomerateFileCache)(
      loadFn: DataServiceDataRequest => Fox[CachedReader]): Fox[Long] = {
    val cachedAgglomerate = CachedAgglomerate.from(dataRequest, segmentId)

    def handleUncachedAgglomerate(): Fox[Long] = {
      val reader = cachedFileHandles.withCache(dataRequest)(loadFn)
      val agglomerateId = dataRequest.dataLayer.elementClass match {
        case ElementClass.uint8 =>
          reader.map(_.reader.uint8().readArrayBlockWithOffset(name, 1, cachedAgglomerate.segmentId).head.toLong)
        case ElementClass.uint16 =>
          reader.map(_.reader.uint16().readArrayBlockWithOffset(name, 1, cachedAgglomerate.segmentId).head.toLong)
        case ElementClass.uint32 =>
          reader.map(_.reader.uint32().readArrayBlockWithOffset(name, 1, cachedAgglomerate.segmentId).head.toLong)
        case ElementClass.uint64 =>
          reader.map(_.reader.uint64().readArrayBlockWithOffset(name, 1, cachedAgglomerate.segmentId).head)
        case _ => Fox.failure("Unsupported data type")
      }

      put(cachedAgglomerate, agglomerateId)
      agglomerateId
    }

    get(cachedAgglomerate) match {
      case Some(agglomerateId) => agglomerateId
      case None                => handleUncachedAgglomerate()
    }
  }
}
