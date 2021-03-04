package oxalis.security

import java.security.SecureRandom
import java.util.Base64

import com.mohiva.play.silhouette.api.util.IDGenerator

import scala.concurrent.{ExecutionContext, Future}

object CompactRandomIDGenerator {
  lazy val random = new SecureRandom()

  def generateBlocking(sizeInBytes: Int = 16): String = {
    val randomValue = new Array[Byte](sizeInBytes)
    CompactRandomIDGenerator.random.nextBytes(randomValue)
    encode(randomValue)
  }

  def encode(bytes: Array[Byte]): String = Base64.getUrlEncoder.withoutPadding.encodeToString(bytes)
}

class CompactRandomIDGenerator(sizeInBytes: Int = 16)(implicit ec: ExecutionContext) extends IDGenerator {

  override def generate: Future[String] = {
    val randomValue = new Array[Byte](sizeInBytes)
    Future(CompactRandomIDGenerator.random.nextBytes(randomValue)).map { _ =>
      CompactRandomIDGenerator.encode(randomValue)
    }
  }

}
