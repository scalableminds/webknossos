package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.webknossos.datastore.storage.{
  FileSystemCredential,
  HttpBasicAuthCredential,
  LegacyFileSystemCredential,
  RemoteSourceDescriptor
}

import java.net.URI
import scala.concurrent.duration.DurationInt
import sttp.client3._
import sttp.model.Uri

import scala.collection.immutable.NumericRange

class HttpsDataVault(credential: Option[FileSystemCredential]) extends DataVault {

  private val connectionTimeout = 1 minute
  private val readTimeout = 10 minutes
  private lazy val backend = HttpClientSyncBackend(options = SttpBackendOptions.connectionTimeout(connectionTimeout))

  def getBasicAuthCredential: Option[HttpBasicAuthCredential] =
    credential.flatMap { c =>
        c match {
          case h: HttpBasicAuthCredential    => Some(h)
          case l: LegacyFileSystemCredential => Some(l.toBasicAuth)
          case _                             => None
        }
    }

  private def authenticatedRequest() =
    getBasicAuthCredential.map { credential =>
      basicRequest.auth.basic(credential.username, credential.password)
    }.getOrElse(
        basicRequest
      )
      .readTimeout(readTimeout)

  private def headRequest(uri: URI): Request[Either[String, String], Any] =
    authenticatedRequest().head(Uri(uri))

  private val headerInfoCache = scala.collection.mutable.Map[URI, (Boolean, Long)]()

  private def getHeaderInformation(uri: URI) =
    headerInfoCache.get(uri) match {
      case Some((b, i)) => (b, i)
      case None => {
        val response: Identity[Response[Either[String, String]]] = backend.send(headRequest(uri))
        val acceptsPartialRequests = response.headers.find(_.is("Accept-Ranges")).exists(_.value == "bytes")
        val dataSize = response.headers.find(_.is("Content-Length")).map(_.value.toLong).getOrElse(0L)
        headerInfoCache(uri) = (acceptsPartialRequests, dataSize)
        (acceptsPartialRequests, dataSize)
      }
    }

  private def getDataRequest(uri: URI): Request[Either[String, Array[Byte]], Any] =
    authenticatedRequest().get(Uri(uri)).response(asByteArray)

  private def getRangeRequest(uri: URI, range: NumericRange[Long]): Request[Either[String, Array[Byte]], Any] =
    getDataRequest(uri).header("Range", s"bytes=${range.start}-${range.end - 1}").response(asByteArray)

  private def getResponse(uri: URI): Identity[Response[Either[String, Array[Byte]]]] = {
    val request: Request[Either[String, Array[Byte]], Any] = getDataRequest(uri)
    backend.send(request)
  }

  private def getResponseForRangeRequest(uri: URI, range: NumericRange[Long]) = {
    val request = getRangeRequest(uri, range)
    backend.send(request)
  }

  private def fullResponse(uri: URI): Identity[Response[Either[String, Array[Byte]]]] = getResponse(uri)

  override def get(key: String, path: VaultPath, range: Option[NumericRange[Long]]): Array[Byte] = {
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

object HttpsDataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor) = {
    val credential = remoteSourceDescriptor.credential
    new VaultPath(remoteSourceDescriptor.uri, new HttpsDataVault(credential), credential)
  }
}
