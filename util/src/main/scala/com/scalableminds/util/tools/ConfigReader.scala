package com.scalableminds.util.tools

import java.time.Duration

import play.api.Configuration

trait ConfigReader {
  def raw: Configuration

  def getString(path: String): String =
    openOrThrowException(path, raw.getString(path), "String")

  def getInt(path: String): Int =
    openOrThrowException(path, raw.getInt(path), "Int")

  def getBoolean(path: String): Boolean =
    openOrThrowException(path, raw.getBoolean(path), "Boolean")

  def getDuration(path: String): Duration =
    openOrThrowException(path, Some(raw.underlying.getDuration(path)), "Duration")

  def openOrThrowException[T](path: String, value: Option[T], typ: String) = {
    value match {
      case Some(value) => value
      case None => throw new Exception(s"Required config value is missing: $path (type $typ)")
    }
  }
}
