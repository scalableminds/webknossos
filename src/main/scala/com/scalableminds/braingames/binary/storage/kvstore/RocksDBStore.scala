package com.scalableminds.braingames.binary.store.kvstore

import net.liftweb.common.{Box, Empty, Full}
import org.rocksdb.{Options, RocksDB, RocksIterator}
import net.liftweb.util.Helpers.tryo

class RocksDBIterator(it: RocksIterator, prefix: Option[String]) extends Iterator[KeyValuePair] {
  override def hasNext: Boolean = it.isValid && prefix.forall(it.key().startsWith(_))

  override def next: KeyValuePair = {
    val value = KeyValuePair(new String(it.key().map(_.toChar)) , it.value())
    it.next()
    value
  }
}

class RocksDBStore(path: String) extends KeyValueStore {
  private lazy val db = {
    RocksDB.loadLibrary()
    RocksDB.open(new Options().setCreateIfMissing(true), path)
  }

  implicit private def stringToByteArray(s: String): Array[Byte] = s.toCharArray.map(_.toByte)

  def get(key: String): Box[Array[Byte]] = {
    tryo { db.get(key) }.flatMap {
      case null =>
        Empty
      case r =>
        Full(r)
    }
  }

  def scan(key: String, prefix: Option[String]): Iterator[KeyValuePair] = {
    val it = db.newIterator()
    it.seek(key)
    new RocksDBIterator(it, prefix)
  }

  def put(key: String, value: Array[Byte]): Box[Unit] = tryo { db.put(key, value) }

  def backup = throw new Exception("not implemented")
}
