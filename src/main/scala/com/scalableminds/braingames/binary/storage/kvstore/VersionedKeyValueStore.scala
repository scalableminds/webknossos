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
  override def toString: String = s"${key}@${(-version).toHexString.toUpperCase}@${version}"
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

  private var versionedIterator = it.flatMap(kv => VersionedKey(kv.key).map(VersionedKeyValuePair(_, kv.value)))

  override def hasNext: Boolean = {
    versionedIterator = versionedIterator.dropWhile { kv =>
      currentKey.contains(kv.key) || version.exists(kv.version > _)
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

  def get(key: String, version: Option[Long] = None): Box[VersionedKeyValuePair[Array[Byte]]] =
    scan(key, Some(key), version).toStream.headOption

  def scan(key: String, prefix: Option[String] = None, version: Option[Long] = None): Iterator[VersionedKeyValuePair[Array[Byte]]] =
    new VersionFilterIterator(underlying.scan(key, prefix), version)

  def put(key: String, version: Long, value: Array[Byte]): Box[Unit] =
    underlying.put(VersionedKey(key, version).toString, value)

  def getJson[T : Reads](key: String, version: Option[Long] = None): Box[VersionedKeyValuePair[T]] =
    scanJson(key, Some(key), version).toStream.headOption

  def scanJson[T : Reads](key: String, prefix: Option[String] = None, version: Option[Long] = None): Iterator[VersionedKeyValuePair[T]] =
    new VersionFilterIterator(underlying.scanJson(key, prefix), version)

  def putJson[T : Writes](key: String, version: Long, value: T): Box[Unit] =
    underlying.putJson(VersionedKey(key, version).toString, value)

  def backup(backupDir: Path): Box[BackupInfo] = underlying.backup(backupDir)

  def close(): Future[Unit] = underlying.close()
}
