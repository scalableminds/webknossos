package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import brainflight.tools.geometry.Point3D
import models.binary._
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
    try {
      val dataEnum =
        Enumerator.fromFile(new File(createFilename(dataInfo)))

      val it = Iteratee.consume[Array[Byte]]()

      dataEnum.run(it)
    } catch {
      case e: FileNotFoundException =>
        Future.failed(new DataNotFoundException("FILEDATASTORE"))
    }
  }
}