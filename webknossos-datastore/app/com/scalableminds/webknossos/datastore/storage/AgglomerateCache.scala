package com.scalableminds.webknossos.datastore.storage

import java.io.File
import java.nio.file.Paths

import ch.systemsx.cisd.hdf5.{HDF5FactoryProvider, IHDF5Reader}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.AbstractDataLayerMapping
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceDataRequest, DataServiceMappingRequest}
import com.scalableminds.webknossos.datastore.storage
import net.liftweb.common.{Empty, Failure, Full}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.Try

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
    extends LRUConcurrentCache[CachedAgglomerateFile, Fox[IHDF5Reader]]
    with FoxImplicits {
  override def onElementRemoval(key: CachedAgglomerateFile, value: Fox[IHDF5Reader]): Unit = value.map(_.close())

  def withCache(dataRequest: DataServiceDataRequest)(
      loadFn: DataServiceDataRequest => Fox[IHDF5Reader]): Fox[IHDF5Reader] = {
    val cachedAgglomerateFile = CachedAgglomerateFile.from(dataRequest)

    def handleUncachedAgglomerateFile() = {
      val reader = loadFn(dataRequest).futureBox.map {
        case Full(readerInstance) =>
          Full(readerInstance)
        case f: Failure =>
          remove(cachedAgglomerateFile)
          f
        case _ =>
          Empty
      }.toFox

      put(cachedAgglomerateFile, reader)
      reader
    }

    get(cachedAgglomerateFile) match {
      case Some(reader) => reader
      case _            => handleUncachedAgglomerateFile()
    }
  }
}

class AgglomerateCache(val maxEntries: Int) extends LRUConcurrentCache[CachedAgglomerate, Fox[Long]] with FoxImplicits {
  val datasetName = "/segment_to_agglomerate"

  def withCache(dataRequest: DataServiceDataRequest, segmentId: Long, cachedFileHandles: AgglomerateFileCache)(
      loadFn: DataServiceDataRequest => Fox[IHDF5Reader]): Fox[Long] = {
    val cachedAgglomerate = CachedAgglomerate.from(dataRequest, segmentId)

    def handleUncachedAgglomerate(): Fox[Long] = {
      val agglomerateId = cachedFileHandles.withCache(dataRequest)(loadFn).map { reader =>
        reader.uint8().readArrayBlockWithOffset(datasetName, 1, cachedAgglomerate.segmentId).head.toLong
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
