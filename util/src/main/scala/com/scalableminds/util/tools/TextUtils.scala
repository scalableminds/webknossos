package com.scalableminds.util.tools

import java.io.{PrintWriter, StringWriter}
import scala.concurrent.ExecutionContext

object TextUtils {
  private val replacementMap = Map(
    "ü" -> "ue",
    "Ü" -> "Ue",
    "ö" -> "oe",
    "Ö" -> "Oe",
    "ä" -> "ae",
    "Ä" -> "Ae",
    "ß" -> "ss",
    "é" -> "e",
    "è" -> "e",
    "ê" -> "e",
    "È" -> "E",
    "É" -> "E",
    "Ê" -> "E",
    "Ç" -> "C",
    "ç" -> "c",
    "ñ" -> "n",
    "Ñ" -> "N",
    "ë" -> "e",
    "Ë" -> "E",
    "ï" -> "i",
    "Ï" -> "I",
    "å" -> "a",
    "Å" -> "A",
    "œ" -> "oe",
    "Œ" -> "Oe",
    "æ" -> "ae",
    "Æ" -> "Ae",
    "þ" -> "th",
    "Þ" -> "Th",
    "ø" -> "oe",
    "Ø" -> "Oe",
    "í" -> "i",
    "ì" -> "i"
  )

  def normalize(s: String): String =
    if (s == null)
      s
    else {
      s.map(c => replacementMap.getOrElse(c.toString, c.toString)).mkString
    }

  def normalizeStrong(s: String): Option[String] = {
    val normalized = normalize(s).replaceAll("[^A-Za-z0-9_\\-\\s]", "")
    if (normalized.isEmpty)
      None
    else
      Some(normalized)
  }

  def stackTraceAsString(t: Throwable): String = {
    val sw = new StringWriter
    t.printStackTrace(new PrintWriter(sw))
    sw.toString
  }

  def parseCommaSeparated[T](commaSeparatedStrOpt: Option[String])(parseEntry: String => Fox[T])(
      implicit ec: ExecutionContext): Fox[List[T]] =
    commaSeparatedStrOpt match {
      case None                                                 => Fox.successful(List.empty)
      case Some(commaSeparatedStr) if commaSeparatedStr.isEmpty => Fox.successful(List.empty)
      case Some(commaSeparatedStr) =>
        Fox.serialCombined(commaSeparatedStr.split(",").toList)(entry => parseEntry(entry))
    }

  def pluralize(string: String, amount: Int): String =
    if (amount == 1) string else s"${string}s"
}
