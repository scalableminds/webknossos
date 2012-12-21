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
class FileDataStore(cacheAgent: Agent[Map[DataBlockInformation, Data]])
    extends CachedDataStore(cacheAgent) {
  import DataStore._
  /**
   * Loads the due to x,y and z defined block into the cache array and
   * returns it.
   */
  def loadBlock(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D): Promise[DataBlock] = {
    ensureCacheMaxSize
    println("loading from FILE " + block)
    try {
      val dataEnum =
        Enumerator.fromFile(new File(createFilename(dataSet, dataLayer, resolution, block)))

      val it = Iteratee.consume[Array[Byte]]()

      dataEnum(it).flatMap(_.mapDone { rawData =>
        val blockInfo = DataBlockInformation(dataSet.id, dataLayer, resolution, block)
        DataBlock(blockInfo, Data(rawData))
      }.run)
    } catch {
      case e: FileNotFoundException =>
        Future.failed(new DataNotFoundException("FILEDATASTORE"))
    }

  }
}