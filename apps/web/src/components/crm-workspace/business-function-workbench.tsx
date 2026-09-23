"use client";

import { BusinessPlaceholderWorkbench } from "./business-placeholder-workbench";
import { DeliveryBusinessFunctionPage } from "./delivery-workbench";
import { ProposalBusinessFunctionPage } from "./proposal-workbench";
import type { BusinessFunctionKey } from "./business-function-config";

export function BusinessFunctionWorkbench({
  area,
  projectId
}: Readonly<{ area: BusinessFunctionKey; projectId?: string }>) {
  if (area === "delivery") {
    return <DeliveryBusinessFunctionPage projectId={projectId} />;
  }

  if (area === "proposals") {
    return <ProposalBusinessFunctionPage />;
  }

  return <BusinessPlaceholderWorkbench area={area} />;
}
