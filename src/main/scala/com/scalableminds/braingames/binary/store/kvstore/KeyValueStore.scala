/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store.kvstore

import net.liftweb.common.Box

case class KeyValuePair(key: String, value: Array[Byte])

trait KeyValueStore {
  def get(key: String): Box[Array[Byte]]

  def scan(key: String, prefix: Option[String] = None): Iterator[KeyValuePair]

  def put(key: String, value: Array[Byte]): Box[Unit]

  def backup: Unit
}
