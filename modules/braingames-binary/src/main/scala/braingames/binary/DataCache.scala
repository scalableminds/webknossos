package braingames.binary

import akka.agent.Agent
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.concurrent.ExecutionContext.Implicits._

case class DataBlock(info: LoadBlock, data: Data)

case class Data(val value: Array[Byte]) extends AnyVal

/**
 * A data store implementation which uses the hdd as data storage
 */
trait DataCache {
  def cache: Agent[Map[LoadBlock, Future[Array[Byte]]]]

  // defines the maximum count of cached file handles
  def maxCacheSize: Int

  // defines how many file handles are deleted when the limit is reached
  def dropCount: Int

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def withCache(blockInfo: LoadBlock)(loadF: => Future[Array[Byte]]): Future[Array[Byte]] = {
    ensureCacheMaxSize
    cache().get(blockInfo).getOrElse {
      val p = loadF
      cache send (_ + (blockInfo -> p))
      p.onFailure {
        case e =>
          println(s"WARN: (${blockInfo.x}, ${blockInfo.y}, ${blockInfo.z}) DataStore couldn't load block: ${e.toString}")
      }
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
