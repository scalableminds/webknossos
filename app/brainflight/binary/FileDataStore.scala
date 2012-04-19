package brainflight.binary

import collection.mutable.HashMap
import play.api.Play.current
import play.api.Play
import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.DataSet

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A data store implementation which uses the hdd as data storage
 */
object FileDataStore extends DataStore {
  case class DataBlockInformation(
    dataSetId: String,
    point: Point3D,
    resolution: Int )

  lazy val nullBlock = ( for ( x <- 0 to 128 * 128 * 128 ) yield 0.toByte ).toArray

  // defines the maximum count of cached file handles
  val maxCacheSize = 500

  // defines how many file handles are deleted when the limit is reached
  val dropCount = 50

  // try to prevent loading a file multiple times into memory
  var fileCache = new HashMap[DataBlockInformation, Array[Byte]]

  /**
   * Uses the coordinates of a point to calculate the data block the point
   * lays in.
   */
  def extractBlockCoordinates( point: Point3D ) =
    Point3D( point.x / 128, point.y / 128, point.z / 256 )

  /**
   * Load the binary data of the given coordinate from file
   */
  override def load( dataSet: DataSet, resolution: Int )( globalPoint: Point3D ): Byte = {
    if ( dataSet doesContain globalPoint ) {
      val point = extractBlockCoordinates( globalPoint )

      val byteArray: Array[Byte] =
        fileCache.get( DataBlockInformation( dataSet.id, point, resolution ) ) getOrElse ( loadBlock( dataSet, point, resolution ) )

      val zB = ( globalPoint.z % 256 ) / 2
      byteArray( ( zB * 128 * 128 + ( globalPoint.y % 128 ) * 128 + globalPoint.x % 128 ) )
    } else {
      return 0
    }
  }

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
    fileCache += ( ( DataBlockInformation( dataSet.id, point, resolution ), dataBlock ) )
    dataBlock
  }

  /**
   * Function to restrict the cache to a maximum size. Should be
   * called before or after an item got inserted into the cache
   */
  def ensureCacheMaxSize {
    // pretends to flood memory with to many files
    if ( fileCache.size > maxCacheSize )
      fileCache = fileCache.drop( dropCount )
  }

  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray( is: InputStream ) = {
    val byteArray = new Array[Byte]( 2097152 )
    is.read( byteArray, 0, 2097152 )
    //assert(is.skip(1) == 0, "INPUT STREAM NOT EMPTY")
    byteArray
  }

  /**
   * Called when the store is restarted or going to get shutdown.
   */
  def cleanUp() {
    fileCache.clear()
  }

}