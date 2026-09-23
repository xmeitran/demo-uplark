export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function FinancePaymentSchedulePage({ params }: { params: Promise<{ paymentScheduleId: string }> }) {
  const { paymentScheduleId } = await params;
  const { FinanceScheduleDetailPage } = await import("../../../src/components/crm-workspace/finance-workbench");
  return <FinanceScheduleDetailPage paymentScheduleId={paymentScheduleId} />;
}
