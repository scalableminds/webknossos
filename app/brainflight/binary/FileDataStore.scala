package brainflight.binary

import collection.mutable.HashMap
import play.api.Play.current
import play.api.Play
import play.Logger
import models.Actors._
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.DataSet
import brainflight.tools.geometry.Cube
import akka.routing.Broadcast

case class DataBlockInformation(
    dataSetId: String,
    point: Point3D,
    resolution: Int)
    
/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends DataStore {

  lazy val nullBlock = ( for ( x <- 0 to 128 * 128 * 128 ) yield 0.toByte ).toArray

  // defines the maximum count of cached file handles
  val maxCacheSize = 500

  // defines how many file handles are deleted when the limit is reached
  val dropCount = 50

  // try to prevent loading a file multiple times into memory
  var fileCache = new HashMap[DataBlockInformation, Array[Byte]]
  var lastUsed: Option[Tuple2[DataBlockInformation, Array[Byte]]] = None

  val cacheId = this.hashCode
  /**
   * Uses the coordinates of a point to calculate the data block the point
   * lays in.
   */
  def PointToBlock( point: Point3D ) =
    Point3D( point.x / 128, point.y / 128, point.z / 256 )

  def useLastUsed( blockInfo: DataBlockInformation ) = {
    lastUsed.flatMap{
      case (info, data ) if info == blockInfo => 
        Some(data)
      case _ => 
        None
    }
  }  
    
  /**
   * Load the binary data of the given coordinate from file
   */
  override def load( dataSet: DataSet, resolution: Int, globalPoint: Point3D ): Byte = {
    if ( dataSet doesContain globalPoint ) {
      val block = PointToBlock( globalPoint )     
      val blockInfo = DataBlockInformation( dataSet.id, block, resolution )
      
      val byteArray: Array[Byte] =
        (useLastUsed( blockInfo ) orElse fileCache.get( blockInfo )) getOrElse ( 
              loadBlock( dataSet, block, resolution ) )
      
      lastUsed = Some(blockInfo -> byteArray)
       
      val zB = ( globalPoint.z % 256 ) / 2
      byteArray( ( zB * 128 * 128 + ( globalPoint.y % 128 ) * 128 + globalPoint.x % 128 ) )
    } else {
      return 0
    }
  }
  
  /*
   * Load the binary data of the given coordinate from file
   */
  override def load( dataSet: DataSet, resolution: Int, cube: Cube ): Array[Byte] = { 
    if ( dataSet doesContain cube.topLeft ) { 
      val block = PointToBlock( cube.topLeft )     
      val blockInfo = DataBlockInformation( dataSet.id, block, resolution )
      
      val byteArray: Array[Byte] =
        (useLastUsed( blockInfo ) orElse fileCache.get( blockInfo )) getOrElse ( 
              loadBlock( dataSet, block, resolution ) )
      
      lastUsed = Some(blockInfo -> byteArray)
       
      
      val startX = cube.topLeft.x % 128 
      val startY = cube.topLeft.y % 128 
      val startZ = cube.topLeft.z % 256 
      
      val result = new Array[Byte]( cube.edgeLength*cube.edgeLength*cube.edgeLength )
      
      var idx = 0
      var y = 0
      var z = 0
      var x = startX
      
      while( x < startX + cube.edgeLength){
        y = startY
        while( y < startY + cube.edgeLength){
          z = startZ
          while( z < startZ + cube.edgeLength){
            result.update( idx, byteArray( ( z/2 * 128 * 128 + y * 128 + x ) ))
            idx += 1
            z+=1
          } 
          y+=1
        }
        x+=1
      }

      result
    } else {
      new Array[Byte]( cube.edgeLength*cube.edgeLength*cube.edgeLength )
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
    val blockInfo = DataBlockInformation( dataSet.id, point, resolution )
    fileCache += ( ( blockInfo, dataBlock ) )
    DataSetActor ! Broadcast( CachedFile( cacheId, blockInfo, dataBlock))
    dataBlock
  }

  def addToCache( remoteCacheId: Int, block: DataBlockInformation, data: Array[Byte]){
    if( remoteCacheId != cacheId ){
      fileCache.find{
          case (b, _) if b == block => true
          case _ => false
      } match {
        case Some( (b, d) ) if d.hashCode > data.hashCode => 
          fileCache.update(block, data)
        case None => 
          fileCache += ( (block, data ))
        case Some( (b, d) ) =>
      }
    }
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