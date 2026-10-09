import proofreadingDendrites from "@images/vx/proofreading-dendrites.webp";
import AdCard from "admin/ads/ad_card";
import features from "features";

// Context-aware ads shown below the credit information of each AI job tab (webknossos.org only).

export function ProofreadingAd() {
  if (!features().isWkorgInstance) {
    return null;
  }
  return (
    <AdCard
      coverImage={{ src: proofreadingDendrites, alt: "Proofread dendrite segments" }}
      eyebrow="Proofreading"
      title="Proofread your segmentation."
      description="Fix split and merge errors on large segmentations with supervoxel-graph editing. Collaborative and near real time."
      ctaLabel="See proofreading tools"
      ctaHref="https://docs.webknossos.org/webknossos/proofreading/proofreading_tool.html"
    />
  );
}

export function CustomModelTrainingAd() {
  if (!features().isWkorgInstance) {
    return null;
  }
  return (
    <AdCard
      eyebrow="Consulting"
      title="Complex dataset? We can train a custom model for you."
      description="Our team generates training data and trains a custom model for data the pre-trained models cannot handle."
      ctaLabel="See segmentation services"
      ctaHref="https://home.webknossos.org/services/automated-segmentation"
    />
  );
}

export function AlignmentServicesAd() {
  if (!features().isWkorgInstance) {
    return null;
  }
  return (
    <AdCard
      eyebrow="Consulting"
      title="Large or multi-tile stacks? We align them for you."
      description="For big multi-SEM and multi-tile datasets, our team runs alignment and stitching for you."
      ctaLabel="See our alignment services"
      ctaHref="https://webknossos.org/services/alignment"
    />
  );
}
