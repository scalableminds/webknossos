package com.scalableminds.webknossos.datastore.storage

import java.lang.Thread.currentThread
import java.net.URI
import java.nio.file.spi.FileSystemProvider
import java.nio.file.{FileSystem, FileSystemAlreadyExistsException, FileSystems}
import java.util.ServiceLoader

import com.google.common.collect.ImmutableMap
import com.scalableminds.webknossos.datastore.dataformats.zarr.RemoteSourceDescriptor
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable

object FileSystemHolder extends LazyLogging {

  private val schemeS3 = "s3"
  private val schemeHttps = "https"

  // TODO use real cache
  val fileSystemsCache: mutable.Map[RemoteSourceDescriptor, FileSystem] =
    mutable.HashMap[RemoteSourceDescriptor, FileSystem]()

  def findProvider(scheme: String): Option[FileSystemProvider] = {
    val i = ServiceLoader.load(classOf[FileSystemProvider], currentThread().getContextClassLoader).iterator()
    while (i.hasNext) {
      val p = i.next()
      if (p.getScheme.equalsIgnoreCase(scheme)) {
        return Some(p)
      }
    }
    None
  }

  def getOrCreate(remoteSource: RemoteSourceDescriptor): Option[FileSystem] =
    fileSystemsCache.get(remoteSource) match {
      case Some(fs) => Some(fs)
      case None =>
        val fsOpt = getOrCreateWithoutCache(remoteSource)
        fsOpt.foreach(fileSystemsCache.put(remoteSource, _))
        fsOpt
    }

  private def getOrCreateWithoutCache(remoteSource: RemoteSourceDescriptor): Option[FileSystem] = {
    val uriWithPath = URI.create(remoteSource.uri)
    val uri = baseUri(uriWithPath)
    val uriWithUser = insertUserName(uri, remoteSource)

    val scheme = uri.getScheme
    val credentialsEnv = makeCredentialsEnv(remoteSource, scheme)

    logger.info(s"Loading file system for uri $uri")

    val fs: Option[FileSystem] = try {
      Some(FileSystems.newFileSystem(uri, credentialsEnv, currentThread().getContextClassLoader))
    } catch {
      case _: FileSystemAlreadyExistsException =>
        try {
          findProvider(uri.getScheme).map(_.getFileSystem(uriWithUser))
        } catch {
          case e2: Exception =>
            logger.error("getFileSytem errored:", e2)
            None
        }
    }
    logger.info(s"Loaded file system $fs for uri $uri")
    fs
  }

  private def insertUserName(uri: URI, remoteSource: RemoteSourceDescriptor): URI =
    remoteSource.user.map { user =>
      new URI(uri.getScheme, user, uri.getHost, uri.getPort, uri.getPath, uri.getQuery, uri.getFragment)
    }.getOrElse(uri)

  private def baseUri(uri: URI): URI =
    new URI(uri.getScheme, uri.getUserInfo, uri.getHost, uri.getPort, null, null, null)

  private def makeCredentialsEnv(remoteSource: RemoteSourceDescriptor, scheme: String): ImmutableMap[String, Any] =
    (for {
      user <- remoteSource.user
      password <- remoteSource.password
    } yield {
      if (scheme == schemeS3) {
        ImmutableMap
          .builder[String, Any]
          .put(com.upplication.s3fs.AmazonS3Factory.ACCESS_KEY, user)
          .put(com.upplication.s3fs.AmazonS3Factory.SECRET_KEY, password)
          .build
      } else if (scheme == schemeHttps) {
        ImmutableMap.builder[String, Any].put("user", user).put("password", password).build
      } else emptyEnv
    }).getOrElse(emptyEnv)

  private def emptyEnv = ImmutableMap.builder[String, Any].build()
}
