package brainflight.binary

import collection.mutable.HashMap
import play.api.Play.current
import play.api.Play
import play.Logger
import java.io.{FileNotFoundException, InputStream, FileInputStream, File}

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A store which handles all binary data, the current implementation uses the given file structure on hdd
 */
object DataStore{
  lazy val nullBlock = (for(x<-0 to 128*128*128) yield 0.toByte).toArray
  // defines the maximum count of cached file handles
  val fileBufferLimit = 500
  // binary data ID
  val binaryDataID = Play.configuration.getString("binarydata.id") getOrElse("100527_k0563_mag1")
  // binary data Path
  val dataPath = Play.configuration.getString("binarydata.path") getOrElse("binaryData/")
  // defines how many file handles are deleted when the limit is reached
  val dropCount = 50
  // try to prevent loading a file multiple times into memory
  val fileBuffer = new HashMap[Tuple3[Int,Int,Int],Array[Byte]]

  /**
   * Load the binary data of the given coordinate from file
   */
  def load(point:Tuple3[Int, Int, Int]):Byte={
    // TODO: Insert upper bound
    if(point._1<0 || point._2<0 || point._3<0) return 0

    val x = point._1 / 128
    val y = point._2 / 128
    val z = point._3 / 128

    val byteArray:Array[Byte] = fileBuffer.get((x,y,z)) match {
      case Some(x) =>
        x
      case _ =>
        // pretends to flood memory with to many files
        if(fileBuffer.size>fileBufferLimit)
          fileBuffer.drop(dropCount)
        try{
        	val br = new FileInputStream("%sx%04d/y%04d/z%04d/%s_x%04d_y%04d_z%04d.raw".format(dataPath,x,y,z,binaryDataID,x,y,z))
        	val b = inputStreamToByteArray(br)
        	fileBuffer += (((x, y, z), b))
        	b
        } catch {
          case e: FileNotFoundException => 
          	sys.error("Block %sx%04d/y%04d/z%04d/%s_x%04d_y%04d_z%04d.raw not found!".format(dataPath,x,y,z,binaryDataID,x,y,z))
        	fileBuffer += (((x, y, z), nullBlock))
        	nullBlock
        }
    }
    byteArray(((point._1%128)*16384)+(point._2%128)* 128 + point._3 % 128)
  }

  /**
   *  Read file contents to a byteArray
    */
  def inputStreamToByteArray(is: InputStream) = {
    val b = new Array[Byte](2097152)
    is.read(b,0,2097152)
    b
  }
}