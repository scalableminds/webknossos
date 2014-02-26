package braingames.binary.store

import java.io.{ FileNotFoundException, InputStream, OutputStream, FileInputStream, FileOutputStream, File }
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import braingames.binary.{LoadBlock, SaveBlock}
import net.liftweb.common.Box
import net.liftweb.common.Failure
import scalax.file.Path

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends DataStore {
  import DataStore._
  import braingames.binary.Logger._
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
          logger.info("File data store couldn't find file: " + createFilename(dataInfo))
          Failure("Couldn't find file: " + e)
      }
    }
  }

  def save(dataInfo: SaveBlock): Future[Unit] = {
    Future {
      try {
        val path = Path.fromString(createFilename(dataInfo))
        path.doCreateParents()
        val binaryStream =
          new FileOutputStream(path.path)
        byteArrayToOutputStream(binaryStream, dataInfo)
      } catch {
        case e: FileNotFoundException =>
          logger.error("File datastore couldn't write to file: " + createFilename(dataInfo))
          Failure("Couldn't write to file: " + e)
      }
    }
  }

  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream, dataInfo: LoadBlock) = {
    val byteArray = new Array[Byte](dataInfo.dataSource.blockSize * dataInfo.dataLayer.bytesPerElement)
    is.read(byteArray, 0, dataInfo.dataSource.blockSize * dataInfo.dataLayer.bytesPerElement)
    is.close()
    byteArray
  }

  /**
   *  Writes bytearray contents to a FileOutputStream
   */
  def byteArrayToOutputStream(os: OutputStream, dataInfo: SaveBlock) = {
    os.write(dataInfo.data)
    os.close()
  }
}