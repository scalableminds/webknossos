/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import braingames.binary.api.{ BinaryDataService => AbstractBinaryDataService }
import play.api.Play
import akka.actor.ActorSystem
import braingames.binary.Logger._
import java.io.File

class BinaryDataService(val dataSourceRepository: DataSourceRepository)(implicit val system: ActorSystem) extends AbstractBinaryDataService {
  lazy val oxalisUrl = Play.current.configuration.getString("datastore.oxalis.uri") getOrElse "localhost:9000"

  lazy val isOxalisSecured = Play.current.configuration.getBoolean("datastore.oxalis.secured") getOrElse false

  lazy val isCertificateSelfSigned = Play.current.configuration.getBoolean("datastore.oxalis.selfsigned") getOrElse false

  val (keystore, keystorePassword) =
    if (isOxalisSecured && isCertificateSelfSigned) {
      val keystorePath = Play.current.configuration.getString("keystore.path") getOrElse "scmCAKeyStore"
      val keystorePassword = Play.current.configuration.getString("keystore.password") getOrElse "changeit"
      val keystore = new File(keystorePath)
      if (keystore.isFile() && keystore.canRead())
        (Some(keystore) -> Some(keystorePassword))
      else
        throw new Exception("Can't establish a selfsigned secured connection without a valid keystore")
    } else (None -> None)

  lazy val key = Play.current.configuration.getString("datastore.key") get

  lazy val name = Play.current.configuration.getString("datastore.name") get

  lazy val serverUrl = Play.current.configuration.getString("http.uri") getOrElse "http://localhost:9000"

  lazy val config = Play.current.configuration.underlying

  val oxalisServer = new OxalisServer(oxalisUrl, key, name, isOxalisSecured, keystore, keystorePassword)
}
