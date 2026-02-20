package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Box, FoxImplicits}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, S3UriUtils, UPath}
import com.scalableminds.webknossos.datastore.storage.{
  CredentialConfigReader,
  DataVaultCredential,
  S3AccessKeyCredential
}
import com.typesafe.scalalogging.LazyLogging
import scala.jdk.DurationConverters._
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.http.nio.netty.NettyNioAsyncHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject
import scala.concurrent.duration.DurationInt

class ManagedS3Service @Inject()(config: DataStoreConfig) extends FoxImplicits with LazyLogging {

  def pathIsInManagedS3(path: UPath): Boolean =
    path.getScheme.contains(PathSchemes.schemeS3) && globalCredentials.exists(c =>
      UPath.fromString(c.name).map(path.startsWith).getOrElse(false))

  def findGlobalCredentialFor(pathOpt: Option[UPath]): Option[S3AccessKeyCredential] =
    pathOpt.flatMap(findGlobalCredentialFor)

  private def findGlobalCredentialFor(path: UPath): Option[S3AccessKeyCredential] =
    globalCredentials.collectFirst {
      case credential: S3AccessKeyCredential if path.toString.startsWith(credential.name) => credential
    }

  private lazy val globalCredentials: Seq[DataVaultCredential] = {
    val res = config.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  private lazy val s3UploadCredentialOpt: Option[S3AccessKeyCredential] =
    globalCredentials.collectFirst {
      case credential: S3AccessKeyCredential if config.Datastore.S3Upload.credentialName == credential.name =>
        credential
    }

  lazy val s3UploadBucketOpt: Option[String] =
    // by convention, the credentialName is the S3 URI so we can extract the bucket from it.
    S3UriUtils.hostBucketFromUri(new URI(config.Datastore.S3Upload.credentialName))

  private lazy val s3UploadEndpoint: URI =
    endpointForCredentialName(config.Datastore.S3Upload.credentialName)

  private def endpointForCredentialName(credentialName: String) = {
    // by convention, the credentialName is the S3 URI so we can extract the endpoint from it.
    val credentialUri = new URI(credentialName)
    new URI(
      "https",
      null,
      credentialUri.getHost,
      -1,
      null,
      null,
      null
    )
  }

  private lazy val s3UploadClientBox: Box[S3AsyncClient] = for {
    s3UploadCredential <- Box(s3UploadCredentialOpt)
    client <- buildClient(s3UploadEndpoint, s3UploadCredential)
  } yield client

  private def buildClient(endpoint: URI, credential: S3AccessKeyCredential): Box[S3AsyncClient] =
    tryo(
      S3AsyncClient
        .builder()
        .httpClientBuilder(NettyNioAsyncHttpClient.builder().connectionAcquisitionTimeout((2 minutes).toJava))
        .credentialsProvider(credential.toCredentialsProvider)
        .crossRegionAccessEnabled(true)
        .forcePathStyle(true)
        .endpointOverride(endpoint)
        .region(Region.US_EAST_1)
        // Disabling checksum calculation prevents files being stored with Content Encoding "aws-chunked".
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .build())

  lazy val s3UploadTransferManagerBox: Box[S3TransferManager] = for {
    client <- s3UploadClientBox
  } yield S3TransferManager.builder().transferDirectoryMaxConcurrency(30).s3Client(client).build()

}
