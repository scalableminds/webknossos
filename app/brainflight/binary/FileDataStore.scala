package brainflight.binary

import collection.mutable.HashMap
import play.api.Play.current
import play.api.Play
import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }

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

  // Data block containing only zero-byte values
  lazy val nullBlock = ( for ( x <- 0 to 128 * 128 * 128 ) yield 0.toByte ).toArray
  // defines the maximum count of cached file handles
  val maxCacheSize = 500
  // binary data ID
  val binaryDataID =
    Play.configuration.getString( "binarydata.id" ) getOrElse ( "100527_k0563_mag1" )
  // binary data Path
  val dataPath =
    Play.configuration.getString( "binarydata.path" ) getOrElse ( "binaryData/" )
  // defines how many file handles are deleted when the limit is reached
  val dropCount = 50
  // try to prevent loading a file multiple times into memory
  var fileCache = new HashMap[Tuple3[Int, Int, Int], Array[Byte]]

  /**
   * Uses the coordinates of a point to calculate the data block the point
   * lays in.
   */
  def extractBlockCoordinates( point: Tuple3[Int, Int, Int] ) =
    ( point._1 / 128, point._2 / 128, point._3 / 256 )

  /**
   * Load the binary data of the given coordinate from file
   */
  def load( point: Tuple3[Int, Int, Int] ): Byte = {
    if ( isInsideBinaryDataSet( point ) ) {
      val ( x, y, z ) = extractBlockCoordinates( point )

      val byteArray: Array[Byte] =
        fileCache.get( ( x, y, z ) ) getOrElse ( loadBlock( x, y, z ) )

      val zB = ( point._3 % 256 ) / 2
      byteArray( ( zB * 128 * 128 + ( point._2 % 128 ) * 128 + point._1 % 128 ) )
    } else {
      return 0
    }
  }

  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock( x: Int, y: Int, z: Int ): Array[Byte] = {
    ensureCacheMaxSize
    val dataBlock =
      try {
        val binaryStream = new FileInputStream(
          "%sx%04d/y%04d/z%04d/%s_x%04d_y%04d_z%04d.raw".
            format( dataPath, x, y, z, binaryDataID, x, y, z ) )
        inputStreamToByteArray( binaryStream )
      } catch {
        case e: FileNotFoundException =>
          Logger.warn(
            "Block %sx%04d/y%04d/z%04d/%s_x%04d_y%04d_z%04d.raw not found!".
              format( dataPath, x, y, z, binaryDataID, x, y, z ) )
          // if the file block isn't found, a nullBlock is associated with 
          // the coordinates
          nullBlock
      }
    fileCache += ( ( ( x, y, z ), dataBlock ) )
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
   * Checks if a point is inside the whole data set boundary.
   */
  def isInsideBinaryDataSet( point: Tuple3[Int, Int, Int] ) =
    // TODO: insert upper bound
    point._1 >= 0 && point._2 >= 0 && point._3 >= 0

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