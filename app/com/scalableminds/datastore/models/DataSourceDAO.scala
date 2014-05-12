/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.models

import com.scalableminds.braingames.binary.models.{UsableDataSource, DataSourceLike, DataSource}
import play.api.Play
import com.scalableminds.datastore.DataStorePlugin

case class DataSourceServer(serverAddress: String, serverId: String)

object DataSourceServer{
  val serverAddress = Play.current.configuration.getString("http.uri").get

  def self = {
    val serverId = NetworkInformation.MACAddress getOrElse "00:00:00:00:00"
    DataSourceServer(serverAddress, serverId)
  }
}

object NetworkInformation{
  import java.net.InetAddress
  import java.net.SocketException
  import java.net.NetworkInterface
  import java.net.UnknownHostException

  def MACAddress: Option[String] = {
    try {
      val ip = InetAddress.getLocalHost
      val network = NetworkInterface.getByInetAddress(ip)
      val mac = network.getHardwareAddress()

      Some(mac.map("%02X".format(_)).mkString(":"))
    } catch{
      case e: UnknownHostException =>
        e.printStackTrace()
        None
      case e: SocketException =>
        e.printStackTrace()
        None
    }
  }
}


object DataSourceDAO extends TemporaryStore[DataSourceLike] {
  // TODO: rethink that! maybe this should be a class instead of an object
  lazy val system = DataStorePlugin.current.get.system

  def findUsableByName(name: String): Option[UsableDataSource] =
    find(name).flatMap{
      case ds: UsableDataSource => Some(ds)
      case _ => None
    }

  def removeByName(name: String) =
    remove(name)

  def updateDataSource(d: DataSourceLike) =
    insert(d.id, d)

  def insert(d: DataSourceLike): Unit =
    insert(d.id, d)
}
