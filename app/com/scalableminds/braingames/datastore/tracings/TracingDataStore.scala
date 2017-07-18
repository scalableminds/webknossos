/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import java.nio.file.Paths
import java.util.concurrent.atomic.AtomicBoolean

import com.google.inject.Inject
import com.scalableminds.braingames.binary.storage.kvstore.{BackupInfo, RocksDBManager, RocksDBStore, VersionedKeyValueStore}
import net.liftweb.common.{Box, Failure}
import play.api.Configuration
import play.api.inject.ApplicationLifecycle

class TracingDataStore @Inject()(
                                  config: Configuration,
                                  lifecycle:  ApplicationLifecycle
                                ) {

  val backupInProgress = new AtomicBoolean(false)

  private val tracingDataDir = Paths.get(config.getString("braingames.binary.tracingDataFolder").getOrElse("tracingData"))

  private val backupDir = Paths.get(config.getString("braingames.binary.backupFolder").getOrElse("backup"))

  private val rocksDB = new RocksDBManager(tracingDataDir, List("skeletons", "skeletonUpdates", "volumes", "volumeData"))

  lazy val skeletons = new VersionedKeyValueStore(rocksDB.getStoreForColumnFamily("skeletons").get)

  lazy val skeletonUpdates = new VersionedKeyValueStore(rocksDB.getStoreForColumnFamily("skeletonUpdates").get)

  lazy val volumes = new VersionedKeyValueStore(rocksDB.getStoreForColumnFamily("volumes").get)

  lazy val volumeData = new VersionedKeyValueStore(rocksDB.getStoreForColumnFamily("volumeData").get)

  def backup: Box[BackupInfo] = {
    if (backupInProgress.compareAndSet(false, true)) {
      try {
        rocksDB.backup(backupDir)
      } finally {
        backupInProgress.set(false)
      }
    } else {
      Failure("Backup already in progress.")
    }
  }

  lifecycle.addStopHook(rocksDB.close _)
}
