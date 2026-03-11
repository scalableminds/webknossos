package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.storage.{
  CredentializedUPath,
  LegacyDataVaultCredential,
  S3AccessKeyCredential,
  S3ClientPool
}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Empty, Full, Failure => BoxFailure}
import com.scalableminds.webknossos.datastore.helpers.{S3UriUtils, UPath}
import org.apache.commons.lang3.builder.HashCodeBuilder

import scala.util.{Failure => TryFailure, Success => TrySuccess}
import software.amazon.awssdk.core.ResponseBytes
import software.amazon.awssdk.core.async.AsyncResponseTransformer
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.model.{
  CommonPrefix,
  GetObjectRequest,
  GetObjectResponse,
  ListObjectsV2Request,
  ListObjectsV2Response,
  NoSuchBucketException,
  NoSuchKeyException
}

import java.net.URI
import java.util.concurrent.CompletionException
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.CollectionHasAsScala
import scala.jdk.FutureConverters._

class S3DataVault(s3AccessKeyCredential: Option[S3AccessKeyCredential],
                  uri: URI,
                  s3ClientPool: S3ClientPool,
                  implicit val ec: ExecutionContext)
    extends DataVault
    with FoxImplicits {
  private lazy val bucketName = S3UriUtils.hostBucketFromUri(uri) match {
    case Some(value) => value
    case None        => throw new Exception(s"Could not parse S3 bucket for ${uri.toString}")
  }

  private lazy val clientFox: Fox[S3AsyncClient] =
    s3ClientPool.getS3Client(s3AccessKeyCredential, uri)

  private def getRangeRequest(bucketName: String, key: String, range: StartEndExclusiveByteRange): GetObjectRequest =
    GetObjectRequest.builder().bucket(bucketName).key(key).range(range.toRangeHeader).build()

  private def getSuffixRangeRequest(bucketName: String, key: String, range: SuffixLengthByteRange): GetObjectRequest =
    GetObjectRequest.builder.bucket(bucketName).key(key).range(range.toRangeHeader).build()

  private def getRequest(bucketName: String, key: String): GetObjectRequest =
    GetObjectRequest.builder.bucket(bucketName).key(key).build()

  private def performGetObjectRequest(request: GetObjectRequest)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], String, Option[String])] = {
    val responseTransformer: AsyncResponseTransformer[GetObjectResponse, ResponseBytes[GetObjectResponse]] =
      AsyncResponseTransformer.toBytes
    for {
      client <- clientFox
      responseBytesObject: ResponseBytes[GetObjectResponse] <- notFoundToEmpty(
        client.getObject(request, responseTransformer).asScala)
      encoding = responseBytesObject.response().contentEncoding()
      contentRangeHeader = Option(responseBytesObject.response().contentRange())
      // "aws-chunked" encoding is an artifact of the upload, does not make sense for retrieval, can be ignored.
      encodingNormalized = if (encoding == null || encoding == "aws-chunked") "" else encoding
    } yield (responseBytesObject.asByteArray(), encodingNormalized, contentRangeHeader)
  }

  private def notFoundToEmpty[T](resultFuture: Future[T])(implicit ec: ExecutionContext): Fox[T] =
    Fox.fromFutureBox(resultFuture.transformWith {
      case TrySuccess(value) => Fox.successful(value).futureBox
      case TryFailure(exception) =>
        val box = exception match {
          case ce: CompletionException =>
            ce.getCause match {
              case _: NoSuchBucketException => Empty
              case _: NoSuchKeyException    => Empty
              case e: Exception =>
                BoxFailure(e.getMessage, Full(e), Empty)
            }
          case e: Exception =>
            BoxFailure(e.getMessage, Full(e), Empty)
        }
        Future.successful(box)
    })

  private def notFoundToFailure[T](resultFuture: Future[T])(implicit ec: ExecutionContext): Fox[T] =
    Fox.fromFutureBox(resultFuture.transformWith {
      case TrySuccess(value) => Fox.successful(value).futureBox
      case TryFailure(exception) =>
        Future.successful(BoxFailure(exception.getMessage, Full(exception), Empty))
    })

  override def readBytesEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Encoding.Value, Option[String])] =
    for {
      objectKey <- S3UriUtils.objectKeyFromUri(path.toRemoteUriUnsafe).toFox
      request = range match {
        case r: StartEndExclusiveByteRange => getRangeRequest(bucketName, objectKey, r)
        case r: SuffixLengthByteRange      => getSuffixRangeRequest(bucketName, objectKey, r)
        case CompleteByteRange()           => getRequest(bucketName, objectKey)
      }
      (bytes, encodingString, rangeHeader) <- performGetObjectRequest(request)
      encoding <- Encoding.fromRfc7231String(encodingString).toFox
    } yield (bytes, encoding, rangeHeader)

  override def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] =
    for {
      prefixKey <- S3UriUtils.objectKeyFromUri(path.toRemoteUriUnsafe).toFox
      s3SubPrefixKeys <- getObjectSummaries(bucketName, prefixKey, maxItems)
      vaultPaths <- tryo(s3SubPrefixKeys.map(key =>
        new VaultPath(UPath.fromStringUnsafe(s"${uri.getScheme}://$bucketName/$key"), this))).toFox
    } yield vaultPaths

  private def getObjectSummaries(bucketName: String, keyPrefix: String, maxItems: Int)(
      implicit ec: ExecutionContext): Fox[List[String]] = {
    val maxKeys = maxItems + 5 // since commonPrefixes will may out some results, we request a few more first
    val listObjectsRequest =
      ListObjectsV2Request.builder().bucket(bucketName).prefix(keyPrefix).delimiter("/").maxKeys(maxKeys).build()
    for {
      client <- clientFox
      objectListing: ListObjectsV2Response <- notFoundToFailure(client.listObjectsV2(listObjectsRequest).asScala)
      s3SubPrefixes: List[CommonPrefix] = objectListing.commonPrefixes().asScala.take(maxItems).toList
    } yield s3SubPrefixes.map(_.prefix())
  }

  override def getUsedStorageBytes(path: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] = {
    def fetchBatchRecursive(prefixKey: String,
                            client: S3AsyncClient,
                            continuationToken: Option[String],
                            alreadyMeasuredSize: Long): Fox[Long] = {
      val builder = ListObjectsV2Request.builder().bucket(bucketName).prefix(prefixKey).maxKeys(1000)
      continuationToken.foreach(builder.continuationToken)
      val request = builder.build()

      for {
        objectListing <- notFoundToFailure(client.listObjectsV2(request).asScala)
        totalCurrentSize = objectListing.contents().asScala.map(_.size()).foldLeft(alreadyMeasuredSize)(_ + _)
        result <- if (objectListing.isTruncated)
          fetchBatchRecursive(prefixKey, client, Option(objectListing.nextContinuationToken()), totalCurrentSize)
        else
          Fox.successful(totalCurrentSize)
      } yield result
    }

    for {
      rawPrefix <- S3UriUtils.objectKeyFromUri(path.toRemoteUriUnsafe).toFox
      // add a trailing slash only if it's missing
      prefixKey = if (rawPrefix.endsWith("/")) rawPrefix else rawPrefix + "/"
      client <- clientFox
      totalSize <- fetchBatchRecursive(prefixKey, client, None, 0)
    } yield totalSize
  }
  private def getUri = uri
  private def getCredential = s3AccessKeyCredential

  override def equals(obj: Any): Boolean = obj match {
    case other: S3DataVault => other.getUri == uri && other.getCredential == s3AccessKeyCredential
    case _                  => false
  }

  private lazy val hashCodeCached =
    new HashCodeBuilder(17, 31).append(uri.toString).append(s3AccessKeyCredential).toHashCode

  override def hashCode(): Int = hashCodeCached

}

object S3DataVault {
  def create(credentializedUpath: CredentializedUPath, s3ClientPool: S3ClientPool)(
      implicit ec: ExecutionContext): S3DataVault = {
    val credential = credentializedUpath.credential.flatMap {
      case f: S3AccessKeyCredential     => Some(f)
      case f: LegacyDataVaultCredential => Some(f.toS3AccessKey)
      case _                            => None
    }
    new S3DataVault(credential, credentializedUpath.upath.toRemoteUriUnsafe, s3ClientPool, ec)
  }

}
