package brainflight.binary

import play.api.libs.concurrent.Promise
import scala.collection.mutable.ArrayBuffer
import brainflight.tools.Math._

class EmptyDataStore extends DataStore{
  val nullBlockBuffers = nullArray.map(_.toBuffer.asInstanceOf[ArrayBuffer[Byte]])

  def load(dataRequest: DataRequest) = {
    Promise.pure{
      nullBlockBuffers(log2(dataRequest.layer.bytesPerElement).toInt)
    }
  }
  
  def cleanUp = {
    
  }
}