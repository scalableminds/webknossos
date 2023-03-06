package com.scalableminds.webknossos.datastore.storage

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.StorageOptions
import com.google.cloud.storage.contrib.nio.{CloudStorageConfiguration, CloudStorageFileSystem}
import com.scalableminds.util.cache.AlfuFoxCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datavault.{
  GoogleCloudDataVault,
  HttpsDataVault,
  VaultPath,
  S3DataVault
}
import com.scalableminds.webknossos.datastore.s3fs.{S3FileSystem, S3FileSystemProvider}
import com.scalableminds.webknossos.datastore.storage.httpsfilesystem.HttpsFileSystem
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.file.FileSystem
import scala.concurrent.ExecutionContext

object FileSystemsHolder extends LazyLogging {

  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"

  private val fileSystemsCache: AlfuFoxCache[RemoteSourceDescriptor, FileSystem] =
    AlfuFoxCache(maxEntries = 100)

  private val remotePathCache: AlfuFoxCache[RemoteSourceDescriptor, VaultPath] =
    AlfuFoxCache(maxEntries = 100)

  def isSupportedRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)

  def getOrCreate(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[FileSystem] =
    fileSystemsCache.getOrLoad(remoteSource, create)

  def getOrCreateRemote(remoteSourceDescriptor: RemoteSourceDescriptor)(
      implicit ec: ExecutionContext): Fox[VaultPath] =
    remotePathCache.getOrLoad(remoteSourceDescriptor, createRemote)

  def create(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[FileSystem] = {
    val scheme = remoteSource.uri.getScheme
    try {
      val fs: FileSystem = if (scheme == schemeGS) {
        getGoogleCloudStorageFileSystem(remoteSource)
      } else if (scheme == schemeS3) {
        getAmazonS3FileSystem(remoteSource)
      } else if (scheme == schemeHttps || scheme == schemeHttp) {
        getHttpsFileSystem(remoteSource)
      } else {
        throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Successfully created file system for ${remoteSource.uri.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"get file system errored for ${remoteSource.uri.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }

  def createRemote(remoteSource: RemoteSourceDescriptor)(implicit ec: ExecutionContext): Fox[VaultPath] = {
    val scheme = remoteSource.uri.getScheme
    try {
      val fs: VaultPath = if (scheme == schemeGS) {
        GoogleCloudDataVault.create(remoteSource)
      } else if (scheme == schemeS3) {
        S3DataVault.create(remoteSource)
      } else if (scheme == schemeHttps || scheme == schemeHttp) {
        HttpsDataVault.create(remoteSource)
      } else {
        throw new Exception(s"Unknown file system scheme $scheme")
      }
      logger.info(s"Successfully created file system for ${remoteSource.uri.toString}")
      Fox.successful(fs)
    } catch {
      case e: Exception =>
        val msg = s"get file system errored for ${remoteSource.uri.toString}:"
        logger.error(msg, e)
        Fox.failure(msg, Full(e))
    }
  }

  private def getGoogleCloudStorageFileSystem(remoteSource: RemoteSourceDescriptor): FileSystem = {
    val bucketName = remoteSource.uri.getHost
    val storageOptions = buildCredentialStorageOptions(remoteSource)
    CloudStorageFileSystem.forBucket(bucketName, CloudStorageConfiguration.DEFAULT, storageOptions)
  }

  private def getAmazonS3FileSystem(remoteSource: RemoteSourceDescriptor): FileSystem =
    remoteSource.credential match {
      case Some(credential: S3AccessKeyCredential) =>
        S3FileSystem.forUri(remoteSource.uri, credential.accessKeyId, credential.secretAccessKey)
      case Some(credential: LegacyFileSystemCredential) =>
        S3FileSystem.forUri(remoteSource.uri,
                            credential.toS3AccessKey.accessKeyId,
                            credential.toS3AccessKey.secretAccessKey)
      case _ =>
        S3FileSystem.forUri(remoteSource.uri)
    }

  private def getHttpsFileSystem(remoteSource: RemoteSourceDescriptor): FileSystem =
    remoteSource.credential match {
      case Some(credential: HttpBasicAuthCredential) =>
        HttpsFileSystem.forUri(remoteSource.uri, Some(credential))
      case Some(credential: LegacyFileSystemCredential) =>
        HttpsFileSystem.forUri(remoteSource.uri, Some(credential.toBasicAuth))
      case _ =>
        HttpsFileSystem.forUri(remoteSource.uri)
    }

  private def buildCredentialStorageOptions(remoteSource: RemoteSourceDescriptor) =
    remoteSource.credential match {
      case Some(credential: GoogleServiceAccountCredential) =>
        StorageOptions
          .newBuilder()
          .setCredentials(
            ServiceAccountCredentials.fromStream(new ByteArrayInputStream(credential.secretJson.toString.getBytes)))
          .build()
      case _ => StorageOptions.newBuilder().build()
    }

  def pathFromUri(uri: URI): String =
    if (uri.getScheme == schemeS3) {
      // There are several s3 uri styles. Normalize, then drop bucket name (and handle leading slash)
      "/" + S3FileSystemProvider.resolveShortcutHost(uri).getPath.split("/").drop(2).mkString("/")
    } else uri.getPath
}
