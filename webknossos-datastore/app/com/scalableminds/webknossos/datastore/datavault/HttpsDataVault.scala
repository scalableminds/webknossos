package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
import com.scalableminds.webknossos.datastore.storage.{
  DataVaultCredential,
  HttpBasicAuthCredential,
  LegacyDataVaultCredential,
  RemoteSourceDescriptor
}
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status
import play.api.libs.ws.{WSAuthScheme, WSClient, WSResponse}

import java.net.URI
import scala.concurrent.duration.DurationInt
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class HttpsDataVault(credential: Option[DataVaultCredential], ws: WSClient) extends DataVault with LazyLogging {

  private val readTimeout = 10 minutes

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = {
    val uri = path.toUri
    for {
      response <- range match {
        case StartEnd(r)          => getWithRange(uri, r)
        case SuffixLength(length) => getWithSuffixRange(uri, length)
        case Complete()           => fullGet(uri)
      }
      encoding <- Encoding.fromRfc7231String(response.header("Content-Encoding").getOrElse("")).toFox
      result <- if (Status.isSuccessful(response.status)) {
        Fox.successful((response.bodyAsBytes.toArray, encoding))
      } else if (response.status == 404) Fox.empty
      else Fox.failure(s"Https read failed for uri $uri: ${response.status} ${response.statusText}")
    } yield result

  }

  private val headerInfoCache: AlfuFoxCache[URI, (Boolean, Long)] = AlfuFoxCache()

  private def getHeaderInformation(uri: URI)(implicit ec: ExecutionContext): Fox[(Boolean, Long)] =
    headerInfoCache.getOrLoad(
      uri, { uri =>
        for {
          response <- ws.url(uri.toString).withRequestTimeout(readTimeout).head()
          acceptsPartialRequests = response.headerValues("Accept-Ranges").contains("bytes")
          dataSize = response.header("Content-Length").map(_.toLong).getOrElse(0L)
        } yield (acceptsPartialRequests, dataSize)
      }
    )

  private def getWithRange(uri: URI, range: NumericRange[Long])(implicit ec: ExecutionContext): Fox[WSResponse] =
    for {
      _ <- ensureRangeRequestsSupported(uri)
      response <- rpc(uri).withHttpHeaders("Range" -> s"bytes=${range.start}-${range.end - 1}").get()
    } yield response

  private def getWithSuffixRange(uri: URI, length: Long)(implicit ec: ExecutionContext): Fox[WSResponse] =
    for {
      _ <- ensureRangeRequestsSupported(uri)
      response <- rpc(uri).withHttpHeaders("Range" -> s"bytes=-$length").get()
    } yield response

  private def fullGet(uri: URI)(implicit ec: ExecutionContext): Fox[WSResponse] =
    rpc(uri).get()

  private def ensureRangeRequestsSupported(uri: URI)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      headerInfos <- getHeaderInformation(uri)
      _ <- bool2Fox(headerInfos._1) ?~> s"Range requests not supported for ${uri.toString}"
    } yield ()

  private def rpc(uri: URI) = {
    val request = ws.url(uri.toString).withRequestTimeout(readTimeout)
    getBasicAuthCredential match {
      case Some(credential) =>
        request.withAuth(credential.username, credential.password, WSAuthScheme.BASIC)
      case None => request
    }
  }

  private def getBasicAuthCredential: Option[HttpBasicAuthCredential] =
    credential.flatMap { c =>
      c match {
        case h: HttpBasicAuthCredential   => Some(h)
        case l: LegacyDataVaultCredential => Some(l.toBasicAuth)
        case _                            => None
      }
    }

}

object HttpsDataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor, ws: WSClient): HttpsDataVault =
    new HttpsDataVault(remoteSourceDescriptor.credential, ws)
}
