package com.scalableminds.braingames.datastore.tracings

trait UpdateActionGroup {

  def version: Long

  def timestamp: Long
}
