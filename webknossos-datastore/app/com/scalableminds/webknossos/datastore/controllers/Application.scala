/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.controllers

import javax.inject.Inject

import play.api.i18n.MessagesApi
import play.api.mvc.Action

class Application @Inject()(val messagesApi: MessagesApi) extends Controller {

  def health = Action { implicit request => Ok }

}
