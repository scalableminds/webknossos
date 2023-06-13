package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{
  DataVaultCredential,
  HttpBasicAuthCredential,
  LegacyDataVaultCredential,
  RemoteSourceDescriptor
}

import java.net.URI
import scala.concurrent.duration.DurationInt
import sttp.client3._
import sttp.model.Uri

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class HttpsDataVault(credential: Option[DataVaultCredential]) extends DataVault {

  private val connectionTimeout = 1 minute
  private val readTimeout = 10 minutes
  private lazy val backend = HttpURLConnectionBackend(options = SttpBackendOptions.connectionTimeout(connectionTimeout))

  private def getBasicAuthCredential: Option[HttpBasicAuthCredential] =
    credential.flatMap { c =>
      c match {
        case h: HttpBasicAuthCredential   => Some(h)
        case l: LegacyDataVaultCredential => Some(l.toBasicAuth)
        case _                            => None
      }
    }

  private def authenticatedRequest() =
    getBasicAuthCredential.map { credential =>
      basicRequest.auth.basic(credential.username, credential.password)
    }.getOrElse(
        basicRequest
      )
      .readTimeout(readTimeout)
      .disableAutoDecompression // Decompression is performed by the VaultPath

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

  private def getSuffixRangeRequest(uri: URI, length: Long): Request[Either[String, Array[Byte]], Any] =
    getDataRequest(uri).header("Range", s"bytes=-$length").response(asByteArray)

  private def getResponse(uri: URI): Identity[Response[Either[String, Array[Byte]]]] = {
    val request: Request[Either[String, Array[Byte]], Any] = getDataRequest(uri)
    backend.send(request)
  }

  private def getResponseForRangeRequest(uri: URI, range: NumericRange[Long]) = {
    val request = getRangeRequest(uri, range)
    backend.send(request)
  }

  private def getResponseForSuffixRangeRequest(uri: URI, length: Long) = {
    val request = getSuffixRangeRequest(uri, length)
    backend.send(request)
  }

  private def fullResponse(uri: URI): Identity[Response[Either[String, Array[Byte]]]] = getResponse(uri)

  private def ensureRangeRequestsSupported(uri: URI): Unit = {
    val headerInfos = getHeaderInformation(uri)
    if (!headerInfos._1) {
      throw new UnsupportedOperationException(s"Range requests not supported for ${uri.toString}")
    }
  }

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = {
    val uri = path.toUri
    val response = range match {
      case StartEnd(r) =>
        ensureRangeRequestsSupported(uri)
        getResponseForRangeRequest(uri, r)

      case SuffixLength(length) =>
        ensureRangeRequestsSupported(uri)
        getResponseForSuffixRangeRequest(uri, length)
      case Complete() => fullResponse(uri)
    }
    val encoding = Encoding.fromRfc7231String(response.header("Content-Encoding").getOrElse(""))

    response.body match {
      case Left(e) => Fox.failure(s"Https read failed for uri $uri: $e: Response empty")
      case _ if (!response.isSuccess) =>
        Fox.failure(s"Https read failed for uri $uri: Response was not successful ${response.statusText}")
      case Right(bytes) => Fox.successful((bytes, encoding))
    }
  }
}

object HttpsDataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor): HttpsDataVault =
    new HttpsDataVault(remoteSourceDescriptor.credential)
}
