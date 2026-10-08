-- The workspace operates P&L in VND. Older imported/demo rows were labelled
-- USD even though their amounts are VND-denominated. Normalize only the
-- currency label; monetary values are intentionally left unchanged.
UPDATE "ProjectBudget" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "ProjectCost" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "ProjectPlSnapshot" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "PaymentSchedule" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "Invoice" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "InvoicePayment" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "Contract" SET "currency" = 'VND' WHERE "currency" = 'USD';
UPDATE "ProposalPackage" SET "currency" = 'VND' WHERE "currency" = 'USD';
