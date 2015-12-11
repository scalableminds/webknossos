/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.nio.file.{Files, Path}

import play.api.libs.json._
import com.scalableminds.util.tools.JsonHelper._
import net.liftweb.common._
import net.liftweb.common.Box._
import com.scalableminds.util.io.FileIO

trait SettingsFile[A] {
  def settingsFileName: String

  def settingsFileReads: Reads[A]

  def settingsFileInFolder(p: Path) = p.resolve(settingsFileName)

  def fromSettingsFileIn(p: Path): Box[A] =
    extractSettingsFromFile(
      settingsFileInFolder(p),
      settingsFileReads)

  def extractSettingsFromFile[T](path: Path, settingsReads: Reads[T]): Box[T] = {
    if (Files.isRegularFile(path)) {
      JsonFromFile(path).flatMap {
        _.validate(settingsReads) match {
          case JsSuccess(e, _) => Full(e)
          case e: JsError => Failure(e.toString)
        }
      }
    } else
      Empty
  }

  def writeSettingsToFile[T](settings: T, path: Path)(implicit writer: Writes[T]): Unit = {
    if (!Files.isDirectory(path)) {
      FileIO.printToFile(path.toFile) {
        printer =>
          printer.print(writer.writes(settings).toString)
      }
    }
  }
}
