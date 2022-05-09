package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore
) {

  def generateId: String = UUID.randomUUID.toString

  def create(baseMappingName: String): Fox[String] = {
    val newId = generateId
    val newEditableMapping = EditableMapping(
      baseMappingName,
      Map(),
      Map(),
      Map(),
      Map(),
    )
    for {
      _ <- tracingDataStore.editableMappings.put(newId, 0L, newEditableMapping.toBytes)
    } yield newId
  }
}
