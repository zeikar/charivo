import { create } from "zustand";

export const LIVE2D_MODELS = [
  "Haru",
  "Hiyori",
  "Mao",
  "Mark",
  "Natori",
  "Rice",
  "Wanko",
] as const;

export type Live2DModel = (typeof LIVE2D_MODELS)[number];

type Live2DStore = {
  selectedModel: Live2DModel;
  setSelectedModel: (model: Live2DModel) => void;
  getModelPath: (model: Live2DModel) => string;
};

export const useLive2DStore = create<Live2DStore>((set) => ({
  selectedModel: "Hiyori",
  setSelectedModel: (model) => set({ selectedModel: model }),
  getModelPath: (model) =>
    `/live2d/${model}/${model.toLowerCase()}.model3.json`,
}));
