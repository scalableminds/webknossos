package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.DataSet
import akka.routing.Broadcast
import akka.agent.Agent
import play.api.libs.concurrent.Promise
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.Iteratee
import play.api.libs.concurrent.execution.defaultContext
    
/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore( cacheAgent: Agent[Map[DataBlockInformation, Data]]) 
  extends CachedDataStore( cacheAgent ){

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock(dataSet: DataSet, point: Point3D, resolution: Int): Promise[DataBlock] = {
    val t = System.currentTimeMillis()
    ensureCacheMaxSize
    
    val dataEnum =
      try {
        Enumerator.fromFile(new File(createFilename(dataSet, resolution, point)))
      } catch {
        case e: FileNotFoundException =>
          Logger.warn("Block %s not found!".format(createFilename(dataSet, resolution, point)))
          // if the file block isn't found, a nullBlock is associated with 
          // the coordinates
          Enumerator(nullBlock)
      }
    val it = Iteratee.consume[Array[Byte]]()
    dataEnum(it).flatMap(_.mapDone{ rawData =>
      Logger.trace("Loaded: %d ms ".format(System.currentTimeMillis()-t))
      val blockInfo = DataBlockInformation(dataSet.id, point, resolution)
      DataBlock(blockInfo, Data(rawData))
    }.run)
  }
}