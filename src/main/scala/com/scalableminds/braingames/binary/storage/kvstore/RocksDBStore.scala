package com.scalableminds.braingames.binary.store.kvstore

import java.nio.file.Path

import com.scalableminds.util.io.PathUtils
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.rocksdb._

import scala.collection.JavaConverters._
import scala.concurrent.Future

class RocksDBIterator(it: RocksIterator, prefix: Option[String]) extends Iterator[KeyValuePair[Array[Byte]]] {
  override def hasNext: Boolean = it.isValid && prefix.forall(it.key().startsWith(_))

  override def next: KeyValuePair[Array[Byte]] = {
    val value = KeyValuePair(new String(it.key().map(_.toChar)) , it.value())
    it.next()
    value
  }
}

class RocksDBStore(path: String) extends KeyValueStore with LazyLogging {

  private lazy val db = {
    RocksDB.loadLibrary()
    RocksDB.open(new Options().setCreateIfMissing(true), path)
  }

  def get(key: String): Box[Array[Byte]] = {
    tryo { db.get(key) }.flatMap {
      case null =>
        Empty
      case r =>
        Full(r)
    }
  }

  def scan(key: String, prefix: Option[String]): Iterator[KeyValuePair[Array[Byte]]] = {
    val it = db.newIterator()
    it.seek(key)
    new RocksDBIterator(it, prefix)
  }

  def put(key: String, value: Array[Byte]): Box[Unit] = {
    tryo(db.put(key, value))
  }

  def backup(backupDir: Path): Box[BackupInfo] = {
    try {
      PathUtils.ensureDirectory(backupDir)
      RocksDB.loadLibrary()
      val backupEngine = BackupEngine.open(Env.getDefault, new BackupableDBOptions(backupDir.toString))
      backupEngine.createNewBackup(db)
      backupEngine.getBackupInfo.asScala.headOption.map(info => BackupInfo(info.backupId.toString, info.timestamp, info.size))
    } catch {
      case e: Exception =>
        Failure(s"Error creating backup: ${e.getMessage}")
    }
  }

  def close(): Future[Unit] = {
    Future.successful(db.close())
  }
}
