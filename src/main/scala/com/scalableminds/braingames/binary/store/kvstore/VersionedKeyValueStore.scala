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

case class VersionedKeyValuePair(versionedKey: VersionedKey, value: Array[Byte])

class VersionFilterIterator(it: Iterator[KeyValuePair], version: Option[Long]) extends Iterator[KeyValuePair] {
  private var currentKey: Option[String] = None

  private var versionedIt = it.flatMap(kv => VersionedKey(kv.key).map(VersionedKeyValuePair(_, kv.value)))

  override def hasNext: Boolean = {
    versionedIt = versionedIt.dropWhile { kv =>
      currentKey.contains(kv.versionedKey.key) || version.exists(kv.versionedKey.version > _)
    }
    versionedIt.hasNext
  }

  override def next(): KeyValuePair = {
    val value = versionedIt.next()
    currentKey = Some(value.versionedKey.key)
    KeyValuePair(value.versionedKey.key, value.value)
  }
}

class VersionedKeyValueStore(underlying: KeyValueStore) {
  def get(key: String, version: Option[Long] = None): Box[Array[Byte]] = {
    val it = version match {
      case Some(version) =>
        underlying.scan(key, Some(key)).dropWhile(kv =>
          VersionedKey(kv.key).forall(_.version > version))
      case None =>
        underlying.scan(key, Some(key))
    }
    it.toStream.headOption.map(_.value)
  }

  def scan(key: String, prefix: Option[String] = None, version: Option[Long] = None): Iterator[KeyValuePair] =
    new VersionFilterIterator(underlying.scan(key, prefix), version)

  def put(key: String, version: Long, value: Array[Byte]): Box[Unit] =
    underlying.put(VersionedKey(key, version).toString, value)

  def backup = underlying.backup
}
