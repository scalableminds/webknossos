/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.storage.kvstore

import java.nio.file.Path
import java.util

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.rocksdb._

import scala.collection.JavaConverters._
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class RocksDBManager(path: Path, columnFamilies: List[String]) {

  val (db, columnFamilyHandles) = {
    RocksDB.loadLibrary()
    val columnOptions = new ColumnFamilyOptions()
      .setArenaBlockSize(4 * 1024 * 1024)               // 4MB
      .setTargetFileSizeBase(1024 * 1024 * 1024)        // 1GB
      .setMaxBytesForLevelBase(10 * 1024 * 1024 * 1024) // 10GB
    val columnFamilyDescriptors = (columnFamilies.map(_.getBytes) :+ RocksDB.DEFAULT_COLUMN_FAMILY).map { columnFamily =>
      new ColumnFamilyDescriptor(columnFamily, columnOptions)
    }
    val columnFamilyHandles = new util.ArrayList[ColumnFamilyHandle]
    val options = new DBOptions()
      .setCreateIfMissing(true)
      .setCreateMissingColumnFamilies(true)
    val db = RocksDB.open(
      options,
      path.toAbsolutePath.toString,
      columnFamilyDescriptors.asJava,
      columnFamilyHandles)
    (db, columnFamilies.zip(columnFamilyHandles.asScala).toMap)
  }

  def getStoreForColumnFamily(columnFamily: String): Option[RocksDBStore] = {
    columnFamilyHandles.get(columnFamily).map(new RocksDBStore(db, _))
  }

  def backup(backupDir: Path): Box[BackupInfo] = {
    try {
      PathUtils.ensureDirectory(backupDir)
      RocksDB.loadLibrary()
      val backupEngine = BackupEngine.open(Env.getDefault, new BackupableDBOptions(backupDir.toString))
      backupEngine.createNewBackup(db)
      backupEngine.purgeOldBackups(1)
      backupEngine.getBackupInfo.asScala.headOption.map(info => BackupInfo(info.backupId.toString, info.timestamp, info.size))
    } catch {
      case e: Exception =>
        Failure(s"Error creating RocksDB backup: ${e.getMessage}")
    }
  }

  def close(): Future[Unit] = {
    Future.successful(db.close())
  }
}

class RocksDBIterator(it: RocksIterator, prefix: Option[String]) extends Iterator[KeyValuePair[Array[Byte]]] {

  override def hasNext: Boolean = it.isValid && prefix.forall(it.key().startsWith(_))

  override def next: KeyValuePair[Array[Byte]] = {
    val value = KeyValuePair(new String(it.key().map(_.toChar)) , it.value())
    it.next()
    value
  }
}

class RocksDBStore(db: RocksDB, handle: ColumnFamilyHandle) extends KeyValueStore with FoxImplicits {

  def get(key: String): Fox[Array[Byte]] = {
    tryo { db.get(handle, key) }.flatMap {
      case null =>
        Empty
      case r =>
        Full(r)
    }
  }

  def scan(key: String, prefix: Option[String]): Iterator[KeyValuePair[Array[Byte]]] = {
    val it = db.newIterator(handle)
    it.seek(key)
    new RocksDBIterator(it, prefix)
  }

  def put(key: String, value: Array[Byte]): Fox[Unit] = {
    tryo(db.put(handle, key, value))
  }
}
