package com.scalableminds.webknossos.datastore.datavault

import com.google.auth.{Credentials, RequestMetadataCallback}
import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.NoCredentials
import com.google.cloud.storage.{Storage, StorageOptions}
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.storage.{CredentializedUPath, GoogleServiceAccountCredential}
import Box.tryo
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.apache.commons.lang3.builder.HashCodeBuilder
import play.api.libs.ws.{WSClient, WSRequest, WSResponse}

import java.io.{ByteArrayInputStream, IOException}
import java.net.{URI, URLEncoder}
import java.nio.charset.StandardCharsets
import java.util
import java.util.concurrent.{CompletableFuture, TimeUnit}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters.{IterableHasAsScala, IteratorHasAsScala, MapHasAsScala}
import scala.jdk.FutureConverters.CompletionStageOps
import scala.util.{Random, Try, Failure as TryFailure, Success as TrySuccess}

/*
 * Reads are a single async ranged GET against the GCS JSON API media endpoint, sent with Play WS. The java-storage
 * client needed a second request per read (object metadata, for size and encoding) and blocked a thread for both;
 * size and encoding are taken from the media response headers instead. Listing still uses the java-storage client.
 */
class GoogleCloudDataVault(uri: URI, credential: Option[GoogleServiceAccountCredential], ws: WSClient)
    extends DataVault {

  private lazy val storageOptions: StorageOptions = credential match {
    case Some(credential: GoogleServiceAccountCredential) =>
      StorageOptions
        .newBuilder()
        .setCredentials(
          ServiceAccountCredentials.fromStream(new ByteArrayInputStream(credential.secretJson.toString.getBytes))
        )
        .build()
    case _ => StorageOptions.newBuilder().build()
  }

  private lazy val storage: Storage = storageOptions.getService

  // The credentials the java-storage client would use (including application default credentials if no credential
  // is configured), None for anonymous access.
  private lazy val requestCredentials: Option[Credentials] =
    Option(storageOptions.getScopedCredentials).filterNot(_.isInstanceOf[NoCredentials])

  private lazy val apiHost: String = storageOptions.getHost.stripSuffix("/")

  // gs://bucket-name/object/name  -> getAuthority -> bucket-name
  // Get bucket name with *getAuthority*. *Authority* is used here because *host* may only contain alphanumeric chars or
  // dashes, excluding chars that may be part of the bucket name (e.g. underscore).
  private lazy val bucket: String = uri.getAuthority

  override def readBytesPlusEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Encoding.Value, Option[String])] =
    for {
      objName <- getObjectName(path).toFox
      _ <- Fox.fromBool(isValidRange(range)) ?~> s"Invalid byte range $range"
      authHeaders <- Fox.fromFuture(authorizationHeaders) ?~> "Could not get Google Cloud Storage credentials"
      request <- tryo(buildRequest(objName, range, authHeaders)).toFox
      response <- Fox.fromFuture(GoogleCloudDataVault.getWithRetry(request))
      result <- response.status match {
        case 200 | 206 =>
          for {
            _ <- Fox.fromBool(
              !isDecodedGzipSlice(response)
            ) ?~> s"Range requests on gzip-encoded GCS objects are not supported (gs://$bucket/$objName, $range)"
            encoding <- Encoding.fromRfc7231String(response.header("Content-Encoding").getOrElse("")).toFox
            bytesAndRangeHeader <- extractRange(response, response.bodyAsBytes.toArray, range).toFox
          } yield (bytesAndRangeHeader._1, encoding, bytesAndRangeHeader._2)
        case 404    => Fox.empty
        case status =>
          Fox.failure(
            s"Reading gs://$bucket/$objName ($range) failed with status $status: ${response.bodyAsBytes.utf8String.take(500)}"
          )
      }
    } yield result

  private def isValidRange(range: ByteRange): Boolean = range match {
    // The length must fit into an Int (and thus into a byte array)
    case StartEndExclusiveByteRange(start, end) => start >= 0 && end > start && end - start <= Int.MaxValue
    case SuffixLengthByteRange(length)          => length > 0
    case CompleteByteRange()                    => true
  }

  // Accept-Encoding: gzip stops GCS from decompressing gzip-stored objects on the fly. That transcoding would ignore the
  // Range header and send the complete object. Play WS decodes gzip responses and drops their Content-Encoding header,
  // so the returned bytes are identity-encoded, like in HttpsDataVault.
  private def buildRequest(objName: String, range: ByteRange, authHeaders: Seq[(String, String)]): WSRequest = {
    val encodedName = URLEncoder.encode(objName, StandardCharsets.UTF_8).replace("+", "%20")
    ws.url(s"$apiHost/storage/v1/b/$bucket/o/$encodedName")
      .withQueryStringParameters("alt" -> "media")
      .withHttpHeaders(Seq("Accept-Encoding" -> "gzip") ++ range.toRangeHeaderOpt.map("Range" -> _) ++ authHeaders*)
      // GCS media downloads do not redirect. Following redirects would send the Authorization header to the new host.
      .withFollowRedirects(false)
      .withRequestTimeout(GoogleCloudDataVault.attemptTimeout)
  }

  // With Accept-Encoding: gzip, a gzip-stored object is served as stored, so a ranged read returns a slice of the gzip
  // stream. Such a slice cannot be decoded on its own, so these reads fail, as they did with the java-storage client.
  private def isDecodedGzipSlice(response: WSResponse): Boolean =
    response.status == 206 && response.header("x-goog-stored-content-encoding").contains("gzip")

  private lazy val contentRangeTotalRegex = """^bytes \d+-\d+/(\d+)$""".r

  // Returns exactly the requested bytes, and the Content-Range header built from the requested range and the object
  // size. Fails if the object ends before the requested range does.
  private def extractRange(
      response: WSResponse,
      body: Array[Byte],
      range: ByteRange
  ): Box[(Array[Byte], Option[String])] = {
    val isPartial = response.status == 206
    def objectSize: Box[Long] =
      if (!isPartial) Full(body.length.toLong) // the server ignored the Range header and sent the complete object
      else
        response.header("Content-Range") match {
          case Some(contentRangeTotalRegex(total)) => tryo(total.toLong)
          case other => Failure(s"Unexpected Content-Range header in GCS response: $other")
        }
    def tooShort = Failure(s"Unexpected end of object while reading from GCS: got ${body.length} bytes for $range")
    // Offset and length of the requested bytes within the object
    def requestedSlice(size: Long): (Long, Int) = range match {
      case r: StartEndExclusiveByteRange => (r.start, r.length)
      case r: SuffixLengthByteRange      => (size - r.length, r.length)
      case CompleteByteRange()           => (0L, size.toInt)
    }
    range match {
      case CompleteByteRange() => Full((body, None))
      case _                   =>
        for {
          size <- objectSize
          (offset, length) = requestedSlice(size)
          bytes <-
            if (isPartial) { if (body.length == length) Full(body) else tooShort }
            else if (offset >= 0 && offset + length <= body.length)
              Full(body.slice(offset.toInt, offset.toInt + length))
            else tooShort
        } yield (bytes, range.toContentRangeHeaderWithLength(size))
    }
  }

  private def authorizationHeaders(using ec: ExecutionContext): Future[Seq[(String, String)]] =
    Future.fromTry(Try(requestCredentials)).flatMap {
      case None              => Future.successful(Seq.empty)
      case Some(credentials) =>
        // Returns the cached access token right away, refreshes it on ec if it is expired.
        val promise = Promise[Seq[(String, String)]]()
        credentials.getRequestMetadata(
          URI.create(apiHost),
          (command: Runnable) => ec.execute(command),
          new RequestMetadataCallback {
            override def onSuccess(metadata: util.Map[String, util.List[String]]): Unit =
              promise.success(metadata.asScala.toSeq.flatMap { case (key, values) => values.asScala.map(key -> _) })
            override def onFailure(exception: Throwable): Unit = promise.failure(exception)
          }
        )
        promise.future
    }

  override def listDirectory(path: VaultPath, maxItems: Int)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[VaultPath]] =
    (for {
      objName <- getObjectName(path)
      blobs <- tryo(
        storage.list(bucket, Storage.BlobListOption.prefix(objName), Storage.BlobListOption.currentDirectory())
      )
      subDirectories <- tryo(blobs.getValues.asScala.toList.filter(_.isDirectory).take(maxItems))
      paths <- Box.combined(subDirectories) { dirBlob =>
        UPath.fromString(s"${uri.getScheme}://$bucket/${dirBlob.getBlobId.getName}").map(new VaultPath(_, this))
      }
    } yield paths).toFox

  override def getUsedStorageBytes(path: VaultPath)(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    (for {
      objName <- getObjectName(path)
      blobs <- tryo(
        storage.list(bucket, Storage.BlobListOption.prefix(objName))
      ) // no currentDirectory(); Do deep recursive listing
      totalSize <- tryo(blobs.iterateAll().iterator().asScala.map(_.getSize).foldLeft(0L)(_ + _))
    } yield totalSize).toFox

  private def getUri = uri
  private def getCredential = credential
  private def getObjectName(path: VaultPath): Box[String] =
    for {
      remoteUri <- path.toRemoteUri
    } yield remoteUri.getPath.tail

  override def equals(obj: Any): Boolean = obj match {
    case other: GoogleCloudDataVault => other.getUri == uri && other.getCredential == credential
    case _                           => false
  }

  private lazy val hashCodeCached = new HashCodeBuilder(17, 31).append(uri).append(credential).toHashCode

  override def hashCode(): Int = hashCodeCached

}

