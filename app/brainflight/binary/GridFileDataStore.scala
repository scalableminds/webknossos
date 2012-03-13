package brainflight.binary

import collection.mutable.HashMap
import play.api.Play.current
import play.api.Play
import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import com.mongodb.casbah.Imports._
import scala.collection.JavaConverters._
import com.mongodb.casbah.gridfs.Imports._
import brainflight.tools.ExtendedDataTypes._

object GridFileDataStore extends DataStore{
	  //GridFs handle
  val gridfs = GridFS(MongoConnection()(Play.configuration.getString("mongo.dbname").getOrElse("salat-dao")))
  
  lazy val nullBlock = (for (x <- 0 to 128 * 128 * 128) yield 0.toByte).toArray
  // defines the maximum count of cached file handles
  val maxCacheSize = 500
  // binary data ID
  val binaryDataID = 
    Play.configuration.getString("binarydata.id") getOrElse("100527_k0563_mag1")
  // binary data Path
  val dataPath = 
    Play.configuration.getString("binarydata.path") getOrElse ("binaryData/")
  // defines how many file handles are deleted when the limit is reached
  val dropCount = 50
  // try to prevent loading a file multiple times into memory
  var fileCache = new HashMap[Tuple3[Int, Int, Int], Array[Byte]]

  /**
   * Load the binary data of the given coordinate from DB
   */
  def load(point: Tuple3[Int, Int, Int]): Byte = {
    // TODO: Insert upper bound
    if (point._1 < 0 || point._2 < 0 || point._3 < 0) return 0

    val x = point._1 / 128
    val y = point._2 / 128
    val z = point._3 / 256

    val byteArray: Array[Byte] = fileCache.get((x, y, z)) match {
      case Some(x) =>
        x
      case _ =>
        // pretends to flood memory with to many files
        if (fileCache.size > maxCacheSize)
          fileCache = fileCache.drop(dropCount)
          
        gridfs.findOne(convertCoordinatesToString(x,y,z)) match {
          case Some(file) =>     
            val binData = file.sourceWithCodec(scala.io.Codec.ISO8859).map(_.toByte).toArray
            fileCache += (((x,y,z), binData))
            binData
          case None => 
            Logger.info("Did not find file %s".format(createFilename(x,y,z)))
            fileCache += (((x,y,z),nullBlock))
            nullBlock
        }
    }
    val zB = (point._3 % 256) / 2
    byteArray((zB * 128 * 128 + (point._2 % 128) * 128 + point._1 % 128))
  }

  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream) = {
    val byteArray = new Array[Byte](2097152)
    val bytesRead = is.read(byteArray, 0, 2097152)
    Logger.info("%d bytes read".format(bytesRead))
    //assert(is.skip(1) == 0, "INPUT STREAM NOT EMPTY")
    byteArray
  }
  
  def cleanUp(){
    fileCache.clear()
  }
  
  def createFilename(x: Int, y: Int, z: Int): String = {
	"%s/x%04d/y%04d/z%04d/%s_x%04d_y%04d_z%04d.raw".format(dataPath,x,y,z,binaryDataID,x,y,z) 
  }
  
  def convertCoordinatesToString(x: Int, y: Int, z: Int):String = {
    "%04d%04d%04d".format(x,y,z)
  }
  
  private def create(x: Int, y: Int, z: Int):Array[Byte] ={
    try{
      val IS = new FileInputStream(createFilename(x,y,z))
      gridfs(IS) { fh=>
      fh.filename = convertCoordinatesToString(x,y,z)
      fh.contentType = "application"
      }
      FileDataStore.inputStreamToByteArray(IS)
    }
    catch {
      case e: FileNotFoundException =>
        Logger.warn("%s not found!".format(createFilename(x,y,z)));
        nullBlock
    }
  }
}