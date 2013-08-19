package braingames.binary.store

import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import braingames.binary.LoadBlock
import net.liftweb.common.Box
import net.liftweb.common.Failure

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends DataStore {
  import DataStore._
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def load(dataInfo: LoadBlock): Future[Box[Array[Byte]]] = {
    Future {
      try {
        val binaryStream =
          new FileInputStream(createFilename(dataInfo))
        Some(inputStreamToByteArray(binaryStream, dataInfo))
      } catch {
        case e: FileNotFoundException =>
          System.err.println("File datastore couldn't find file: " + createFilename(dataInfo))
          Failure("Couldn't find file: " + e)
      }
    }
  }

  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream, dataInfo: LoadBlock) = {
    val byteArray = new Array[Byte](dataInfo.dataSet.blockSize * dataInfo.dataLayer.bytesPerElement)
    is.read(byteArray, 0, dataInfo.dataSet.blockSize * dataInfo.dataLayer.bytesPerElement)
    //assert(is.skip(1) == 0, "INPUT STREAM NOT EMPTY")
    byteArray
  }
}