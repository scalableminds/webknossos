package braingames.binary.store

import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import akka.routing.Broadcast
import akka.agent.Agent
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import braingames.binary.LoadBlock

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends DataStore {
  import DataStore._
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def load(dataInfo: LoadBlock): Future[Array[Byte]] = {
    Future {
      try {
        val binaryStream =
          new FileInputStream(createFilename(dataInfo))
        inputStreamToByteArray(binaryStream, dataInfo)

      } catch {
        case e: FileNotFoundException =>
          throw new DataNotFoundException("FILEDATASTORE")
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