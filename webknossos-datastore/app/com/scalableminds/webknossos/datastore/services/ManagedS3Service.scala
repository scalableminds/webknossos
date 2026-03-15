package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Fox, FoxImplicits}
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
import software.amazon.awssdk.transfer.s3.S3TransferManager

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class ManagedS3Service @Inject()(config: DataStoreConfig, s3ClientPoolHolder: S3ClientPoolHolder)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

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

  private lazy val s3UploadClientFox: Fox[S3AsyncClient] = for {
    s3UploadCredential <- s3UploadCredentialOpt.toFox
    client <- s3ClientPoolHolder.s3ClientPool.getS3Client(Some(s3UploadCredential),
                                                          s3UploadEndpoint,
                                                          isForUpload = true)
  } yield client

  lazy val s3UploadTransferManagerFox: Fox[S3TransferManager] = for {
    client <- s3UploadClientFox
  } yield S3TransferManager.builder().transferDirectoryMaxConcurrency(30).s3Client(client).build()

}
