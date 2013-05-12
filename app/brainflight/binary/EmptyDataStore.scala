package brainflight.binary

import scala.concurrent.Future
import akka.agent.Agent

class EmptyDataStore
    extends DataStore {
  val nullBlock = new Array[Byte](DataStore.blockSize)

  def load(blockInfo: LoadBlock): Future[Array[Byte]] = {
    Future.successful {
      nullFile(blockInfo.bytesPerElement)
    }
  }
}