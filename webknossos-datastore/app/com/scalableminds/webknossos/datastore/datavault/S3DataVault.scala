package com.scalableminds.webknossos.datastore.datavault

import com.amazonaws.auth.{
  AWSCredentialsProvider,
  AWSStaticCredentialsProvider,
  AnonymousAWSCredentials,
  BasicAWSCredentials,
  EnvironmentVariableCredentialsProvider
}
import com.amazonaws.regions.Regions
import com.amazonaws.services.s3.{AmazonS3, AmazonS3ClientBuilder}
import com.amazonaws.services.s3.model.GetObjectRequest
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{RemoteSourceDescriptor, S3AccessKeyCredential}
import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.IOUtils

import java.net.URI
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class S3DataVault(s3AccessKeyCredential: Option[S3AccessKeyCredential], uri: URI) extends DataVault {
  private lazy val bucketName = S3DataVault.hostBucketFromUri(uri) match {
    case Some(value) => value
    case None        => throw new Exception(s"Could not parse S3 bucket for ${uri.toString}")
  }

  val client: AmazonS3 =
    S3DataVault.getAmazonS3Client(s3AccessKeyCredential)

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

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] =
    for {
      objectKey <- S3DataVault.objectKeyFromUri(path.toUri)
      request = range match {
        case StartEnd(r)     => getRangeRequest(bucketName, objectKey, r)
        case SuffixLength(l) => getSuffixRangeRequest(bucketName, objectKey, l)
        case Complete()      => getRequest(bucketName, objectKey)
      }
      obj <- tryo(client.getObject(request))
      encodingStr = Option(obj.getObjectMetadata.getContentEncoding).getOrElse("")
      encoding <- Encoding.fromRfc7231String(encodingStr)
    } yield (IOUtils.toByteArray(obj.getObjectContent), encoding)
}

object S3DataVault {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor): S3DataVault = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[S3AccessKeyCredential])
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
    uri.getHost.matches("s3(.[\\w\\-_]+)?.amazonaws.com")

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

  private def getAmazonS3Client(credentialOpt: Option[S3AccessKeyCredential]): AmazonS3 =
    AmazonS3ClientBuilder.standard
      .withCredentials(getCredentialsProvider(credentialOpt))
      .withRegion(Regions.DEFAULT_REGION)
      .withForceGlobalBucketAccessEnabled(true)
      .build
}

class AnonymousAWSCredentialsProvider extends AWSCredentialsProvider {
  override def getCredentials = new AnonymousAWSCredentials

  override def refresh(): Unit = {}
}
