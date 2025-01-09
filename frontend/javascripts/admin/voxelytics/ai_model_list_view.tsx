import { PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { getAiModels } from "admin/admin_rest_api";
import { JobState } from "admin/job/job_list_view";
import { Button, Modal, Space, Table } from "antd";
import FormattedDate from "components/formatted_date";
import { PageNotAvailableToNormalUser } from "components/permission_enforcer";
import { useGuardedFetch } from "libs/react_helpers";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import {
	getMagInfo,
	getSegmentationLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import { formatUserName } from "oxalis/model/accessors/user_accessor";
import type { OxalisState } from "oxalis/store";
import {
	type AnnotationInfoForAITrainingJob,
	TrainAiModelTab,
} from "oxalis/view/jobs/train_ai_model";
import { useState } from "react";
import type { Key } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import type { APIAnnotation, AiModel } from "types/api_flow_types";

export default function AiModelListView() {
	const activeUser = useSelector((state: OxalisState) => state.activeUser);
	const [refreshCounter, setRefreshCounter] = useState(0);
	const [isTrainModalVisible, setIsTrainModalVisible] = useState(false);
	const [aiModels, isLoading] = useGuardedFetch(
		getAiModels,
		[],
		[refreshCounter],
		"Could not load model list.",
	);

	if (!activeUser?.isSuperUser) {
		return <PageNotAvailableToNormalUser />;
	}

	return (
		<div className="container voxelytics-view">
			{isTrainModalVisible ? (
				<TrainNewAiJobModal onClose={() => setIsTrainModalVisible(false)} />
			) : null}
			<div className="pull-right">
				<Space>
					<Button onClick={() => setIsTrainModalVisible(true)}>
						<PlusOutlined /> Train new Model
					</Button>
					<Button onClick={() => setRefreshCounter((val) => val + 1)}>
						<SyncOutlined spin={isLoading} /> Refresh
					</Button>
				</Space>
			</div>
			<h3>AI Models</h3>
			<Table
				bordered
				rowKey={(run: AiModel) => `${run.id}`}
				pagination={{ pageSize: 100 }}
				columns={[
					{
						title: "Name",
						dataIndex: "name",
						key: "name",
					},
					{
						title: "Created at",
						key: "created",
						defaultSortOrder: "descend",
						sorter: (a: AiModel, b: AiModel) => a.created - b.created,
						render: (model: AiModel) => (
							<FormattedDate timestamp={model.created} />
						),
					},
					{
						title: "User",
						dataIndex: "user",
						key: "user",
						render: (user: AiModel["user"]) => formatUserName(activeUser, user),
						filters: _.uniq(
							aiModels.map((model) => formatUserName(null, model.user)),
						).map((username) => ({
							text: username,
							value: username,
						})),
						onFilter: (value: Key | boolean, model: AiModel) =>
							formatUserName(null, model.user).startsWith(String(value)),
						filterSearch: true,
					},
					{
						title: "Status",
						dataIndex: "trainingJob",
						key: "status",
						render: (trainingJob: AiModel["trainingJob"]) =>
							trainingJob && <JobState job={trainingJob} />,
					},
					{
						title: "Comment",
						dataIndex: "comment",
						key: "comment",
					},
					{
						title: "Actions",
						render: renderActionsForModel,
						key: "actions",
					},
				]}
				dataSource={aiModels}
			/>
		</div>
	);
}

function TrainNewAiJobModal({ onClose }: { onClose: () => void }) {
	const [annotationInfosForAiJob, setAnnotationInfosForAiJob] = useState<
		AnnotationInfoForAITrainingJob<APIAnnotation>[]
	>([]);

	const getMagsForSegmentationLayer = (
		annotationId: string,
		layerName: string,
	) => {
		// The layer name is a human-readable one. It can either belong to an annotationLayer
		// (therefore, also to a volume tracing) or to the actual dataset.
		// Both are checked below. This won't be ambiguous because annotationLayers must not
		// have names that dataset layers already have.

		const annotationWithDataset = annotationInfosForAiJob.find(
			({ annotation }) => {
				return annotation.id === annotationId;
			},
		);
		if (annotationWithDataset == null) {
			throw new Error("Cannot find annotation for specified id.");
		}

		const { annotation, dataset, volumeTracings, volumeTracingMags } =
			annotationWithDataset;

		let annotationLayer = annotation.annotationLayers.find(
			(l) => l.name === layerName,
		);
		if (annotationLayer != null) {
			const volumeTracingIndex = volumeTracings.findIndex(
				(tracing) => tracing.tracingId === annotationLayer.tracingId,
			);
			const mags =
				volumeTracingMags[volumeTracingIndex] || ([[1, 1, 1]] as Vector3[]);
			return getMagInfo(mags);
		} else {
			const segmentationLayer = getSegmentationLayerByName(dataset, layerName);
			return getMagInfo(segmentationLayer.resolutions);
		}
	};

	return (
		<Modal
			width={875}
			open
			title={
				<>
					<i className="fas fa-magic icon-margin-right" />
					AI Analysis
				</>
			}
			onCancel={onClose}
			footer={null}
			maskClosable={false}
		>
			<TrainAiModelTab
				getMagsForSegmentationLayer={getMagsForSegmentationLayer}
				onClose={onClose}
				annotationInfos={annotationInfosForAiJob}
				onAddAnnotationsInfos={(newItems) => {
					setAnnotationInfosForAiJob([...annotationInfosForAiJob, ...newItems]);
				}}
			/>
		</Modal>
	);
}

const renderActionsForModel = (model: AiModel) => {
	if (model.trainingJob == null) {
		return;
	}
	const { voxelyticsWorkflowHash, trainingAnnotations } = model.trainingJob;

	return (
		<div>
			{voxelyticsWorkflowHash != null ? (
				<>
					<Link to={`/workflows/${voxelyticsWorkflowHash}`}>
						Voxelytics Report
					</Link>
					<br />
				</>
			) : null}
			{trainingAnnotations == null ? null : trainingAnnotations.length > 1 ? (
				<a
					href="#"
					onClick={() => {
						Modal.info({
							content: (
								<div>
									The following annotations were used during training:
									<ul>
										{trainingAnnotations.map(
											(annotation: { annotationId: string }, index: number) => (
												<li key={`annotation_${index}`}>
													<a
														href={`/annotations/${annotation.annotationId}`}
														target="_blank"
														rel="noreferrer noopener"
													>
														Annotation {index + 1}
													</a>
												</li>
											),
										)}
									</ul>
								</div>
							),
						});
					}}
				>
					Show Training Data
				</a>
			) : (
				<a
					href={`/annotations/${trainingAnnotations[0].annotationId}`}
					target="_blank"
					rel="noreferrer noopener"
				>
					Show Training Data
				</a>
			)}
		</div>
	);
};
