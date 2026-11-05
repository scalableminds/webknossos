package com.scalableminds.webknossos.datastore.datavault

import com.google.auth.{Credentials, RequestMetadataCallback}
import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.NoCredentials
import com.google.cloud.storage.{Storage, StorageOptions}
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.storage.{CredentializedUPath, GoogleServiceAccountCredential}
import Box.tryo
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.io.{ByteArrayInputStream, IOException}
import java.net.http.{HttpClient, HttpConnectTimeoutException, HttpRequest, HttpResponse, HttpTimeoutException}
import java.net.{URI, URLEncoder}
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util
import java.util.concurrent.{CompletableFuture, TimeUnit}
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters.{IterableHasAsScala, IteratorHasAsScala, MapHasAsScala}
import scala.jdk.FutureConverters.CompletionStageOps
import scala.jdk.OptionConverters.RichOptional
import scala.util.{Random, Try, Failure as TryFailure, Success as TrySuccess}

/*
 * Reads are a single async ranged GET against the GCS JSON API media endpoint. The java-storage client needed a
 * second request per read (object metadata, for size and encoding) and blocked a thread for both; size and encoding
 * are taken from the media response headers instead. Listing still uses the java-storage client.
 */
class GoogleCloudDataVault(uri: URI, credential: Option[GoogleServiceAccountCredential]) extends DataVault {

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
      response <- Fox.fromFuture(GoogleCloudDataVault.sendWithRetry(request))
      result <- response.statusCode match {
        case 200 | 206 =>
          for {
            (body, encoding) <- decodeTransportCompression(response).toFox
            bytesAndRangeHeader <- extractRange(response, body, range).toFox
          } yield (bytesAndRangeHeader._1, encoding, bytesAndRangeHeader._2)
        case 404 => Fox.empty
        case _   =>
          Fox.failure(
            s"Reading gs://$bucket/$objName ($range) failed with status ${response.statusCode}: ${new String(response.body.take(500), StandardCharsets.UTF_8)}"
          )
      }
    } yield result

  private def isValidRange(range: ByteRange): Boolean = range match {
    case StartEndExclusiveByteRange(start, end) => start >= 0 && end > start
    case SuffixLengthByteRange(length)          => length > 0
    case CompleteByteRange()                    => true
  }

  // Accept-Encoding: gzip makes GCS return gzip-stored objects as stored, without decompressive transcoding (which
  // would ignore the Range header). The Content-Encoding response header then describes the returned bytes, which
  // the java.net.http client passes through undecoded.
  private def buildRequest(objName: String, range: ByteRange, authHeaders: Seq[(String, String)]): HttpRequest = {
    val encodedName = URLEncoder.encode(objName, StandardCharsets.UTF_8).replace("+", "%20")
    val builder = HttpRequest
      .newBuilder(URI.create(s"$apiHost/download/storage/v1/b/$bucket/o/$encodedName?alt=media"))
      .timeout(GoogleCloudDataVault.readTimeout)
      .header("Accept-Encoding", "gzip")
    range.toRangeHeaderOpt.foreach(builder.header("Range", _))
    authHeaders.foreach { case (key, value) => builder.header(key, value) }
    builder.GET().build()
  }

  private def header(response: HttpResponse[?], name: String): Option[String] =
    response.headers.firstValue(name).toScala

  // With Accept-Encoding: gzip, GCS may also gzip objects that are not stored gzipped, for the transfer only. The
  // x-goog-stored-content-encoding header tells the two cases apart. Transfer compression is undone here, so that the
  // body holds the stored bytes and the length checks in extractRange hold.
  private def decodeTransportCompression(response: HttpResponse[Array[Byte]]): Box[(Array[Byte], Encoding.Value)] =
    for {
      encoding <- Encoding.fromRfc7231String(header(response, "Content-Encoding").getOrElse(""))
      storedEncoding <- header(response, "x-goog-stored-content-encoding") match {
        case Some(stored) => Encoding.fromRfc7231String(stored)
        case None         => Full(encoding)
      }
      decoded <-
        if (encoding == Encoding.gzip && storedEncoding != Encoding.gzip)
          tryo(ZipIO.gunzip(response.body)).map(_ -> storedEncoding)
        else Full(response.body -> encoding)
    } yield decoded

  private lazy val contentRangeTotalRegex = """^bytes \d+-\d+/(\d+)$""".r

  // Returns exactly the requested bytes, and the Content-Range header built from the requested range and the object
  // size. Fails if the object ends before the requested range does.
  private def extractRange(
      response: HttpResponse[?],
      body: Array[Byte],
      range: ByteRange
  ): Box[(Array[Byte], Option[String])] = {
    val isPartial = response.statusCode == 206
    def objectSize: Box[Long] =
      if (!isPartial) Full(body.length.toLong) // the server ignored the Range header and sent the complete object
      else
        header(response, "Content-Range") match {
          case Some(contentRangeTotalRegex(total)) => tryo(total.toLong)
          case other                               => Failure(s"Unexpected Content-Range header in GCS response: $other")
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
            else if (offset >= 0 && offset + length <= body.length) Full(body.slice(offset.toInt, offset.toInt + length))
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
  def create(credentializedUPath: CredentializedUPath): Box[GoogleCloudDataVault] =
    for {
      credential <- tryo(credentializedUPath.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential]))
      remoteUri <- credentializedUPath.upath.toRemoteUri
    } yield new GoogleCloudDataVault(remoteUri, credential)

  private val readTimeout: Duration = Duration.ofMinutes(10)
  private val maxAttempts = 5
  private val retryBaseDelayMs = 250L
  private val retryableStatusCodes = Set(408, 429, 500, 502, 503, 504)

  // Shared by all GCS vaults. Does not decode Content-Encoding, so gzip-stored objects arrive as stored.
  private lazy val httpClient: HttpClient = HttpClient
    .newBuilder()
    .connectTimeout(Duration.ofSeconds(20))
    // GCS media downloads do not redirect. Following redirects would send the Authorization header to the new host.
    .followRedirects(HttpClient.Redirect.NEVER)
    .build()

  // Retries transient failures with exponential backoff, like the java-storage client does for reads.
  private def sendWithRetry(request: HttpRequest, attempt: Int = 1)(using
      ec: ExecutionContext
  ): Future[HttpResponse[Array[Byte]]] = {
    def retryLater(): Future[HttpResponse[Array[Byte]]] = {
      val delayMs = retryBaseDelayMs * (1L << (attempt - 1)) + Random.nextLong(retryBaseDelayMs)
      CompletableFuture
        .runAsync(() => (), CompletableFuture.delayedExecutor(delayMs, TimeUnit.MILLISECONDS))
        .asScala
        .flatMap(_ => sendWithRetry(request, attempt + 1))
    }
    httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()).asScala.transformWith {
      case TrySuccess(response) if retryableStatusCodes.contains(response.statusCode) && attempt < maxAttempts =>
        retryLater()
      case TryFailure(e: IOException) if isRetryable(e) && attempt < maxAttempts => retryLater()
      case other                                                                  => Future.fromTry(other)
    }
  }

  // Connection errors are retried, a request that already ran into readTimeout is not.
  private def isRetryable(e: IOException): Boolean = e match {
    case _: HttpConnectTimeoutException => true
    case _: HttpTimeoutException        => false
    case _                              => true
  }
}
