/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import net.liftweb.common.{Full, Empty, Failure}
import scala.concurrent.Future
import reactivemongo.api.commands.{WriteResult, LastError}
import reactivemongo.core.errors.GenericDatabaseException
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.{FoxImplicits, Fox}

trait ExceptionCatchers extends DBInteractionLogger with FoxImplicits {
  def collectionName: String

  def dbExceptionHandler: PartialFunction[Throwable, Failure] = {
    case e: Exception =>
      logger.error(s"A DB exception occoured while querying '$collectionName': ", e)
      Failure(e.getMessage, Some(e), Empty)
  }

  def withFailureHandler(e: => Future[WriteResult]): Fox[WriteResult] =
    e.map {
      case e: LastError if e.inError =>
        Failure(s"Error in '$collectionName': ${e.errmsg} ", Full(GenericDatabaseException(e.errmsg orElse e.writeErrors.headOption.map(_.errmsg) getOrElse "", e.code)), Empty)
      case lastError =>
        Full(lastError)
    }.recover(dbExceptionHandler)

  def withExceptionCatcher[A](e: => Fox[A]): Fox[A] =
    e.futureBox.recover(dbExceptionHandler)
}