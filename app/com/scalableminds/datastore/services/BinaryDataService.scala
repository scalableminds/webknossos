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

  val keyStoreInfo =
    if (isOxalisSecured && isCertificateSelfSigned) {
      val keyStorePath = Play.current.configuration.getString("keyStore.path") getOrElse "scmCAKeyStore"
      val keyStorePassword = Play.current.configuration.getString("keyStore.password") getOrElse "changeit"
      val keyStore = new File(keyStorePath)
      if (keyStore.isFile() && keyStore.canRead())
        Some(KeyStoreInfo(keyStore, keyStorePassword))
      else
        throw new Exception("Can't establish a selfsigned secured connection without a valid keystore")
    } else None
  
  val webSocketSecurityInfo = WSSecurityInfo(isOxalisSecured, isCertificateSelfSigned, keyStoreInfo)

  lazy val key = Play.current.configuration.getString("datastore.key") get

  lazy val name = Play.current.configuration.getString("datastore.name") get

  lazy val serverUrl = Play.current.configuration.getString("http.uri") getOrElse "http://localhost:9000"

  lazy val config = Play.current.configuration.underlying

  val oxalisServer = new OxalisServer(oxalisUrl, key, name, webSocketSecurityInfo)
}
