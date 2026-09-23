import { DeliveryBusinessFunctionPage } from "../../src/components/crm-workspace/delivery-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function DeliveryPage() {
  return <DeliveryBusinessFunctionPage />;
}
