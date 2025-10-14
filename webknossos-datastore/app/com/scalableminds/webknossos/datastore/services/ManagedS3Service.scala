package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.S3DataVault
import com.scalableminds.webknossos.datastore.storage.{CredentialConfigReader, S3AccessKeyCredential}
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject

class ManagedS3Service @Inject()(dataStoreConfig: DataStoreConfig) {

  private lazy val s3UploadCredentialsOpt: Option[(String, String)] =
    dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }.collectFirst {
      case S3AccessKeyCredential(credentialName, accessKeyId, secretAccessKey, _, _)
          if dataStoreConfig.Datastore.S3Upload.credentialName == credentialName =>
        (accessKeyId, secretAccessKey)
    }

  lazy val s3UploadBucketOpt: Option[String] =
    S3DataVault.hostBucketFromUri(new URI(dataStoreConfig.Datastore.S3Upload.credentialName))

  private lazy val s3UploadEndpoint: URI = {
    val credentialUri = new URI(dataStoreConfig.Datastore.S3Upload.credentialName)
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

  lazy val s3ClientBox: Box[S3AsyncClient] = for {
    accessKeyId <- Box(s3UploadCredentialsOpt.map(_._1))
    secretAccessKey <- Box(s3UploadCredentialsOpt.map(_._2))
    client <- tryo(
      S3AsyncClient
        .builder()
        .credentialsProvider(StaticCredentialsProvider.create(
          AwsBasicCredentials.builder.accessKeyId(accessKeyId).secretAccessKey(secretAccessKey).build()
        ))
        .crossRegionAccessEnabled(true)
        .forcePathStyle(true)
        .endpointOverride(s3UploadEndpoint)
        .region(Region.US_EAST_1)
        // Disabling checksum calculation prevents files being stored with Content Encoding "aws-chunked".
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .build())
  } yield client

  lazy val transferManagerBox: Box[S3TransferManager] = for {
    client <- s3ClientBox
  } yield S3TransferManager.builder().s3Client(client).build()

}
