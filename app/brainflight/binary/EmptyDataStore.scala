package brainflight.binary

import play.api.libs.concurrent.Promise
import scala.concurrent.Future
import akka.agent.Agent
import play.api.Logger

class EmptyDataStore
    extends DataStore {
  val nullBlock = new Array[Byte](DataStore.blockSize)

  def load(blockInfo: LoadBlock): Future[Array[Byte]] = {
    Future.successful {
      nullFile(blockInfo.bytesPerElement)
    }
  }
}