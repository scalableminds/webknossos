package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.webknossos.datastore.services.connectome.SynapticPartnerDirection.SynapticPartnerDirection

trait ConnectomeFileUtils {

  protected val keyCsrIndptr = "CSR_indptr"
  protected val keyCscIndptr = "CSC_indptr"
  protected val keyCsrIndices = "CSR_indices"
  protected val keyAgglomeratePairOffsets = "agglomerate_pair_offsets"
  protected val keyCscAgglomeratePair = "CSC_agglomerate_pair"
  protected val keySynapseTypes = "synapse_types"
  protected val keySynapsePositions = "synapse_positions"
  protected val keySynapseToSrcAgglomerate = "synapse_to_src_agglomerate"
  protected val keySynapseToDstAgglomerate = "synapse_to_dst_agglomerate"

  protected val attrKeyMetadataMappingName = "metadata/mapping_name"
  protected val attrKeySynapseTypeNames = "synapse_type_names"

  protected def synapticPartnerKey(direction: SynapticPartnerDirection): String =
    direction match {
      case SynapticPartnerDirection.src => keySynapseToSrcAgglomerate
      case SynapticPartnerDirection.dst => keySynapseToDstAgglomerate
    }
}
