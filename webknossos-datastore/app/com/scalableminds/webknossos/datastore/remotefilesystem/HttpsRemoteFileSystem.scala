package com.scalableminds.webknossos.datastore.remotefilesystem

import com.scalableminds.webknossos.datastore.storage.{HttpBasicAuthCredential, RemoteSourceDescriptor}

import java.net.URI
import scala.concurrent.duration.DurationInt
import sttp.client3._
import sttp.model.Uri

class HttpsRemoteFileSystem(credential: Option[HttpBasicAuthCredential]) extends RemoteFileSystem {

  private val connectionTimeout = 5 seconds
  private val readTimeout = 1 minute
  private lazy val backend = HttpClientSyncBackend(options = SttpBackendOptions.connectionTimeout(connectionTimeout))

  private def authenticatedRequest() =
    credential.map { credential =>
      basicRequest.auth.basic(credential.username, credential.password)
    }.getOrElse(
        basicRequest
      )
      .readTimeout(readTimeout)

  private def headRequest(uri: URI): Request[Either[String, String], Any] =
    authenticatedRequest().head(Uri(uri))

  private val headerInfoCache = scala.collection.mutable.Map[URI, (Boolean, Int)]()

  private def getHeaderInformation(uri: URI) =
    headerInfoCache.get(uri) match {
      case Some((b, i)) => (b, i)
      case None => {
        val response: Identity[Response[Either[String, String]]] = backend.send(headRequest(uri))
        val acceptsPartialRequests = response.headers.find(_.is("Accept-Ranges")).exists(_.value == "bytes")
        val dataSize = response.headers.find(_.is("Content-Length")).map(_.value.toInt).getOrElse(0)
        headerInfoCache(uri) = (acceptsPartialRequests, dataSize)
        (acceptsPartialRequests, dataSize)
      }
    }

  private def getDataRequest(uri: URI): Request[Either[String, Array[Byte]], Any] =
    authenticatedRequest().get(Uri(uri)).response(asByteArray)

  private def getRangeRequest(uri: URI, range: Range): Request[Either[String, Array[Byte]], Any] =
    getDataRequest(uri).header("Range", s"bytes=${range.start}-${range.end}").response(asByteArray)

  private def getResponse(uri: URI): Identity[Response[Either[String, Array[Byte]]]] = {
    val request: Request[Either[String, Array[Byte]], Any] = getDataRequest(uri)
    backend.send(request)
  }

  private def getResponseForRangeRequest(uri: URI, range: Range) = {
    val request = getRangeRequest(uri, range)
    backend.send(request)
  }

  private def fullResponse(uri: URI): Identity[Response[Either[String, Array[Byte]]]] = getResponse(uri)

  override def get(key: String, path: RemotePath, range: Option[Range]): Array[Byte] = {
    val uri = path.toUri.resolve(key)
    val response = range match {
      case Some(r) => {
        val headerInfos = getHeaderInformation(uri)
        if (!headerInfos._1) {
          throw new UnsupportedOperationException(s"Range requests not supported for ${uri.toString}")
        }
        getResponseForRangeRequest(uri, r)
      }
      case None => fullResponse(uri)
    }

    if (!response.isSuccess) {
      throw new Exception(s"Https read failed for uri $uri: Response was not successful ${response.statusText}")
    }
    response.body match {
      case Left(e)      => throw new Exception(s"Https read failed for uri $uri: $e: Response empty")
      case Right(bytes) => bytes
    }
  }
}

object HttpsRemoteFileSystem {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor) = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[HttpBasicAuthCredential])
    new RemotePath(remoteSourceDescriptor.uri, new HttpsRemoteFileSystem(credential), credential)
  }
}
