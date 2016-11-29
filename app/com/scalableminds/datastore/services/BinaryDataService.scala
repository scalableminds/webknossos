/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import java.io.File

import akka.actor.ActorSystem
import com.scalableminds.braingames.binary.api.{BinaryDataService => AbstractBinaryDataService}
import com.typesafe.config.Config
import play.api.i18n.MessagesApi

class BinaryDataService(val dataSourceRepository: DataSourceRepository,
                        confService: ConfigurationService,
                        oxalisServer: OxalisServer)
                       (val messagesApi: MessagesApi)
                       (implicit val system: ActorSystem)
  extends AbstractBinaryDataService {

  lazy val serverUrl: String =
    confService.serverUrl

  lazy val config: Config = confService.underlying
}
