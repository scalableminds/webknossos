package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.DataSet
import akka.routing.Broadcast
import akka.agent.Agent
    
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
  def loadBlock( dataSet: DataSet, point: Point3D, resolution: Int ): DataBlock = {
    ensureCacheMaxSize
    val dataBlock = Data(
      try {
        val binaryStream =
          new FileInputStream( createFilename( dataSet, resolution, point ) )
        inputStreamToByteArray( binaryStream )
      } catch {
        case e: FileNotFoundException =>
          Logger.warn( "Block %s not found!".format( createFilename( dataSet, resolution, point ) ) )
          // if the file block isn't found, a nullBlock is associated with 
          // the coordinates
          nullBlock
      })
    val blockInfo = DataBlockInformation( dataSet.id, point, resolution )
    DataBlock( blockInfo, dataBlock)
  }
}