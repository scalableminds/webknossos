import { Drawer, Tabs } from "antd";
import { AiImageAlignment } from "./alignment/ai_image_alignment_job";
import { AiImageSegmentation } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTraining } from "./train_ai_model/ai_model_training_job";

const { TabPane } = Tabs;

export const AiJobsDrawer = () => {
  return (
    <Drawer title="AI Jobs" placement="right" width={1200} open={true}>
      <Tabs defaultActiveKey="1">
        <TabPane tab="Image Segmentation" key="1">
          <AiImageSegmentation />
        </TabPane>
        <TabPane tab="Model Training" key="2">
          <AiModelTraining />
        </TabPane>
        <TabPane tab="Image Alignment" key="3">
          <AiImageAlignment />
        </TabPane>
      </Tabs>
    </Drawer>
  );
};
