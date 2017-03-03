import AbstractTabView from "oxalis/view/abstract_tab_view";
import MappingInfoView from "oxalis/view/volumetracing/right-menu/mapping_info_view";
import DatasetInfoView from "oxalis/view/viewmode/right-menu/dataset_info_view";

class VolumeTracingRightMenuView extends AbstractTabView {

  getTabs() {
    return [
      {
        id: "tab-info",
        name: "Info",
        viewClass: DatasetInfoView,
      },
      {
        id: "volume-mapping-info",
        name: "Mapping Info",
        viewClass: MappingInfoView,
      },
    ];
  }
}

export default VolumeTracingRightMenuView;
