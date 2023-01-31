package com.scalableminds.webknossos.datastore.storage

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.StorageOptions
import com.google.cloud.storage.contrib.nio.{CloudStorageConfiguration, CloudStorageFileSystem}
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.webknossos.datastore.s3fs.{S3FileSystem, S3FileSystemProvider}
import com.scalableminds.webknossos.datastore.storage.httpsfilesystem.HttpsFileSystem
import com.typesafe.scalalogging.LazyLogging

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.file.FileSystem

object FileSystemsHolder extends LazyLogging {

  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"

  class FileSystemsCache(val maxEntries: Int) extends LRUConcurrentCache[RemoteSourceDescriptor, FileSystem]
  private val fileSystemsCache = new FileSystemsCache(maxEntries = 100)

  def isSupportedRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)

  def getOrCreate(remoteSource: RemoteSourceDescriptor): Option[FileSystem] =
    fileSystemsCache.getOrLoadAndPutOptional(remoteSource)(create)

  def create(remoteSource: RemoteSourceDescriptor): Option[FileSystem] = {
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
      Some(fs)
    } catch {
      case e: Exception =>
        logger.error(s"get file system errored for ${remoteSource.uri.toString}:", e)
        None
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
        S3FileSystem.forUri(remoteSource.uri, credential.keyId, credential.key)
      case _ =>
        S3FileSystem.forUri(remoteSource.uri)
    }

  private def getHttpsFileSystem(remoteSource: RemoteSourceDescriptor): FileSystem =
    remoteSource.credential match {
      case Some(credential: HttpBasicAuthCredential) =>
        HttpsFileSystem.forUri(remoteSource.uri, Some(credential))
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
