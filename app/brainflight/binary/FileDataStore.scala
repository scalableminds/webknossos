package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import akka.routing.Broadcast
import akka.agent.Agent
import play.api.libs.concurrent.Promise
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.Iteratee
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future

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
        inputStreamToByteArray(binaryStream)

      } catch {
        case e: FileNotFoundException =>
          throw new DataNotFoundException("FILEDATASTORE")
      }
    }
  }

  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream) = {
    val byteArray = new Array[Byte](2097152)
    is.read(byteArray, 0, 2097152)
    //assert(is.skip(1) == 0, "INPUT STREAM NOT EMPTY")
    byteArray
  }
}