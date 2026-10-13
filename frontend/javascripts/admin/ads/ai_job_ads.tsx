import proofreadingDendrites from "@images/vx/proofreading-dendrites.webp";
import AdCard from "admin/ads/ad_card";

// Next step shown in the job-started card of the "Run Segmentation Model" tab. Callers gate it
// to webknossos.org.

export function ProofreadingAd() {
  return (
    <AdCard
      embedded
      coverImage={{ src: proofreadingDendrites, alt: "Proofread dendrite segments" }}
      eyebrow="Next step · Proofreading"
      title="Proofread your segmentation."
      description="Fix split and merge errors on large segmentations with supervoxel-graph editing. Collaborative and near real time."
      ctaLabel="See proofreading tools"
      ctaHref="https://docs.webknossos.org/webknossos/proofreading/proofreading_tool.html"
    />
  );
}
