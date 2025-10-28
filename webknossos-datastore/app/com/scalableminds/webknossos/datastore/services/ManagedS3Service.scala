package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Box, Fox, FoxImplicits}
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, S3UriUtils, UPath}
import com.scalableminds.webknossos.datastore.storage.{CredentialConfigReader, S3AccessKeyCredential}
import com.typesafe.scalalogging.LazyLogging
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.model.{
  Delete,
  DeleteObjectsRequest,
  DeleteObjectsResponse,
  ListObjectsV2Request,
  ObjectIdentifier
}
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters._
import scala.jdk.FutureConverters._

class ManagedS3Service @Inject()(dataStoreConfig: DataStoreConfig) extends FoxImplicits with LazyLogging {

  private lazy val s3UploadCredentialsOpt: Option[(String, String)] =
    dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }.collectFirst {
      case S3AccessKeyCredential(credentialName, accessKeyId, secretAccessKey, _, _)
          if dataStoreConfig.Datastore.S3Upload.credentialName == credentialName =>
        (accessKeyId, secretAccessKey)
    }

  lazy val s3UploadBucketOpt: Option[String] =
    // by convention, the credentialName is the S3 URI so we can extract the bucket from it.
    S3UriUtils.hostBucketFromUri(new URI(dataStoreConfig.Datastore.S3Upload.credentialName))

  private lazy val s3UploadEndpoint: URI = {
    // by convention, the credentialName is the S3 URI so we can extract the bucket from it.
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

  private lazy val s3ClientBox: Box[S3AsyncClient] = for {
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

  def deletePaths(paths: Seq[UPath])(implicit ec: ExecutionContext): Fox[Unit] = {
    val pathsByBucket: Map[Option[String], Seq[UPath]] = paths.groupBy(S3UriUtils.hostBucketFromUpath)
    for {
      _ <- Fox.serialCombined(pathsByBucket.keys) { bucket: Option[String] =>
        deleteS3PathsOnBucket(bucket, pathsByBucket(bucket))
      }
    } yield ()
  }

  private def deleteS3PathsOnBucket(bucketOpt: Option[String], paths: Seq[UPath])(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      bucket <- bucketOpt.toFox ?~> "Could not determine S3 bucket from UPath"
      s3Client <- s3ClientBox.toFox ?~> "No managed s3 client configured"
      prefixes <- Fox.combined(paths.map(path => S3UriUtils.objectKeyFromUri(path.toRemoteUriUnsafe).toFox))
      keys: Seq[String] <- Fox.serialCombined(prefixes)(listKeysAtPrefix(s3Client, bucket, _)).map(_.flatten)
      uniqueKeys = keys.distinct
      _ = logger.info(s"Deleting ${uniqueKeys.length} objects from managed S3 bucket $bucket...")
      _ <- Fox.serialCombined(uniqueKeys.grouped(1000).toSeq)(deleteBatch(s3Client, bucket, _)).map(_ => ())
      _ = logger.info(s"Successfully deleted ${uniqueKeys.length} objects from managed S3 bucket $bucket.")
    } yield ()

  private def deleteBatch(s3Client: S3AsyncClient, bucket: String, keys: Seq[String])(
      implicit ec: ExecutionContext): Fox[DeleteObjectsResponse] =
    if (keys.isEmpty) Fox.empty
    else {
      Fox.fromFuture(
        s3Client
          .deleteObjects(
            DeleteObjectsRequest
              .builder()
              .bucket(bucket)
              .delete(
                Delete
                  .builder()
                  .objects(
                    keys.map(k => ObjectIdentifier.builder().key(k).build()).asJava
                  )
                  .build()
              )
              .build()
          )
          .asScala)
    }

  private def listKeysAtPrefix(s3Client: S3AsyncClient, bucket: String, prefix: String)(
      implicit ec: ExecutionContext): Fox[Seq[String]] = {
    def listRecursive(continuationToken: Option[String], acc: Seq[String]): Fox[Seq[String]] = {
      val builder = ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).maxKeys(1000)
      val request = continuationToken match {
        case Some(token) => builder.continuationToken(token).build()
        case None        => builder.build()
      }
      for {
        response <- Fox.fromFuture(s3Client.listObjectsV2(request).asScala)
        keys = response.contents().asScala.map(_.key())
        allKeys = acc ++ keys
        result <- if (response.isTruncated) {
          listRecursive(Option(response.nextContinuationToken()), allKeys)
        } else {
          Fox.successful(allKeys)
        }
      } yield result
    }

    listRecursive(None, Seq())
  }

  private lazy val globalCredentials = {
    val res = dataStoreConfig.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  def pathIsInManagedS3(path: UPath): Boolean =
    path.getScheme.contains(PathSchemes.schemeS3) && globalCredentials.exists(c =>
      UPath.fromString(c.name).map(path.startsWith).getOrElse(false))

}
