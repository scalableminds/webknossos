package braingames.binary.store

import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits._
import braingames.binary.LoadBlock
import net.liftweb.common.Box
import net.liftweb.common.Failure
import braingames.binary.Logger._
import scalax.file.Path
import braingames.geometry.Point3D


class FileDataStoreActor extends DataStoreActor(new FileDataStore)

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore extends DataStore {
  import FileDataStore._
  import DataStore._
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def load(dataInfo: LoadBlock): Future[Box[Array[Byte]]] = {
    val fileSize = dataInfo.dataSource.blockSize * dataInfo.dataLayer.bytesPerElement
    load(knossosBaseDir(dataInfo), dataInfo.dataSource.id, dataInfo.resolution, dataInfo.block, fileSize)
  }

  def load(dataSetDir: Path, dataSetId: String, resolution: Int, block: Point3D, fileSize: Int): Future[Box[Array[Byte]]] = {
    Future {
      val path = knossosFilePath(dataSetDir, dataSetId, resolution, block)
      try {
        path.fileOption.map{ file =>
          inputStreamToByteArray(new FileInputStream(file), fileSize)
        }
      } catch {
        case e: FileNotFoundException =>
          logger.info("File data store couldn't find file: " + path.toAbsolute.path)
          Failure("Couldn't find file: " + e)
      }
    }
  }
}

object FileDataStore{
  /**
   *  Read file contents to a byteArray
   */
  def inputStreamToByteArray(is: InputStream, dataInfo: LoadBlock): Array[Byte] =
    inputStreamToByteArray(is, dataInfo.dataSource.blockSize * dataInfo.dataLayer.bytesPerElement)

  def inputStreamToByteArray(is: InputStream, size: Int) = {
    val byteArray = new Array[Byte](size)
    is.read(byteArray, 0, size)
    is.close()
    byteArray
  }
}