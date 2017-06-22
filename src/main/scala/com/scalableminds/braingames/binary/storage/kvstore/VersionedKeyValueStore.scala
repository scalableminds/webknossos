/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store.kvstore

import net.liftweb.common.Box

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

case class VersionedKeyValuePair(versionedKey: VersionedKey, value: Array[Byte]) {
  def key = versionedKey.key
  def version = versionedKey.version
}

class VersionFilterIterator(it: Iterator[KeyValuePair], version: Option[Long]) extends Iterator[VersionedKeyValuePair] {
  private var currentKey: Option[String] = None

  private var versionedIterator = it.flatMap(kv => VersionedKey(kv.key).map(VersionedKeyValuePair(_, kv.value)))

  override def hasNext: Boolean = {
    versionedIterator = versionedIterator.dropWhile { kv =>
      currentKey.contains(kv.key) || version.exists(kv.version > _)
    }
    versionedIterator.hasNext
  }

  override def next(): VersionedKeyValuePair = {
    val value = versionedIterator.next()
    currentKey = Some(value.key)
    value
  }
}

class VersionedKeyValueStore(underlying: KeyValueStore) {
  def get(key: String, version: Option[Long] = None): Box[VersionedKeyValuePair] =
    scan(key, Some(key), version).toStream.headOption

  def scan(key: String, prefix: Option[String] = None, version: Option[Long] = None): Iterator[VersionedKeyValuePair] =
    new VersionFilterIterator(underlying.scan(key, prefix), version)

  def put(key: String, version: Long, value: Array[Byte]): Box[Unit] =
    underlying.put(VersionedKey(key, version).toString, value)

  def backup = underlying.backup
}
