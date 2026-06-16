package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{PathSchemes, S3UriUtils, UPath}
import com.scalableminds.webknossos.datastore.storage.{CredentialConfigReader, DataVaultCredential, S3AccessKeyCredential, S3ClientPoolHolder}
import com.typesafe.scalalogging.LazyLogging
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class ManagedS3Service @Inject()(config: DataStoreConfig, baseDirService: BaseDirService, s3ClientPoolHolder: S3ClientPoolHolder)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val transferManagerCache: AlfuCache[(URI, S3AccessKeyCredential), S3TransferManager] =
    AlfuCache(timeToIdle = 356.days, timeToLive = 356.days)

  def pathIsInManagedS3(path: UPath): Boolean =
    path.getScheme.contains(PathSchemes.schemeS3) && globalCredentials.exists(c =>
      UPath.fromString(c.name).map(path.startsWith).getOrElse(false))

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
    baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true).isDefined

  def s3UploadBaseDir(organizationId: String): Box[UPath] =
    baseDirService.getOneS3ForOrga(organizationId, requireAllowsUpload = true)

  private def transferManagerForEndpoint(s3UploadEndpoint: URI, credential: S3AccessKeyCredential): Fox[S3TransferManager] =
    transferManagerCache.getOrLoad((s3UploadEndpoint, credential), _ => {
      for {
        client <- s3ClientPoolHolder.s3ClientPool.getS3Client(Some(credential),
          s3UploadEndpoint,
          isForUpload = true)
        transferManager = S3TransferManager.builder().transferDirectoryMaxConcurrency(30).s3Client(client).build()
      } yield transferManager
    })

  def transferManager(targetPath: UPath): Fox[S3TransferManager] = for {
    endpoint <- S3UriUtils.endpointFromUPath(targetPath).toFox
    credential <- findGlobalCredentialFor(targetPath).toFox
    transferManager <- transferManagerForEndpoint(endpoint, credential)
  } yield transferManager

}
