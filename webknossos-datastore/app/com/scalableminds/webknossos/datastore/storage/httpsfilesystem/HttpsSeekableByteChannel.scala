package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

import java.net.URI
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
import java.nio.charset.StandardCharsets
import java.nio.file.OpenOption
import java.util

// Does not work with Java 8, works with Java 11
import sttp.client3._
import sttp.model.Uri

import scala.concurrent.duration.DurationInt

class HttpsSeekableByteChannel(path: HttpsPath, openOptions: util.Set[_ <: OpenOption]) extends SeekableByteChannel {
  private var _position: Long = 0L

  private val uri: URI = path.toUri

  private val connectionTimeout = 5 seconds
  private val readTimeout = 1 minute

  private var _isOpen: Boolean = true

  private lazy val backend = HttpClientSyncBackend(options = SttpBackendOptions.connectionTimeout(connectionTimeout))
  private val supportsRangeRequests = false

  private def getRequest: Request[Either[String, Array[Byte]], Any] =
    path.getBasicAuthCredential.map { credential =>
      basicRequest.auth.basic(credential.user, credential.password)
    }.getOrElse(
        basicRequest
      )
      .readTimeout(readTimeout)
      .get(Uri(uri))
      .response(asByteArray)

  private def getRangeRequest(size: Int): Request[Either[String, Array[Byte]], Any] =
    getRequest.header("Range", s"bytes=${_position}-${size + _position}").response(asByteArray)

  private def getResponse(size: Int): Identity[Response[Either[String, Array[Byte]]]] = {
    val request: Request[Either[String, Array[Byte]], Any] =
      if (supportsRangeRequests) getRangeRequest(size)
      else {
        getRequest
      }
    backend.send(request)
  }

  lazy val response = getResponse(1024) // size has no effect at this point, since range requests are not yet supported

  override def read(byteBuffer: ByteBuffer): Int = {
    if (!response.isSuccess) {
      throw new Exception(s"Https read failed for uri $uri")
    }
    response.body match {
      case Left(e) => throw new Exception(s"Https read failed for uri $uri: $e")
      case Right(bytes) =>
        val availableBytes = bytes.length - position
        val bytesToCopy = availableBytes.min(byteBuffer.limit)
        byteBuffer.put(bytes.slice(_position.toInt, (_position + bytesToCopy).toInt))
        _position += bytesToCopy
        bytesToCopy.toInt
    }
  }

  override def write(byteBuffer: ByteBuffer): Int = ???

  override def position(): Long = _position

  override def position(l: Long): SeekableByteChannel = ???

  override def size(): Long = response.body.getOrElse(Array()).length

  override def truncate(l: Long): SeekableByteChannel = ???

  override def isOpen: Boolean = _isOpen

  override def close(): Unit =
    _isOpen = false
}
