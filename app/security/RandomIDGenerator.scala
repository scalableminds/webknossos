package security

import java.security.SecureRandom
import java.util.Base64

import play.silhouette.api.util.IDGenerator

import scala.concurrent.{ExecutionContext, Future}

object RandomIDGenerator {
  lazy val random = new SecureRandom()

  def generateBlocking(sizeInBytes: Int = 16, useHex: Boolean = false): String = {
    val randomValue = new Array[Byte](sizeInBytes)
    RandomIDGenerator.random.nextBytes(randomValue)
    encode(randomValue, useHex)
  }

  def encode(bytes: Array[Byte], useHex: Boolean): String =
    if (useHex) {
      bytes.map("%02x".format(_)).mkString
    } else {
      Base64.getUrlEncoder.withoutPadding.encodeToString(bytes)
    }
}

class RandomIDGenerator(sizeInBytes: Int = 16, useHex: Boolean = false)(implicit ec: ExecutionContext)
    extends IDGenerator {

  override def generate: Future[String] = {
    val randomValue = new Array[Byte](sizeInBytes)
    Future(RandomIDGenerator.random.nextBytes(randomValue)).map { _ =>
      RandomIDGenerator.encode(randomValue, useHex)
    }
  }

}
