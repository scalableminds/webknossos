package com.scalableminds.webknossos.datastore.datavault

import com.amazonaws.auth.{
  AWSCredentialsProvider,
  AWSStaticCredentialsProvider,
  AnonymousAWSCredentials,
  BasicAWSCredentials
}
import com.amazonaws.regions.Regions
import com.amazonaws.services.s3.{AmazonS3, AmazonS3ClientBuilder}
import com.amazonaws.services.s3.model.GetObjectRequest
import com.scalableminds.webknossos.datastore.storage.{RemoteSourceDescriptor, S3AccessKeyCredential}
import org.apache.commons.io.IOUtils

import java.io.InputStream
import java.net.URI
import scala.collection.immutable.NumericRange

class S3DataVault(s3AccessKeyCredential: Option[S3AccessKeyCredential], uri: URI) extends DataVault {
  private lazy val bucketName = S3DataVault.hostBucketFromUri(uri) match {
    case Some(value) => value
    case None        => throw new Exception(s"Could not parse S3 bucket for ${uri.toString}")
  }

  val client: AmazonS3 =
    S3DataVault.getAmazonS3Client(s3AccessKeyCredential)

  private def getRangeRequest(bucketName: String, key: String, range: NumericRange[Long]): GetObjectRequest =
    new GetObjectRequest(bucketName, key).withRange(range.start, range.end)

  private def getRequest(bucketName: String, key: String): GetObjectRequest = new GetObjectRequest(bucketName, key)

  override def readBytes(path: VaultPath, range: Option[NumericRange[Long]]): Array[Byte] = {
    val objectKey = S3DataVault.getObjectKeyFromUri(path.toUri) match {
      case Some(value) => value
      case None        => throw new Exception(s"Could not get key for S3 from uri: ${uri.toString}")
    }
    val getObjectRequest = range match {
      case Some(r) => getRangeRequest(bucketName, objectKey, r)
      case None    => getRequest(bucketName, objectKey)
    }

    val is: InputStream =
      client.getObject(getObjectRequest).getObjectContent
    IOUtils.toByteArray(is)
  }
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

  private def getObjectKeyFromUri(uri: URI): Option[String] =
    if (isVirtualHostedStyle(uri)) {
      Some(uri.getPath)
    } else if (isPathStyle(uri)) {
      Some(uri.getPath.substring(1).split("/").tail.mkString("/"))
    } else if (isShortStyle(uri)) {
      Some(uri.getPath.tail)
    } else {
      None
    }

  private def getCredentialsProvider(credentialOpt: Option[S3AccessKeyCredential]): AWSCredentialsProvider =
    credentialOpt match {
      case Some(s3AccessKeyCredential: S3AccessKeyCredential) =>
        new AWSStaticCredentialsProvider(
          new BasicAWSCredentials(s3AccessKeyCredential.accessKeyId, s3AccessKeyCredential.secretAccessKey))
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
