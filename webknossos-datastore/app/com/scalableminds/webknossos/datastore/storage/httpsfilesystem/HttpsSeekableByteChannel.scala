package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.net.URI
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
import java.nio.charset.StandardCharsets
import java.nio.file.OpenOption
import java.util

import scalaj.http.Http

class HttpsSeekableByteChannel(path: HttpsPath, openOptions: util.Set[_ <: OpenOption]) extends SeekableByteChannel {
  private var _position: Long = 0L

  private val uri: URI = path.asInstanceOf[HttpsPath].toUri
  private val response =
    path.getBasicAuthCredentials.map { credentials =>
      Http(uri.toString).auth(credentials.user, credentials.password).asBytes
    }.getOrElse(Http(uri.toString).asBytes)

  private var _isOpen: Boolean = true

  override def read(byteBuffer: ByteBuffer): Int = {
    val bytes = response.body

    if (!response.isSuccess) {
      val bodyString = new String(bytes, StandardCharsets.UTF_8)
      throw new Exception(s"Https read failed for uri ${uri}: ${response.statusLine} – ${bodyString.take(1000)}")
    }

    val lengthToCopy = bytes.length - position
    byteBuffer.put(bytes.drop(_position.toInt))
    _position += lengthToCopy
    lengthToCopy.toInt
  }

  override def write(byteBuffer: ByteBuffer): Int = ???

  override def position(): Long = _position

  override def position(l: Long): SeekableByteChannel = ???

  override def size(): Long = response.body.length

  override def truncate(l: Long): SeekableByteChannel = ???

  override def isOpen: Boolean = _isOpen

  override def close(): Unit =
    _isOpen = false
}
