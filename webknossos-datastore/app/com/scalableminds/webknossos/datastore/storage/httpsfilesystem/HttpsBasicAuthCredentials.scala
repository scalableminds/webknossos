package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.util

import scala.jdk.CollectionConverters.mapAsScalaMapConverter

case class HttpsBasicAuthCredentials(user: String, password: String)

object HttpsBasicAuthCredentials {
  def fromEnvMap(env: util.Map[String, _]): Option[HttpsBasicAuthCredentials] = {
    val envAsScala = env.asScala
    val userOpt = envAsScala.get("user")
    val passwordOpt = envAsScala.get("password")
    for {
      user <- userOpt
      password <- passwordOpt
    } yield HttpsBasicAuthCredentials(user.asInstanceOf[String], password.asInstanceOf[String])
  }
}
