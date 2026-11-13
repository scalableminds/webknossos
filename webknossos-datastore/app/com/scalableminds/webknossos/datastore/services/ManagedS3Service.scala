package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.box.Box
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, S3UriUtils, UPath}
import com.scalableminds.webknossos.datastore.storage.{
  CredentialConfigReader,
  DataVaultCredential,
  S3AccessKeyCredential,
  S3ClientPoolHolder
}
import com.typesafe.scalalogging.LazyLogging
import software.amazon.awssdk.services.s3.S3AsyncClient
import software.amazon.awssdk.services.s3.model.{
  Delete,
  DeleteObjectRequest,
  DeleteObjectsRequest,
  ListObjectsV2Request,
  ObjectIdentifier
}
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters.*
import scala.jdk.FutureConverters.*

class ManagedS3Service @Inject() (
    config: DataStoreConfig,
    baseDirService: BaseDirService,
    s3ClientPoolHolder: S3ClientPoolHolder
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  private val transferManagerCache: AlfuCache[(URI, S3AccessKeyCredential), S3TransferManager] =
    AlfuCache(
      timeToIdle = 356.days,
      timeToLive = 356.days,
      onRemovalFn = Some { (_, managerBox) =>
        managerBox.foreach(_.close())
      }
    )

  def pathIsInManagedS3(path: UPath): Boolean =
    path.getScheme.contains(PathSchemes.schemeS3) && globalCredentials.exists(c =>
      UPath.fromString(c.name).map(path.startsWith).getOrElse(false)
    )

  def hasGlobalS3Credentials: Boolean =
    globalCredentials.exists(_.isInstanceOf[S3AccessKeyCredential])

  def findGlobalCredentialFor(pathOpt: Option[UPath]): Option[S3AccessKeyCredential] =
    pathOpt.flatMap(findGlobalCredentialFor)

  private def findGlobalCredentialFor(path: UPath): Option[S3AccessKeyCredential] =
    globalCredentials.collectFirst {
      case credential: S3AccessKeyCredential if UPath.fromString(credential.name).exists(path.startsWith) =>
        credential
    }

  private lazy val globalCredentials: Seq[DataVaultCredential] = {
    val res = config.Datastore.DataVaults.credentials.flatMap { credentialConfig =>
      new CredentialConfigReader(credentialConfig).getCredential
    }
    logger.info(s"Parsed ${res.length} global data vault credentials from datastore config.")
    res
  }

  def isS3UploadEnabled(organizationId: String): Boolean =
    s3UploadBaseDir(organizationId).isDefined

  def s3UploadBaseDir(organizationId: String): Box[UPath] =
    baseDirService.getOneForOrga(organizationId, requireS3 = true, requireAllowsUpload = true)

  private def transferManagerForEndpoint(
      s3UploadEndpoint: URI,
      credential: S3AccessKeyCredential
  ): Fox[S3TransferManager] =
    transferManagerCache.getOrLoad(
      (s3UploadEndpoint, credential),
      _ =>
        for {
          client <- s3ClientPoolHolder.s3ClientPool.getS3Client(Some(credential), s3UploadEndpoint, isForUpload = true)
          transferManager = S3TransferManager.builder().transferDirectoryMaxConcurrency(30).s3Client(client).build()
        } yield transferManager
    )

  def transferManager(targetPath: UPath): Fox[S3TransferManager] = for {
    endpoint <- S3UriUtils.endpointFromUPath(targetPath).toFox
    credential <- findGlobalCredentialFor(targetPath).toFox
    transferManager <- transferManagerForEndpoint(endpoint, credential)
  } yield transferManager

  // Deletes the object at path (if it is a file) and all objects below it (if it is a directory)
  def deleteRecursively(path: UPath): Fox[Unit] =
    for {
      uri <- path.toRemoteUri.toFox
      // Query and fragment would silently be dropped from the object key, so that a different path would be deleted
      _ <- Fox.fromBool(uri.getRawQuery == null && uri.getRawFragment == null) ?~>
        s"Refusing to delete $path, as it contains URI query or fragment delimiters"
      bucket <- S3UriUtils.hostBucketFromUPath(path).toFox
      key <- S3UriUtils.objectKeyFromUPath(path).map(_.stripSuffix("/")).toFox
      credential <- findGlobalCredentialFor(path).toFox ?~> s"No global S3 credential found for $path"
      credentialRoot <- UPath.fromString(credential.name).toFox
      credentialRootBucket <- S3UriUtils.hostBucketFromUPath(credentialRoot).toFox
      credentialRootKey <- S3UriUtils.objectKeyFromUPath(credentialRoot).map(_.stripSuffix("/")).toFox
      // Compare the actual object keys, so that only paths strictly below the credential root can be deleted
      _ <- Fox.fromBool(bucket == credentialRootBucket && isStrictlyBelow(key, credentialRootKey)) ?~>
        s"Refusing to delete $path, as it is not strictly below the managed S3 credential root ${credential.name}"
      client <- s3ClientPoolHolder.s3ClientPool.getS3Client(Some(credential), uri, isForUpload = true)
      _ <- deleteAllWithPrefix(client, bucket, key + "/", continuationToken = None)
      _ <- Fox.fromFuture(client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build()).asScala)
    } yield ()

  private def isStrictlyBelow(key: String, rootKey: String): Boolean =
    key.nonEmpty && (rootKey.isEmpty || key.startsWith(rootKey + "/"))

  private def deleteAllWithPrefix(
      client: S3AsyncClient,
      bucket: String,
      prefix: String,
      continuationToken: Option[String]
  ): Fox[Unit] = {
    val requestBuilder = ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).maxKeys(1000)
    continuationToken.foreach(requestBuilder.continuationToken)
    for {
      listing <- Fox.fromFuture(client.listObjectsV2(requestBuilder.build()).asScala)
      keys = listing.contents().asScala.map(_.key()).toSeq
      _ <- Fox.runIf(keys.nonEmpty)(deleteObjects(client, bucket, keys))
      _ <-
        if (listing.isTruncated)
          deleteAllWithPrefix(client, bucket, prefix, Option(listing.nextContinuationToken()))
        else Fox.successful(())
    } yield ()
  }

  private def deleteObjects(client: S3AsyncClient, bucket: String, keys: Seq[String]): Fox[Unit] = {
    val objectIdentifiers = keys.map(key => ObjectIdentifier.builder().key(key).build())
    val request = DeleteObjectsRequest
      .builder()
      .bucket(bucket)
      .delete(Delete.builder().objects(objectIdentifiers.asJava).quiet(true).build())
      .build()
    for {
      response <- Fox.fromFuture(client.deleteObjects(request).asScala)
      errors = response.errors().asScala
      _ <- Fox.fromBool(
        errors.isEmpty
      ) ?~> s"Failed to delete ${errors.length} objects in bucket $bucket. First error: ${errors.headOption
          .map(e => s"${e.key()}: ${e.code()} ${e.message()}")
          .getOrElse("")}"
    } yield ()
  }

}
