package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.tracings.{KeyValueStoreImplicits, TracingDataStore}

class EditableMappingService @Inject()(
    val tracingDataStore: TracingDataStore
) extends KeyValueStoreImplicits {

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

  def assertExists(editableMappingId: String): Fox[Unit] =
    for {
      _ <- tracingDataStore.editableMappings.getVersion(editableMappingId, mayBeEmpty = Some(true), version = Some(0L))
    } yield ()


  def update(editableMappingId: String, updateAction: EditableMappingUpdateAction, version: Long): Fox[Unit] = {
    for {
      _ <- tracingDataStore.editableMappingUpdates.put(editableMappingId, version, updateAction)
    } yield ()
  }
}
