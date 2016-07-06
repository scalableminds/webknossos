/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.models

import java.nio.file.{Files, Path, Paths}

import com.scalableminds.braingames.binary._
import com.scalableminds.util.io.PathUtils
import java.io._
import java.util.UUID

import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.braingames.binary.models.DataSource
import com.typesafe.scalalogging.LazyLogging

case class VolumeUpdate(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  resolution: Int,
  cuboid: Cuboid,
  dataFile: String) {
}

object VolumeUpdateService extends LazyLogging {
  private def writeDataToFile(data: Array[Byte]) = {
  	val userBackupFolder = PathUtils.ensureDirectory(Paths.get("userBinaryData").resolve("logging"))
  	val backupFile = userBackupFolder.resolve(UUID.randomUUID().toString + ".raw")
  	val os = Files.newOutputStream(backupFile)
  	os.write(data)
  	os.close()
  	backupFile.toString
  }

  def store(request: DataRequest) = {
  	request match {
	  	case writeRequest: DataWriteRequest =>
	  		val update = VolumeUpdate(writeRequest.dataSource, writeRequest.dataLayer, writeRequest.dataSection, writeRequest.resolution, writeRequest.cuboid, writeDataToFile(writeRequest.data))
	  		logger.info(s"Volume update: $update")
 		case _ =>
  	}
  }
}
