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
import play.api.libs.concurrent.execution.defaultContext
import scala.concurrent.Future

/**
 * A data store implementation which uses the hdd as data storage
 */
class FileDataStore(cacheAgent: Agent[Map[LoadBlock, Data]])
    extends CachedDataStore(cacheAgent) {
  import DataStore._
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock(dataInfo: LoadBlock): Promise[DataBlock] = {
    ensureCacheMaxSize
    try {
      val dataEnum =
        Enumerator.fromFile(new File(createFilename(dataInfo)))

      val it = Iteratee.consume[Array[Byte]]()

      dataEnum(it).flatMap(_.mapDone { rawData =>
        DataBlock(dataInfo, Data(rawData))
      }.run)
    } catch {
      case e: FileNotFoundException =>
        Future.failed(new DataNotFoundException("FILEDATASTORE"))
    }

  }
}