import { Drawer, Tabs } from "antd";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

export const AiJobsDrawer = () => {
  const items = [
    {
      label: "Image Segmentation",
      key: "1",
      children: <AiImageSegmentationJob />,
    },
    {
      label: "Model Training",
      key: "2",
      children: <AiModelTrainingJob />,
    },
    {
      label: "Image Alignment",
      key: "3",
      children: <AiImageAlignmentJob />,
    },
  ];

  return (
    <Drawer title="AI Jobs" placement="right" width={1200} open={true}>
      <Tabs defaultActiveKey="2" items={items} />
    </Drawer>
  );
};
