/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.store.kvstore

import java.nio.file.Path
import java.util.ArrayList
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

class RocksDBStore(path: String, columnFamilies: List[String]) extends KeyValueStore {

  val (db, columnFamilyHandles) = {
    RocksDB.loadLibrary()
    val columnFamilyDescriptors = (columnFamilies.map(_.getBytes) :+ RocksDB.DEFAULT_COLUMN_FAMILY).map { columnFamily =>
      new ColumnFamilyDescriptor(columnFamily, new ColumnFamilyOptions())
    }
    val columnFamilyHandles = new ArrayList[ColumnFamilyHandle]
    val db = RocksDB.open(
      new DBOptions().setCreateIfMissing(true).setCreateMissingColumnFamilies(true),
      path,
      columnFamilyDescriptors.asJava,
      columnFamilyHandles)
    (db, columnFamilies.zip(columnFamilyHandles.asScala).toMap)
  }

  def get(columnFamily: String, key: String): Box[Array[Byte]] = {
    columnFamilyHandles.get(columnFamily).flatMap { handle =>
      tryo { db.get(handle, key) }.flatMap {
        case null =>
          Empty
        case r =>
          Full(r)
      }
    }
  }

  def scan(columnFamily: String, key: String, prefix: Option[String]): Iterator[KeyValuePair[Array[Byte]]] = {
    columnFamilyHandles.get(columnFamily) match {
      case Some(handle) =>
        val it = db.newIterator(handle)
        it.seek(key)
        new RocksDBIterator(it, prefix)
      case _ =>
        Iterator.empty
    }
  }

  def put(columnFamily: String, key: String, value: Array[Byte]): Box[Unit] = {
    columnFamilyHandles.get(columnFamily).flatMap { handle =>
      tryo(db.put(handle, key, value))
    }
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
        Failure(s"Error creating RocksDB backup: ${e.getMessage}")
    }
  }

  def close(): Future[Unit] = {
    Future.successful(db.close())
  }
}
