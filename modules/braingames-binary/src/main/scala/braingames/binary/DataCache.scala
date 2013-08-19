package braingames.binary

import akka.agent.Agent
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.concurrent.ExecutionContext.Implicits._
import net.liftweb.common.Box

case class DataBlock(info: LoadBlock, data: Data)

case class Data(val value: Array[Byte]) extends AnyVal

case class CachedBlock(
  dataSetName: String,
  dataLayerId: String,
  dataLayerTyp: String,
  resolution: Int,
  x: Int,
  y: Int,
  z: Int)

object CachedBlock {
  def from(b: LoadBlock) =
    CachedBlock(
      b.dataSet.name,
      b.dataLayerSection.sectionId getOrElse "",
      b.dataLayer.typ,
      b.resolution,
      b.block.x,
      b.block.y,
      b.block.z)
}

/**
 * A data store implementation which uses the hdd as data storage
 */
trait DataCache {
  def cache: Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]]

  // defines the maximum count of cached file handles
  def maxCacheSize: Int

  // defines how many file handles are deleted when the limit is reached
  def dropCount: Int

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def withCache(blockInfo: LoadBlock)(loadF: => Future[Box[Array[Byte]]]): Future[Box[Array[Byte]]] = {
    ensureCacheMaxSize
    val cachedBlockInfo = CachedBlock.from(blockInfo)
    cache().get(cachedBlockInfo).getOrElse {
      val p = loadF
      cache send (_ + (cachedBlockInfo -> p))
      p
    }
  }

  /**
   * Function to restrict the cache to a maximum size. Should be
   * called before or after an item got inserted into the cache
   */
  def ensureCacheMaxSize {
    // pretends to flood memory with to many files
    if (cache().size > maxCacheSize)
      cache send (_.drop(dropCount))
  }

  /**
   * Called when the store is restarted or going to get shutdown.
   */
  def cleanUp() {
    cache send (_ => Map.empty)
  }

}
