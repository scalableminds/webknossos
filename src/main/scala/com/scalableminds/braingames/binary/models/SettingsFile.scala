/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.nio.file.{Files, Path}

import com.scalableminds.util.io.FileIO
import com.scalableminds.util.json.JsonUtils
import com.scalableminds.util.tools.JsonHelper._
import net.liftweb.common._
import play.api.i18n.Messages
import play.api.libs.json._

trait SettingsFile[A] {
  def settingsFileName: String

  def settingsFileReads: Reads[A]

  def settingsFileInFolder(p: Path): Path = p.resolve(settingsFileName)

  def fromSettingsFileIn(p: Path, rootPath: Path)(implicit messages: Messages): Box[A] =
    extractSettingsFromFile(
                             settingsFileInFolder(p),
                             rootPath,
                             settingsFileReads)

  def extractSettingsFromFile[T](path: Path, rootPath: Path, settingsReads: Reads[T])
                                (implicit messages: Messages): Box[T] = {
    if (Files.isRegularFile(path)) {
      jsonFromFile(path, rootPath).flatMap {
        _.validate(settingsReads) match {
          case JsSuccess(e, _) => Full(e)
          case e: JsError =>
            val relativePath = rootPath.relativize(path)
            Failure(s"File '$relativePath' invalid. " + JsonUtils.jsError2HumanReadable(e))
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