object GoogleCloudDataVault {
  def create(credentializedUPath: CredentializedUPath, ws: WSClient): Box[GoogleCloudDataVault] =
    for {
      credential <- tryo(credentializedUPath.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential]))
      remoteUri <- credentializedUPath.upath.toRemoteUri
    } yield new GoogleCloudDataVault(remoteUri, credential, ws)

  // Deadline for one attempt, from sending the request until the complete body is received.
  private val attemptTimeout = 2 minutes
  private val maxAttempts = 5
  private val retryBaseDelayMs = 250L
  private val retryableStatusCodes = Set(408, 429, 500, 502, 503, 504)

  // Retries transient failures with exponential backoff, like the java-storage client does for reads. Connection
  // errors are IOExceptions. An attempt that ran into attemptTimeout (a TimeoutException) is not retried: a retry would
  // likely stall again, and failed reads are not cached, so the next request for the same data starts a fresh read.
  private def getWithRetry(request: WSRequest, attempt: Int = 1)(using ec: ExecutionContext): Future[WSResponse] = {
    def retryLater(): Future[WSResponse] = {
      val delayMs = retryBaseDelayMs * (1L << (attempt - 1)) + Random.nextLong(retryBaseDelayMs)
      CompletableFuture
        .runAsync(() => (), CompletableFuture.delayedExecutor(delayMs, TimeUnit.MILLISECONDS))
        .asScala
        .flatMap(_ => getWithRetry(request, attempt + 1))
    }
    request.get().transformWith {
      case TrySuccess(response) if retryableStatusCodes.contains(response.status) && attempt < maxAttempts =>
        retryLater()
      case TryFailure(_: IOException) if attempt < maxAttempts => retryLater()
      case other                                               => Future.fromTry(other)
    }
  }
}
