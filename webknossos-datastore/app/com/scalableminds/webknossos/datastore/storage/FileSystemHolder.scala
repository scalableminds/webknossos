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

  val fileSystemsCache: mutable.Map[FileSystemSelector, FileSystem] = mutable.HashMap[FileSystemSelector, FileSystem]()

  def findS3Provider: Option[FileSystemProvider] = {
    val i = ServiceLoader.load(classOf[FileSystemProvider], currentThread().getContextClassLoader).iterator()
    while (i.hasNext) {
      val p = i.next()
      if (p.getScheme.equalsIgnoreCase("s3")) {
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
    fileSystemSelector.uri.flatMap { uri =>
      // TODO: check if uri is s3
      val env = s3CredentialsEnv(fileSystemSelector)

      val s3Uri = URI.create(uri)
      val s3UriWithKey = fileSystemSelector.credentials.map { c =>
        new URI(s3Uri.getScheme,
                c.username,
                s3Uri.getHost,
                s3Uri.getPort,
                s3Uri.getPath,
                s3Uri.getQuery,
                s3Uri.getFragment)
      }.getOrElse(s3Uri)

      logger.info(s"Loading file system for uri $s3Uri")

      val s3fs: Option[FileSystem] = try {
        Some(FileSystems.newFileSystem(s3Uri, env, currentThread().getContextClassLoader))
      } catch {
        case _: FileSystemAlreadyExistsException =>
          try {
            findS3Provider.map(_.getFileSystem(s3UriWithKey))
          } catch {
            case e2: Exception =>
              logger.error("getFileSytem errored:", e2)
              None
          }
      }
      logger.info(s"Loaded file system $s3fs for uri $s3Uri")
      s3fs
    }

  private def s3CredentialsEnv(fileSystemSelector: FileSystemSelector): ImmutableMap[String, Any] =
    fileSystemSelector.credentials.map { credentials =>
      ImmutableMap
        .builder[String, Any]
        .put(com.upplication.s3fs.AmazonS3Factory.ACCESS_KEY, credentials.username)
        .put(com.upplication.s3fs.AmazonS3Factory.SECRET_KEY, credentials.password)
        .build
    }.getOrElse {
      ImmutableMap.builder[String, Any].build()
    }

}
