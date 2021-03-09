package com.scalableminds.util.tools

import java.io.{PrintWriter, StringWriter}

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
}
