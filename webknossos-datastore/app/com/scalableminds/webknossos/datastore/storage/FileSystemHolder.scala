package com.scalableminds.webknossos.datastore.storage

import java.lang.Thread.currentThread
import java.net.URI
import java.nio.file.spi.FileSystemProvider
import java.nio.file.{FileSystem, FileSystemAlreadyExistsException, FileSystems}
import java.util.ServiceLoader

import com.google.common.collect.ImmutableMap
import com.scalableminds.webknossos.datastore.dataformats.zarr.{FileSystemSelector, FileSystemType}
import com.typesafe.scalalogging.LazyLogging

import scala.collection.mutable

object FileSystemHolder extends LazyLogging {

  private val schemeS3 = "s3"
  private val schemeHttps = "https"

  val fileSystemsCache: mutable.Map[FileSystemSelector, FileSystem] = mutable.HashMap[FileSystemSelector, FileSystem]()

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

  def getOrCreate(fileSystemSelector: FileSystemSelector): Option[FileSystem] =
    if (fileSystemSelector.typ == FileSystemType.Uri) {
      fileSystemsCache.get(fileSystemSelector) match {
        case Some(fs) => Some(fs)
        case None =>
          val fsOpt = getOrCreateWithoutCache(fileSystemSelector)
          fsOpt.foreach(fileSystemsCache.put(fileSystemSelector, _))
          fsOpt
      }
    } else None

  private def getOrCreateWithoutCache(fileSystemSelector: FileSystemSelector): Option[FileSystem] =
    fileSystemSelector.uri.flatMap { uriStr =>
      val uri = URI.create(uriStr)
      val uriWithUser = insertUserName(uri, fileSystemSelector)

      val scheme = uri.getScheme
      val credentialsEnv = makeCredentialsEnv(fileSystemSelector, scheme)

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

  private def insertUserName(uri: URI, fileSystemSelector: FileSystemSelector): URI =
    fileSystemSelector.credentials.map { c =>
      new URI(uri.getScheme, c.user, uri.getHost, uri.getPort, uri.getPath, uri.getQuery, uri.getFragment)
    }.getOrElse(uri)

  private def makeCredentialsEnv(fileSystemSelector: FileSystemSelector, scheme: String): ImmutableMap[String, Any] =
    fileSystemSelector.credentials.map { credentials =>
      if (scheme == schemeS3) {
        ImmutableMap
          .builder[String, Any]
          .put(com.upplication.s3fs.AmazonS3Factory.ACCESS_KEY, credentials.user)
          .put(com.upplication.s3fs.AmazonS3Factory.SECRET_KEY, credentials.password)
          .build
      } else if (scheme == schemeHttps) {
        ImmutableMap.builder[String, Any].put("user", credentials.user).put("password", credentials.password).build
      } else {
        emptyEnv
      }
    }.getOrElse {
      emptyEnv
    }

  private def emptyEnv = ImmutableMap.builder[String, Any].build()
}
