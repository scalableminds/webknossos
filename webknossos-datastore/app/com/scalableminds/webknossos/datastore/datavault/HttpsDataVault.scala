package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{box2Fox, future2Fox}
import com.scalableminds.webknossos.datastore.storage.{
  DataVaultCredential,
  HttpBasicAuthCredential,
  LegacyDataVaultCredential,
  RemoteSourceDescriptor
}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.lang3.builder.HashCodeBuilder
import play.api.http.Status
import play.api.libs.ws.{WSAuthScheme, WSClient, WSRequest, WSResponse}

import java.net.URI
import scala.concurrent.duration.DurationInt
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class HttpsDataVault(credential: Option[DataVaultCredential], ws: WSClient, dataStoreHost: String)
    extends DataVault
    with LazyLogging {

  private val readTimeout = 10 minutes

  // This will be set after the first completed range request by looking at the response headers of a HEAD request and the response headers of a GET request
  private var supportsRangeRequests: Option[Boolean] = None

  private lazy val dataStoreAuthority = new URI(dataStoreHost).getAuthority

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Encoding.Value)] = {
    val uri = path.toUri
    for {
      response <- range match {
        case StartEnd(r)          => getWithRange(uri, r)
        case SuffixLength(length) => getWithSuffixRange(uri, length)
        case Complete()           => getComplete(uri)
      }
      encoding <- Encoding.fromRfc7231String(response.header("Content-Encoding").getOrElse("")).toFox
      result <- if (Status.isSuccessful(response.status)) {
        Fox.successful((response.bodyAsBytes.toArray, encoding))
      } else if (response.status == 404) Fox.empty
      else Fox.failure(s"Https read failed for uri $uri: ${response.status} ${response.statusText}")
    } yield result

  }

  override def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] =
    // HTTP file listing is currently not supported.
    Fox.successful(List.empty)

  private val headerInfoCache: AlfuCache[URI, (Boolean, Long)] = AlfuCache()

  private def getHeaderInformation(uri: URI)(implicit ec: ExecutionContext): Fox[(Boolean, Long)] =
    headerInfoCache.getOrLoad(
      uri, { uri =>
        for {
          response <- ws.url(uri.toString).withRequestTimeout(readTimeout).head().toFox
          acceptsPartialRequests = response.headerValues("Accept-Ranges").contains("bytes")
          dataSize = response.header("Content-Length").map(_.toLong).getOrElse(0L)
        } yield (acceptsPartialRequests, dataSize)
      }
    )

  private def getWithRange(uri: URI, range: NumericRange[Long])(implicit ec: ExecutionContext,
                                                                tc: TokenContext): Fox[WSResponse] =
    for {
      _ <- ensureRangeRequestsSupported(uri)
      response <- buildRequest(uri).withHttpHeaders("Range" -> s"bytes=${range.start}-${range.end - 1}").get().toFox
      _ = updateRangeRequestsSupportedForResponse(response)
    } yield response

  private def getWithSuffixRange(uri: URI, length: Long)(implicit ec: ExecutionContext,
                                                         tc: TokenContext): Fox[WSResponse] =
    for {
      _ <- ensureRangeRequestsSupported(uri)
      response <- buildRequest(uri).withHttpHeaders("Range" -> s"bytes=-$length").get().toFox
      _ = updateRangeRequestsSupportedForResponse(response)
    } yield response

  private def getComplete(uri: URI)(implicit ec: ExecutionContext, tc: TokenContext): Fox[WSResponse] =
    buildRequest(uri).get().toFox

  private def ensureRangeRequestsSupported(uri: URI)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      supported <- supportsRangeRequests match {
        case Some(supports) => Fox.successful(supports)
        case None =>
          for {
            headerInfos <- getHeaderInformation(uri)
          } yield {
            if (!headerInfos._1) {
              // Head is not conclusive, do the range request and check the response afterwards (see updateRangeRequestsSupportedForResponse)
              true
            } else {
              supportsRangeRequests = Some(true)
              true
            }
          }
      }
      _ <- Fox.bool2Fox(supported) ?~> s"Range requests are not supported for this data vault at $uri"
    } yield ()

  private def updateRangeRequestsSupportedForResponse(response: WSResponse): Unit =
    if (supportsRangeRequests.isEmpty) {
      supportsRangeRequests = Some(response.header("Content-Range").isDefined)
    }

  private def buildRequest(uri: URI)(implicit tc: TokenContext): WSRequest = {
    val request = ws.url(uri.toString).withRequestTimeout(readTimeout)
    tc.userTokenOpt match {
      case Some(token) if uri.getAuthority == dataStoreAuthority =>
        request.withHttpHeaders("X-Auth-Token" -> token)
      case _ =>
        getBasicAuthCredential match {
          case Some(credential) =>
            request.withAuth(credential.username, credential.password, WSAuthScheme.BASIC)
          case None => request
        }
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

  private def getCredential = credential

  override def equals(obj: Any): Boolean = obj match {
    case other: HttpsDataVault => other.getCredential == credential
    case _                     => false
  }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(credential).toHashCode
}

object HttpsDataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor, ws: WSClient, dataStoreHost: String): HttpsDataVault =
    new HttpsDataVault(remoteSourceDescriptor.credential, ws, dataStoreHost)
}
