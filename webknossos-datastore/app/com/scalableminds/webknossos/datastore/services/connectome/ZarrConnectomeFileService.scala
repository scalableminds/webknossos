package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import jakarta.inject.Inject

import scala.concurrent.ExecutionContext

class ZarrConnectomeFileService @Inject()() {
  def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext,
                                                                         tc: TokenContext): Fox[String] = ???

  def synapsesForAgglomerates(connectomeFileKey: ConnectomeFileKey, agglomerateIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[DirectedSynapseList]] = ???

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long], direction: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] = ???

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[Long]]] = ???

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SynapseTypesWithLegend] = ???

}
