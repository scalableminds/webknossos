package com.scalableminds.datastore.services

import com.typesafe.config.Config
import play.api.Configuration
import scala.concurrent.duration._
/**
  * Created by tmbo on 29.11.16.
  */
class ConfigurationService(conf: Configuration) {
  def underlying: Config = conf.underlying

  case class KeyStoreConfig(path: String, password: String)

  case class DataStoreConfig(name: String, key: String)

  case class OxalisConf(url: String, secured: Boolean, selfSigned: Boolean, pingInterval: FiniteDuration)

  lazy val keyStore: KeyStoreConfig = {
    val path = conf.getString("keyStore.path").getOrElse("scmCAKeyStore")
    val password = conf.getString("keyStore.password").getOrElse("changeit")
    KeyStoreConfig(path, password)
  }

  lazy val dataStore: DataStoreConfig = {
    val name: String = conf.getString("datastore.name").get
    val key: String = conf.getString("datastore.key").get
    DataStoreConfig(name, key)
  }

  lazy val oxalis: OxalisConf = {
    val url = conf.getString("datastore.oxalis.uri").getOrElse("localhost:9000")
    val selfSigned = conf.getBoolean("datastore.oxalis.selfsigned").getOrElse(false)
    val secured = conf.getBoolean("datastore.oxalis.secured").getOrElse(false)
    val pingInterval = conf.getInt("datastore.oxalis.pingIntervalMinutes").getOrElse(10).minutes
    OxalisConf(url, secured, selfSigned, pingInterval)
  }

  lazy val serverUrl: String =
    conf.getString("http.uri").getOrElse("http://localhost:9000")
}
