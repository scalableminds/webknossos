package brainflight.binary

import play.Logger
import models.Actors._
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.DataSet
import brainflight.tools.geometry.Cube
import akka.routing.Broadcast
    
/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends CachedDataStore {

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock( dataSet: DataSet, point: Point3D, resolution: Int ): Array[Byte] = {
    ensureCacheMaxSize
    val dataBlock =
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
      }
    val blockInfo = DataBlockInformation( dataSet.id, point, resolution )
    fileCache += ( ( blockInfo, dataBlock ) )
    DataSetActor ! Broadcast( CachedFile( cacheId, blockInfo, dataBlock))
    dataBlock
  }
}