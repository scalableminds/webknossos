package com.scalableminds.webknossos.datastore.storage

import ch.systemsx.cisd.hdf5.IHDF5Reader
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.{Cube, SafeCachable}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.Json
import spire.math.{UByte, UInt, ULong, UShort}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.Try

case class CachedReader(reader: IHDF5Reader) extends SafeCachable {
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

case class CachedAgglomerateKey(organization: String,
                                dataSourceName: String,
                                dataLayerName: String,
                                agglomerateName: String,
                                segmentId: Long)

object CachedAgglomerateKey {
  def from(dataRequest: DataServiceDataRequest, segmentId: Long) =
    storage.CachedAgglomerateKey(dataRequest.dataSource.id.team,
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
      readerFox
    }

    get(cachedAgglomerateFile) match {
      case Some(reader) => reader
      case _            => handleUncachedAgglomerateFile()
    }
  }
}

class AgglomerateCache(val maxEntries: Int)
    extends LRUConcurrentCache[CachedAgglomerateKey, Fox[Long]]
    with FoxImplicits {

  def withCache(dataRequest: DataServiceDataRequest, segmentId: Long, cachedFileHandles: AgglomerateFileCache)(
      readFromFile: (IHDF5Reader, Long) => Fox[Long])(
      loadReader: DataServiceDataRequest => Fox[CachedReader]): Fox[Long] = {
    val cachedAgglomerateKey = CachedAgglomerateKey.from(dataRequest, segmentId)

    def handleUncachedAgglomerate(): Fox[Long] = {
      def getAgglomerateId() =
        for {
          cachedReader <- cachedFileHandles.withCache(dataRequest)(loadReader)
          agglomerateId <- readFromFile(cachedReader.reader, segmentId)
          _ = cachedReader.finishAccess()
        } yield agglomerateId

      val checkedAgglomerateId = getAgglomerateId().futureBox.map {
        case Full(id)   => Full(id)
        case f: Failure => remove(cachedAgglomerateKey); f
        case _          => Empty
      }.toFox

      put(cachedAgglomerateKey, checkedAgglomerateId)
      checkedAgglomerateId
    }

    get(cachedAgglomerateKey) match {
      case Some(agglomerateId) => agglomerateId
      case None                => handleUncachedAgglomerate()
    }
  }
}
