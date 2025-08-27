import { Drawer, Tabs } from "antd";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

const { TabPane } = Tabs;

export const AiJobsDrawer = () => {
  return (
    <Drawer title="AI Jobs" placement="right" width={1200} open={true}>
      <Tabs defaultActiveKey="1">
        <TabPane tab="Image Segmentation" key="1">
          <AiImageSegmentationJob />
        </TabPane>
        <TabPane tab="Model Training" key="2">
          <AiModelTrainingJob />
        </TabPane>
        <TabPane tab="Image Alignment" key="3">
          <AiImageAlignmentJob />
        </TabPane>
      </Tabs>
    </Drawer>
  );
};
