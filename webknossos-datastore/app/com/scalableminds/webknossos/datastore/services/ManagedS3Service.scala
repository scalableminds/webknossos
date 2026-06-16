package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Box, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, S3UriUtils, UPath}
import com.scalableminds.webknossos.datastore.storage.{CredentialConfigReader, DataVaultCredential, S3AccessKeyCredential, S3ClientPoolHolder}
import com.typesafe.scalalogging.LazyLogging
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class ManagedS3Service @Inject()(config: DataStoreConfig, baseDirService: BaseDirService, s3ClientPoolHolder: S3ClientPoolHolder)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def isS3UploadEnabled(organizationId: String): Boolean =
    baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true).isDefined

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

  private def s3UploadCredential(s3UploadBaseDir: UPath): Box[S3AccessKeyCredential] = for {
    credential <- Box(globalCredentials.collectFirst {
      case credential: S3AccessKeyCredential if UPath.fromString(credential.name).exists(s3UploadBaseDir.startsWith)=>
      credential
    })
  } yield credential

  def s3UploadBucket(organizationId: String): Box[String] =
    for {
      s3UploadUPath <- baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true)
      s3UploadUri <- s3UploadUPath.toRemoteUri
      hostBucket <- Box(S3UriUtils.hostBucketFromUri(s3UploadUri))
    } yield hostBucket

  def s3UploadOrgaObjectKeyPrefix(organizationId: String): Box[String] = for {
    s3UploadUPath <- baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true)
    s3UploadUri <- s3UploadUPath.toRemoteUri
    rootObjectKey <- S3UriUtils.objectKeyFromUri(s3UploadUri)
  } yield rootObjectKey

  def s3UploadEndpointHost(organizationId: String): Box[String] = for {
    s3UploadBaseDir <- baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true)
    endpoint <- s3UploadEndpoint(s3UploadBaseDir)
  } yield endpoint.getHost

  private def s3UploadEndpoint(s3UploadBaseDir: UPath): Box[URI] =
    for {
      s3UploadUri <- s3UploadBaseDir.toRemoteUri
      endpoint = endpointForS3Uri(s3UploadUri)
    } yield endpoint

  private def endpointForS3Uri(uri: URI) = {
    // Construct new URI, take just the host
    new URI(
      "https",
      null,
      uri.getHost,
      -1,
      null,
      null,
      null
    )
  }

  // TODO cache
  private def transferManagerForEndpoint(s3UploadEndpoint: URI, credential: S3AccessKeyCredential): Fox[S3TransferManager] = for {
    client <- s3ClientPoolHolder.s3ClientPool.getS3Client(Some(credential),
                                                          s3UploadEndpoint,
                                                          isForUpload = true)
    transferManager = S3TransferManager.builder().transferDirectoryMaxConcurrency(30).s3Client(client).build()
  } yield transferManager

  def s3UploadTransferManager(organizationId: String): Fox[S3TransferManager] = for {
    s3UploadBaseDir <- baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true).toFox
    endpoint <- s3UploadEndpoint(s3UploadBaseDir).toFox
    credential <- s3UploadCredential(s3UploadBaseDir).toFox
    transferManager <- transferManagerForEndpoint(endpoint, credential)
  } yield transferManager

}
