package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo

import java.net.URI
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
import java.nio.charset.StandardCharsets
import java.nio.file.OpenOption
import java.util
import scalaj.http.{Http, HttpResponse}

import scala.concurrent.duration.DurationInt

class HttpsSeekableByteChannel(path: HttpsPath, openOptions: util.Set[_ <: OpenOption]) extends SeekableByteChannel {
  private var _position: Long = 0L

  private val uri: URI = path.toUri

  private val connectionTimeout = 5 seconds
  private val readTimeout = 1 minute

  private val responseBox: Box[HttpResponse[Array[Byte]]] = tryo(
    path.getBasicAuthCredential.map { credential =>
      Http(uri.toString)
        .timeout(connTimeoutMs = connectionTimeout.toMillis.toInt, readTimeoutMs = readTimeout.toMillis.toInt)
        .auth(credential.username, credential.password)
        .asBytes
    }.getOrElse(Http(uri.toString)
      .timeout(connTimeoutMs = connectionTimeout.toMillis.toInt, readTimeoutMs = readTimeout.toMillis.toInt)
      .asBytes)
  )

  private var _isOpen: Boolean = true

  override def read(byteBuffer: ByteBuffer): Int =
    responseBox match {
      case Full(response) =>
        val bytes = response.body

        if (!response.isSuccess) {
          val bodyString = new String(bytes, StandardCharsets.UTF_8)
          throw new Exception(s"Https read failed for uri $uri: ${response.statusLine} – ${bodyString.take(1000)}")
        }

        val lengthToCopy = bytes.length - position
        byteBuffer.put(bytes.drop(_position.toInt))
        _position += lengthToCopy
        lengthToCopy.toInt
      case f: Failure =>
        throw new Exception(s"Https read failed for uri $uri: $f")
      case Empty =>
        throw new Exception(s"Https read failed for uri $uri: Empty")
    }

  override def write(byteBuffer: ByteBuffer): Int = ???

  override def position(): Long = _position

  override def position(l: Long): SeekableByteChannel = ???

  override def size(): Long = responseBox.toOption.map(_.body.length.toLong).getOrElse(0L)

  override def truncate(l: Long): SeekableByteChannel = ???

  override def isOpen: Boolean = _isOpen

  override def close(): Unit =
    _isOpen = false
}
