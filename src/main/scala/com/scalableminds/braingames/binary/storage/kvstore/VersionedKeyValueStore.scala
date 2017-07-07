/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store.kvstore

import java.nio.file.Path

import net.liftweb.common.Box
import play.api.libs.json.{Reads, Writes}

import scala.concurrent.Future
import scala.util.Try

case class VersionedKey(key: String, version: Long) {
  override def toString: String = s"$key@${(~version).toHexString.toUpperCase}@$version"
}

object VersionedKey {

  def apply(key: String): Option[VersionedKey] = {
    val parts = key.split('@')
    for {
      key <- parts.headOption
      versionString <- parts.lastOption
      version <- Try(versionString.toLong).toOption
    } yield {
      VersionedKey(key, version)
    }
  }
}

case class VersionedKeyValuePair[T](versionedKey: VersionedKey, value: T) {

  def key = versionedKey.key

  def version = versionedKey.version
}

class VersionFilterIterator[T](it: Iterator[KeyValuePair[T]], version: Option[Long]) extends Iterator[VersionedKeyValuePair[T]] {

  private var currentKey: Option[String] = None

  private var versionedIterator = it.flatMap{ pair =>
    VersionedKey(pair.key).map(VersionedKeyValuePair(_, pair.value))
  }

  override def hasNext: Boolean = {
    versionedIterator = versionedIterator.dropWhile { pair =>
      currentKey.contains(pair.key) || version.exists(pair.version > _)
    }
    versionedIterator.hasNext
  }

  override def next(): VersionedKeyValuePair[T] = {
    val value = versionedIterator.next()
    currentKey = Some(value.key)
    value
  }
}

class VersionedKeyValueStore(underlying: KeyValueStore) {

  def get(columnFamily: String, key: String, version: Option[Long] = None): Option[VersionedKeyValuePair[Array[Byte]]] =
    scanVersions(columnFamily, key, version).toStream.headOption

  def getJson[T : Reads](columnFamily: String, key: String, version: Option[Long] = None): Option[VersionedKeyValuePair[T]] =
    scanVersionsJson(columnFamily, key, version).toStream.headOption

  def scanVersions(columnFamily: String, key: String, version: Option[Long] = None): Iterator[VersionedKeyValuePair[Array[Byte]]] = {
    val prefix = s"$key@"
    underlying.scan(columnFamily, version.map(VersionedKey(key, _).toString).getOrElse(prefix), Some(prefix)).flatMap { pair =>
      VersionedKey(pair.key).map(VersionedKeyValuePair(_, pair.value))
    }
  }

  def scanVersionsJson[T : Reads](columnFamily: String, key: String, version: Option[Long] = None): Iterator[VersionedKeyValuePair[T]] = {
    val prefix = s"$key@"
    underlying.scanJson(columnFamily, version.map(VersionedKey(key, _).toString).getOrElse(prefix), Some(prefix)).flatMap { pair =>
      VersionedKey(pair.key).map(VersionedKeyValuePair(_, pair.value))
    }
  }

  def scanKeys(columnFamily: String, key: String, prefix: Option[String] = None, version: Option[Long] = None): Iterator[VersionedKeyValuePair[Array[Byte]]] =
    new VersionFilterIterator(underlying.scan(columnFamily, key, prefix), version)

  def scanKeysJson[T : Reads](columnFamily: String, key: String, prefix: Option[String] = None, version: Option[Long] = None): Iterator[VersionedKeyValuePair[T]] =
    new VersionFilterIterator(underlying.scanJson(columnFamily, key, prefix), version)

  def put(columnFamily: String, key: String, version: Long, value: Array[Byte]): Box[Unit] =
    underlying.put(columnFamily, VersionedKey(key, version).toString, value)

  def putJson[T : Writes](columnFamily: String, key: String, version: Long, value: T): Box[Unit] =
    underlying.putJson(columnFamily, VersionedKey(key, version).toString, value)

  def backup(backupDir: Path): Box[BackupInfo] = underlying.backup(backupDir)

  def close(): Future[Unit] = underlying.close()
}
