import AbstractTabView from "../abstract_tab_view";
import MappingInfoView from "./right-menu/mapping_info_view";
import DatasetInfoView from "../viewmode/right-menu/dataset_info_view";

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
