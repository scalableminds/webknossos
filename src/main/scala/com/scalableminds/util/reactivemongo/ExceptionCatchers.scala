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
  def dbExceptionHandler: PartialFunction[Throwable, Failure] = {
    case e: Exception =>
      logger.error("A DB exception occoured.", e)
      Failure(e.getMessage, Some(e), Empty)
  }

  def withFailureHandler(e: => Future[WriteResult]): Fox[WriteResult] =
    e.map {
      case LastError(false, errMsg, code, _, _, err, _, _, _, _, _, _) =>
        Failure(s"$errMsg ($err)", Full(GenericDatabaseException(errMsg orElse err getOrElse "", code)), Empty)
      case lastError =>
        Full(lastError)
    }.recover(dbExceptionHandler)

  def withExceptionCatcher[A](e: => Fox[A]): Fox[A] =
    e.futureBox.recover(dbExceptionHandler)
}