package com.scalableminds.webknossos.datastore.datavault

import com.amazonaws.services.s3.AmazonS3
import com.amazonaws.services.s3.model.GetObjectRequest
import com.scalableminds.webknossos.datastore.datavault.S3Utilities.{
  ACCESS_KEY,
  SECRET_KEY,
  getAmazonS3Client,
  getBaseKey,
  hostBucketFromUri
}
import com.scalableminds.webknossos.datastore.storage.{RemoteSourceDescriptor, S3AccessKeyCredential}
import org.apache.commons.io.IOUtils

import java.io.InputStream
import java.net.URI
import java.util.Properties

class S3DataVault(s3AccessKeyCredential: Option[S3AccessKeyCredential], uri: URI) extends DataVault {

  lazy val accessKey: Option[String] = s3AccessKeyCredential.map(_.accessKeyId)
  lazy val secretKey: Option[String] = s3AccessKeyCredential.map(_.secretAccessKey)

  lazy val bucketName = hostBucketFromUri(uri) match {
    case Some(value) => value
    case None        => throw new Exception(s"Could not parse S3 bucket for ${uri.toString}")
  }

  val client: AmazonS3 = {
    val props = new Properties
    accessKey match {
      case Some(value) => props.put(ACCESS_KEY, value)
      case _           => {}
    }
    secretKey match {
      case Some(value) => props.put(SECRET_KEY, value)
      case _           => {}
    }
    getAmazonS3Client(props)
  }

  private def getRangeRequest(bucketName: String, key: String, range: Range): GetObjectRequest =
    new GetObjectRequest(bucketName, key).withRange(range.start, range.end)

  private def getRequest(bucketName: String, key: String): GetObjectRequest = new GetObjectRequest(bucketName, key)

  override def get(key: String, path: VaultPath, range: Option[Range]): Array[Byte] = {
    val baseKey = getBaseKey(path.toUri) match {
      case Some(value) => value
      case None        => throw new Exception(s"Could not get key for S3 from uri: ${uri.toString}")
    }
    val objectKey = Seq(baseKey, key).mkString("/")
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
  def create(remoteSourceDescriptor: RemoteSourceDescriptor) = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[S3AccessKeyCredential])
    new VaultPath(remoteSourceDescriptor.uri, new S3DataVault(credential, remoteSourceDescriptor.uri), credential)
  }
}
