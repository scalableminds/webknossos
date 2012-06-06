package brainflight.binary

import collection.mutable.HashMap
import play.api.Play.current
import play.api.Play
import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import com.mongodb.casbah.Imports._
import scala.collection.JavaConverters._
import com.mongodb.casbah.gridfs.Imports._
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
import models.DataSet
import brainflight.tools.geometry.Cube

class GridFileDataStore extends DataStore{
	  //GridFs handle
  val gridfs = GridFS(MongoConnection()("binaryData"))
  
  lazy val nullBlock = (for (x <- 0 to 128 * 128 * 128) yield 0.toByte).toArray
  // defines the maximum count of cached file handles
  val maxCacheSize = 500
  // defines how many file handles are deleted when the limit is reached
  val dropCount = 50
  // try to prevent loading a file multiple times into memory
  var fileCache = new HashMap[Tuple3[Int, Int, Int], Array[Byte]]

  /**
   * Load the binary data of the given coordinate from DB
   */
  override def load(dataSet: DataSet, resolution: Int, cube: Cube): Array[Byte] = {
    //TODO: IMPLEMENT
    new Array[Byte](0)
  }
  override def load(dataSet: DataSet, resolution: Int, globalPoint: Point3D): Byte = {
    // TODO: Insert upper bound
    if (globalPoint.x < 0 || globalPoint.y < 0 || globalPoint.z < 0) return 0

    val x = globalPoint.x / 128
    val y = globalPoint.y / 128
    val z = globalPoint.z / 256
    val point = Point3D(x, y, z) 

    val byteArray: Array[Byte] = fileCache.get((x, y, z)) match {
      case Some(x) =>
        x
      case _ =>
        // pretends to flood memory with to many files
        if (fileCache.size > maxCacheSize)
          fileCache = fileCache.drop(dropCount)
          
        gridfs.findOne(convertCoordinatesToString(point)) match {
          case Some(file) =>     
            val binData = file.sourceWithCodec(scala.io.Codec.ISO8859).map(_.toByte).toArray
            fileCache += (((x,y,z), binData))
            binData
          case None => 
            Logger.info("Did not find file %s".format(createFilename(dataSet, resolution, point)))
            fileCache += (((x,y,z),nullBlock))
            nullBlock
        }
    }
    val zB = (globalPoint.z % 256) / 2
    byteArray((zB * 128 * 128 + (globalPoint.y % 128) * 128 + globalPoint.x % 128))
  }

  def inputStreamToByteArray( is: InputStream ) = {
    val byteArray = new Array[Byte]( 2097152 )
    is.read( byteArray, 0, 2097152 )
    //assert(is.skip(1) == 0, "INPUT STREAM NOT EMPTY")
    byteArray
  }
  
  def addToCache( remoteCacheId: Int, block: DataBlockInformation, data: Array[Byte]) {
    // TODO: implement
  }
  
  def cleanUp(){
    fileCache.clear()
  }
  
  def convertCoordinatesToString(point: Point3D):String = {
    "%04d%04d%04d".format(point.x,point.y,point.z)
  }
  
  private def create(dataSet: DataSet, resolution: Int, point: Point3D):Array[Byte] ={
    try{
      val IS = new FileInputStream(createFilename(dataSet, resolution, point))
      gridfs(IS) { fh=>
      fh.filename = convertCoordinatesToString(point)
      fh.contentType = "application"
      }
      inputStreamToByteArray(IS)
    }
    catch {
      case e: FileNotFoundException =>
        Logger.warn("%s not found!".format(createFilename(dataSet, resolution, point)));
        nullBlock
    }
  }
  

}