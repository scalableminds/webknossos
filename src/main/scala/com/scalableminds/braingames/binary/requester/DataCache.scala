/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester

import com.newrelic.api.agent.NewRelic
import com.scalableminds.braingames.binary.models.{DataStoreBlock, LoadBlock}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext.Implicits._

case class Data(value: Array[Byte]) extends AnyVal

case class CachedBlock(
                        id: String,
                        dataLayerId: String,
                        dataLayerName: String,
                        dataLayerBaseDir: String,
                        resolution: Int,
                        x: Int,
                        y: Int,
                        z: Int)

object CachedBlock {
  def from(b: DataStoreBlock): CachedBlock =
    CachedBlock(
                 b.dataSource.id,
                 b.dataLayerSection.sectionId,
                 b.dataLayer.name,
                 b.dataLayer.baseDir,
                 b.resolution,
                 b.block.x,
                 b.block.y,
                 b.block.z)
}

/**
  * A data store implementation which uses the hdd as data storage
  */
trait DataCache {
  def cache: LRUConcurrentCache[CachedBlock, Array[Byte]]

  /**
    * Loads the due to x,y and z defined block into the cache array and
    * returns it.
    */
  def withCache(blockInfo: LoadBlock)(loadF: => Fox[Array[Byte]]): Fox[Array[Byte]] = {
    val cachedBlockInfo = CachedBlock.from(blockInfo)

    cache.get(cachedBlockInfo) match {
      case Some(s) =>
        NewRelic.incrementCounter("Custom/FileDataStore/Cache/hit")
        Fox.successful(s)
      case _ =>
        val p = loadF
        loadF.foreach { block: Array[Byte] =>
          NewRelic.recordMetric("Custom/FileDataStore/Cache/size", cache.size())
          NewRelic.incrementCounter("Custom/FileDataStore/Cache/miss")
          cache.put(cachedBlockInfo, block)
        }
        p
    }
  }

  /**
    * Called when the store is restarted or going to get shutdown
    */
  def cleanUp(): Unit = {
    cache.clear()
  }
}
