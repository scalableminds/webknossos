package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.net.URI
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
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
  private val rangeRequestsActive = false

  private lazy val authenticatedRequest = path.getBasicAuthCredential.map { credential =>
    basicRequest.auth.basic(credential.username, credential.password)
  }.getOrElse(
      basicRequest
    )
    .readTimeout(readTimeout)

  private lazy val headRequest: Request[Either[String, String], Any] =
    authenticatedRequest.head(Uri(uri))

  private def getHeaderInformation = {
    val response: Identity[Response[Either[String, String]]] = backend.send(headRequest)
    val acceptsPartialRequests = response.headers.find(_.is("Accept-Ranges")).exists(_.value == "bytes")
    val dataSize = response.headers.find(_.is("Content-Length")).map(_.value.toInt).getOrElse(0)
    (acceptsPartialRequests, dataSize)
  }

  private lazy val headerInfos = getHeaderInformation
  private lazy val acceptsPartialRequests: Boolean = getHeaderInformation._1

  private def getDataRequest: Request[Either[String, Array[Byte]], Any] =
    authenticatedRequest.get(Uri(uri)).response(asByteArray)

  private def getRangeRequest(bufferSize: Int): Request[Either[String, Array[Byte]], Any] =
    getDataRequest.header("Range", s"bytes=${_position}-${(bufferSize + _position).min(size())}").response(asByteArray)

  private def getResponse: Identity[Response[Either[String, Array[Byte]]]] = {
    val request: Request[Either[String, Array[Byte]], Any] = getDataRequest
    backend.send(request)
  }

  private def getResponseForRangeRequest(size: Int) = {
    val request = getRangeRequest(size)
    backend.send(request)
  }

  private lazy val fullResponse: Identity[Response[Either[String, Array[Byte]]]] = getResponse

  override def read(byteBuffer: ByteBuffer): Int = {
    val response =
      if (rangeRequestsActive && acceptsPartialRequests) getResponseForRangeRequest(byteBuffer.limit())
      else fullResponse
    if (!response.isSuccess) {
      throw new Exception(s"Https read failed for uri $uri: Response was not successful")
    }
    response.body match {
      case Left(e) => throw new Exception(s"Https read failed for uri $uri: $e: Response empty")
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

  override def position(l: Long): SeekableByteChannel = {
    this._position = l
    this
  }

  override def size(): Long =
    if (rangeRequestsActive) {
      headerInfos._2
    } else {
      fullResponse.body.getOrElse(Array()).length
    }

  override def truncate(l: Long): SeekableByteChannel = ???

  override def isOpen: Boolean = _isOpen

  override def close(): Unit =
    _isOpen = false
}
