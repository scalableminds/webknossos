package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

class EditableMappingService @Inject()() {
  def generateId: String = UUID.randomUUID.toString

  def create(implicit ec: ExecutionContext): Fox[String] =
    Fox.successful(generateId)
}

case class EditableMappingUpdateAction()
