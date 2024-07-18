package com.scalableminds.webknossos.datastore.datavault

import com.amazonaws.AmazonServiceException
import com.amazonaws.auth.{
  AWSCredentialsProvider,
  AWSStaticCredentialsProvider,
  AnonymousAWSCredentials,
  BasicAWSCredentials,
  EnvironmentVariableCredentialsProvider
}
import com.amazonaws.client.builder.AwsClientBuilder.EndpointConfiguration
import com.amazonaws.regions.Regions
import com.amazonaws.services.s3.{AmazonS3, AmazonS3ClientBuilder}
import com.amazonaws.services.s3.model.{GetObjectRequest, ListObjectsV2Request, S3Object}
import com.amazonaws.util.AwsHostNameUtils
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.scalableminds.webknossos.datastore.storage.{
  LegacyDataVaultCredential,
  RemoteSourceDescriptor,
  S3AccessKeyCredential
}
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Failure, Full}
import org.apache.commons.io.IOUtils
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.net.URI
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters._

class S3DataVault(s3AccessKeyCredential: Option[S3AccessKeyCredential], uri: URI) extends DataVault {
  private lazy val bucketName = S3DataVault.hostBucketFromUri(uri) match {
    case Some(value) => value
    case None        => throw new Exception(s"Could not parse S3 bucket for ${uri.toString}")
  }

  private lazy val client: AmazonS3 =
    S3DataVault.getAmazonS3Client(s3AccessKeyCredential, uri)

  private def getRangeRequest(bucketName: String, key: String, range: NumericRange[Long]): GetObjectRequest =
    new GetObjectRequest(bucketName, key).withRange(range.start, range.end)

  private def getSuffixRangeRequest(bucketName: String, key: String, length: Long): GetObjectRequest = {
    val req = new GetObjectRequest(bucketName, key)
    // Suffix length range request is not supported by aws sdk
    // see https://github.com/aws/aws-sdk-java/issues/1551#issuecomment-382540551 for this workaround
    req.setRange(0) // Disable MD5 checksum, which fails on partial reads
    req.putCustomRequestHeader("Range", s"bytes=-$length")
    req
  }

  private def getRequest(bucketName: String, key: String): GetObjectRequest = new GetObjectRequest(bucketName, key)

  private def performGetObjectRequest(request: GetObjectRequest)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], String)] = {
    var s3objectRef: Option[S3Object] = None // Used for cleanup later (possession of a S3Object requires closing it)
    try {
      val s3object = client.getObject(request)
      s3objectRef = Some(s3object)
      val bytes = IOUtils.toByteArray(s3object.getObjectContent)
      val encodingStr = Option(s3object.getObjectMetadata.getContentEncoding).getOrElse("")
      Fox.successful(bytes, encodingStr)
    } catch {
      case e: AmazonServiceException =>
        e.getStatusCode match {
          case 404 => Fox.empty
          case _   => Fox.failure(e.getMessage)
        }
      case e: Exception => Fox.failure(e.getMessage)
    } finally {
      s3objectRef match {
        case Some(obj) => obj.close()
        case None      =>
      }
    }
  }

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] =
    for {
      objectKey <- Fox.box2Fox(S3DataVault.objectKeyFromUri(path.toUri))
      request = range match {
        case StartEnd(r)     => getRangeRequest(bucketName, objectKey, r)
        case SuffixLength(l) => getSuffixRangeRequest(bucketName, objectKey, l)
        case Complete()      => getRequest(bucketName, objectKey)
      }
      (bytes, encodingString) <- performGetObjectRequest(request)
      encoding <- Encoding.fromRfc7231String(encodingString)
    } yield (bytes, encoding)

  override def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] =
    for {
      prefixKey <- Fox.box2Fox(S3DataVault.objectKeyFromUri(path.toUri))
      s3SubPrefixKeys <- getObjectSummaries(bucketName, prefixKey, maxItems)
      vaultPaths <- tryo(
        s3SubPrefixKeys.map(key => new VaultPath(new URI(s"${uri.getScheme}://$bucketName/$key"), this))).toFox
    } yield vaultPaths

  private def getObjectSummaries(bucketName: String, keyPrefix: String, maxItems: Int)(
      implicit ec: ExecutionContext): Fox[List[String]] =
    try {
      val listObjectsRequest = new ListObjectsV2Request
      listObjectsRequest.setBucketName(bucketName)
      listObjectsRequest.setPrefix(keyPrefix)
      listObjectsRequest.setDelimiter("/")
      listObjectsRequest.setMaxKeys(maxItems)
      val objectListing = client.listObjectsV2(listObjectsRequest)
      val s3SubPrefixes = objectListing.getCommonPrefixes.asScala.toList
      Fox.successful(s3SubPrefixes)
    } catch {
      case e: AmazonServiceException =>
        e.getStatusCode match {
          case 404 => Fox.empty
          case _   => Fox.failure(e.getMessage)
        }
      case e: Exception => Fox.failure(e.getMessage)
    }

  private def getUri = uri
  private def getCredential = s3AccessKeyCredential

  override def equals(obj: Any): Boolean = obj match {
    case other: S3DataVault => other.getUri == uri && other.getCredential == s3AccessKeyCredential
    case _                  => false
  }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(uri.toString).append(s3AccessKeyCredential).toHashCode
}

