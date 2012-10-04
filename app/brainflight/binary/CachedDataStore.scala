package brainflight.binary

import models.DataSet
import brainflight.tools.geometry.Point3D
import play.api.Play.current
import play.api.Play
import brainflight.tools.geometry.Point3D
import models.DataSet
import brainflight.tools.geometry.Cuboid
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import akka.agent.Agent

case class DataBlock( info: DataBlockInformation, data: Data)

case class DataBlockInformation(
    dataSetId: String,
    point: Point3D,
    resolution: Int)
    
case class Data( value: Array[Byte])
    
/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A data store implementation which uses the hdd as data storage
 */
abstract class CachedDataStore(cacheAgent: Agent[Map[DataBlockInformation, Data]]) extends DataStore {

  val conf = Play.configuration
  
  lazy val nullBlock = ( for ( x <- 0 to 128 * 128 * 128 ) yield 0.toByte ).toArray

  // defines the maximum count of cached file handles
  val maxCacheSize = conf.getInt("bindata.cacheMaxSize") getOrElse 100

  // defines how many file handles are deleted when the limit is reached
  val dropCount = conf.getInt("bindata.cacheDropCount") getOrElse 20

  var lastUsed: Option[Tuple2[DataBlockInformation, Data]] = None

  val cacheId = this.hashCode
  /**
   * Uses the coordinates of a point to calculate the data block the point
   * lays in.
   */
  def PointToBlock( point: Point3D, resolution: Int ) =
    Point3D( point.x / 128 / resolution, point.y / 128 / resolution, point.z / 128 / resolution)

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
      val block = PointToBlock( globalPoint, resolution )     
      val blockInfo = DataBlockInformation( dataSet.id, block, resolution )
      
      val byteArray: Array[Byte] =
        ((useLastUsed( blockInfo ) orElse cacheAgent().get( blockInfo )) getOrElse (
              loadAndCacheData( dataSet, block, resolution ) )).value
      
      lastUsed = Some(blockInfo -> Data(byteArray))
       
      byteArray( ( ( globalPoint.z % 128 ) * 128 * 128 + ( globalPoint.y % 128 ) * 128 + globalPoint.x % 128 ) )
    } else {
      return 0
    }
  }
  
  /*
   * Load the binary data of the given coordinate from file
   */
  override def load( dataSet: DataSet, resolution: Int, cube: Cuboid ): Array[Byte] = { 
    if ( dataSet doesContain cube.topLeft ) { 
      val block = PointToBlock( cube.topLeft, resolution )     
      val blockInfo = DataBlockInformation( dataSet.id, block, resolution )
      
      val byteArray: Array[Byte] =
        ((useLastUsed( blockInfo ) orElse cacheAgent().get( blockInfo )) getOrElse {
              loadAndCacheData( dataSet, block, resolution ) }).value
      
      lastUsed = Some(blockInfo -> Data(byteArray))
       
      
      val startX = (cube.topLeft.x / resolution) % 128 
      val startY = (cube.topLeft.y / resolution) % 128 
      val startZ = (cube.topLeft.z / resolution) % 128 
      
      val result = new Array[Byte]( cube.volume )
      
      var idx = 0
      var y = 0
      var z = 0
      var x = startX
      
      val edgeX = cube.edgeLengthX
      val edgeY = cube.edgeLengthY
      val edgeZ = cube.edgeLengthZ
      
      while( x < startX + edgeX){
        y = startY
        while( y < startY + edgeY){
          z = startZ
          while( z < startZ + edgeZ){
            result.update( idx, byteArray( ( z * 128 * 128 + y * 128 + x ) ))
            idx += 1
            z+=1
          } 
          y+=1
        }
        x+=1
      }

      result
    } else {
      new Array[Byte]( cube.volume )
    }
  }
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock( dataSet: DataSet, point: Point3D, resolution: Int ): DataBlock

  def loadAndCacheData( dataSet: DataSet, point: Point3D, resolution: Int ): Data = {
    val block = loadBlock( dataSet, point, resolution)
    cacheAgent send( _ + (block.info -> block.data))
    block.data
  }
  
  /**
   * Function to restrict the cache to a maximum size. Should be
   * called before or after an item got inserted into the cache
   */
  def ensureCacheMaxSize {
    // pretends to flood memory with to many files
    if ( cacheAgent().size > maxCacheSize )
      cacheAgent send( _.drop( dropCount )) 
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
    cacheAgent send( _ => Map.empty )
  }

}