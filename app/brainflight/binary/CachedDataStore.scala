package brainflight.binary

import brainflight.tools.geometry.Point3D
import play.api.Play.current
import play.api.Play
import play.api.Logger
import brainflight.tools.geometry.Point3D
import models.binary._
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import akka.agent.Agent
import play.api.libs.concurrent.Promise
import play.api.libs.concurrent.execution.defaultContext
import brainflight.tools.geometry.Vector3D
import brainflight.tools.Interpolator
import play.api.Logger
import scala.collection.mutable.ArrayBuffer

case class DataBlock(info: LoadBlock, data: Data)

case class Data(value: Array[Byte])

/**
 * A data store implementation which uses the hdd as data storage
 */
abstract class CachedDataStore(cacheAgent: Agent[Map[LoadBlock, Data]]) extends DataStore { this: DataStore =>
  
  val conf = Play.current.configuration

  // defines the maximum count of cached file handles
  val maxCacheSize = conf.getInt("bindata.cacheMaxSize") getOrElse 100

  // defines how many file handles are deleted when the limit is reached
  val dropCount = conf.getInt("bindata.cacheDropCount") getOrElse 20
  
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock(blockInfo: LoadBlock): Promise[DataBlock]

  def load(blockInfo: LoadBlock): Promise[Array[Byte]] = {
    cacheAgent().get(blockInfo).map(b => Promise.pure(b.value)).getOrElse{
      ensureCacheMaxSize
      loadBlock(blockInfo).map { block =>
        cacheAgent send (_ + (blockInfo -> block.data))
        block.data.value
      }
    }
  }
    

  /**
   * Function to restrict the cache to a maximum size. Should be
   * called before or after an item got inserted into the cache
   */
  def ensureCacheMaxSize {
    // pretends to flood memory with to many files
    if (cacheAgent().size > maxCacheSize)
      cacheAgent send (_.drop(dropCount))
  }

  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream, bytesPerElement: Int) = {
    val byteCount = elementsPerFile * bytesPerElement
    val byteArray = new Array[Byte](byteCount)
    is.read(byteArray, 0, byteCount)
    //assert(is.skip(1) == 0, "INPUT STREAM NOT EMPTY")
    byteArray
  }

  /**
   * Called when the store is restarted or going to get shutdown.
   */
  def cleanUp() {
    cacheAgent send (_ => Map.empty)
  }

}
