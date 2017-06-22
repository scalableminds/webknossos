package com.scalableminds.braingames.datastore.tracings.volume

import com.scalableminds.braingames.binary.dataformats.{BucketProvider, Cube}
import com.scalableminds.braingames.binary.models.requests.ReadInstruction
import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingBucketProvider(layer: VolumeTracingLayer) extends BucketProvider {

  override def loadFromUnderlying(readInstruction: ReadInstruction): Fox[Cube] = Fox.empty

}
