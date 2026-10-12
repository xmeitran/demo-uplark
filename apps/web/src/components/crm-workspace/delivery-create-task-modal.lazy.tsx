"use client";

import { CreateTaskModal } from "./tasks-workbench";
import type { CreateTaskStageOption } from "./tasks-workbench";

export type DeliveryCreateTaskModalDefaults = {
  accountId?: string;
  projectId?: string;
  stageId?: string;
  taskType?: string;
  taskTypeLayer1?: "PRE_SALE" | "DELIVERY" | "PM";
  title?: string;
  description?: string;
};

export type DeliveryCreateTaskStageOption = CreateTaskStageOption;

export default CreateTaskModal;
