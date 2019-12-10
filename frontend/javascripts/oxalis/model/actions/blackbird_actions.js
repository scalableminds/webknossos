// @flow
type TrainClassifierAction = { type: "TRAIN_CLASSIFIER" };
type PredictAction = { type: "PREDICT" };

export type BlackbirdAction = TrainClassifierAction | PredictAction;

export const trainClassifierAction = (): TrainClassifierAction => ({ type: "TRAIN_CLASSIFIER" });
export const predictAction = (): PredictAction => ({ type: "PREDICT" });
