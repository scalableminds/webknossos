package oxalis.security

import java.security.SecureRandom
import java.util.Base64

import com.mohiva.play.silhouette.api.util.IDGenerator

import scala.concurrent.{ExecutionContext, Future}

object CompactSecureRandomIDGenerator {
  lazy val random = new SecureRandom()
}

class CompactSecureRandomIDGenerator(sizeInBytes: Int = 16)(implicit ec: ExecutionContext) extends IDGenerator {

  override def generate: Future[String] = {
    val randomValue = new Array[Byte](sizeInBytes)
    Future(CompactSecureRandomIDGenerator.random.nextBytes(randomValue)).map { _ =>
      encode(randomValue)
    }
  }

  def generateBlocking = {
    val randomValue = new Array[Byte](sizeInBytes)
    CompactSecureRandomIDGenerator.random.nextBytes(randomValue)
    encode(randomValue)
  }

  private def encode(bytes: Array[Byte]) = Base64.getUrlEncoder.withoutPadding.encodeToString(bytes)

}
