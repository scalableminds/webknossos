package models.aimodels

import com.scalableminds.util.enumeration.ExtendedEnumeration

object AiModelCategory extends ExtendedEnumeration {
  type AiModelCategory = Value
  val em_neurons, em_nuclei, em_synapses, em_neuron_types, em_cell_organelles = Value
}