object S3DataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor): S3DataVault = {
    val credential = remoteSourceDescriptor.credential.flatMap {
      case f: S3AccessKeyCredential     => Some(f)
      case f: LegacyDataVaultCredential => Some(f.toS3AccessKey)
      case _                            => None
    }
    new S3DataVault(credential, remoteSourceDescriptor.uri)
  }

  private def hostBucketFromUri(uri: URI): Option[String] = {
    val host = uri.getHost
    if (isShortStyle(uri)) { // assume host is omitted from uri, shortcut form s3://bucket/key
      Some(host)
    } else if (isVirtualHostedStyle(uri)) {
      Some(host.substring(0, host.length - ".s3.amazonaws.com".length))
    } else if (isPathStyle(uri)) {
      Some(uri.getPath.substring(1).split("/")(0))
    } else {
      None
    }
  }

  // https://bucket-name.s3.region-code.amazonaws.com/key-name
  private def isVirtualHostedStyle(uri: URI): Boolean =
    uri.getHost.endsWith(".s3.amazonaws.com")

  // https://s3.region-code.amazonaws.com/bucket-name/key-name
  private def isPathStyle(uri: URI): Boolean =
    uri.getHost.matches("s3(.[\\w\\-_]+)?.amazonaws.com") ||
      (!uri.getHost.contains("amazonaws.com") && uri.getHost.contains("."))

  // S3://bucket-name/key-name
  private def isShortStyle(uri: URI): Boolean =
    !uri.getHost.contains(".")

  private def objectKeyFromUri(uri: URI): Box[String] =
    if (isVirtualHostedStyle(uri)) {
      Full(uri.getPath)
    } else if (isPathStyle(uri)) {
      Full(uri.getPath.substring(1).split("/").tail.mkString("/"))
    } else if (isShortStyle(uri)) {
      Full(uri.getPath.tail)
    } else Failure(s"Not a valid s3 uri: $uri")

  private def getCredentialsProvider(credentialOpt: Option[S3AccessKeyCredential]): AWSCredentialsProvider =
    credentialOpt match {
      case Some(s3AccessKeyCredential: S3AccessKeyCredential) =>
        new AWSStaticCredentialsProvider(
          new BasicAWSCredentials(s3AccessKeyCredential.accessKeyId, s3AccessKeyCredential.secretAccessKey))
      case None if sys.env.contains("AWS_ACCESS_KEY_ID") || sys.env.contains("AWS_ACCESS_KEY") =>
        new EnvironmentVariableCredentialsProvider
      case None =>
        new AnonymousAWSCredentialsProvider
    }

  private def isNonAmazonHost(uri: URI): Boolean =
    isPathStyle(uri) && !uri.getHost.endsWith(".amazonaws.com")

  private def getAmazonS3Client(credentialOpt: Option[S3AccessKeyCredential], uri: URI): AmazonS3 = {
    val basic = AmazonS3ClientBuilder.standard
      .withCredentials(getCredentialsProvider(credentialOpt))
      .withForceGlobalBucketAccessEnabled(true)
    if (isNonAmazonHost(uri))
      basic
        .withPathStyleAccessEnabled(true)
        .withEndpointConfiguration(
          new EndpointConfiguration(
            s"http://${uri.getAuthority}",
            AwsHostNameUtils.parseRegion(uri.getAuthority, "s3")
          )
        )
        .build()
    else basic.withRegion(Regions.DEFAULT_REGION).build()
  }

}

class AnonymousAWSCredentialsProvider extends AWSCredentialsProvider {
  override def getCredentials = new AnonymousAWSCredentials

  override def refresh(): Unit = {}
}
