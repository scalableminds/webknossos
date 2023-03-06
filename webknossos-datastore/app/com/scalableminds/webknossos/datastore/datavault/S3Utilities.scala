package com.scalableminds.webknossos.datastore.datavault

import com.amazonaws.auth.{
  AWSCredentialsProvider,
  AWSStaticCredentialsProvider,
  AnonymousAWSCredentials,
  BasicAWSCredentials
}
import com.amazonaws.regions.Regions
import com.amazonaws.services.s3.{AmazonS3, AmazonS3ClientBuilder}

import java.net.URI
import java.util.Properties

class S3Utilities {}

class AnonymousAWSCredentialsProvider extends AWSCredentialsProvider {
  override def getCredentials = new AnonymousAWSCredentials

  override def refresh(): Unit = {}
}

object S3Utilities {

  val S3_HOSTNAME = "s3.amazonaws.com"
  val ACCESS_KEY = "s3fs_access_key"
  val SECRET_KEY = "s3fs_secret_key"

  def hostBucketFromUri(uri: URI): Option[String] = {
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

  /*
    With uri given to explore the dataset, get a string that will be used as a prefix for all further
    keys that are requested
   */
  def getBaseKey(uri: URI): Option[String] =
    if (isVirtualHostedStyle(uri)) {
      Some(uri.getPath)
    } else if (isPathStyle(uri)) {
      Some(uri.getPath.substring(1).split("/").tail.mkString("/"))
    } else if (isShortStyle(uri)) { Some(uri.getPath) } else {
      None
    }

  def getAWSCredentials(props: Properties) =
    new BasicAWSCredentials(props.getProperty(ACCESS_KEY), props.getProperty(SECRET_KEY))

  def getCredentialsProvider(props: Properties): AWSCredentialsProvider = {
    if (props.getProperty(ACCESS_KEY) == null && props.getProperty(SECRET_KEY) == null)
      return new AnonymousAWSCredentialsProvider
    new AWSStaticCredentialsProvider(getAWSCredentials(props))
  }

  def getAmazonS3Client(props: Properties): AmazonS3 =
    AmazonS3ClientBuilder.standard
      .withCredentials(getCredentialsProvider(props))
      .withRegion(Regions.DEFAULT_REGION)
      .withForceGlobalBucketAccessEnabled(true)
      .build

}
