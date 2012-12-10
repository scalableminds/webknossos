package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.binary._
import akka.routing.Broadcast
import akka.agent.Agent
    
/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore( cacheAgent: Agent[Map[DataBlockInformation, Data]]) 
  extends CachedDataStore( cacheAgent ){

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock( dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D): DataBlock = {
    ensureCacheMaxSize
    val dataBlock = Data(
      try {
        val binaryStream =
          new FileInputStream( createFilename( dataSet, dataLayer, resolution, block ) )
        inputStreamToByteArray( binaryStream )
      } catch {
        case e: FileNotFoundException =>
          Logger.warn( "Block %s not found!".format( createFilename( dataSet, dataLayer, resolution, block ) ) )
          // if the file block isn't found, a nullBlock is associated with 
          // the coordinates
          nullBlock
      })
    val blockInfo = DataBlockInformation( dataSet.id, dataLayer, resolution, block )
    DataBlock( blockInfo, dataBlock)
  }
}