-- Admin › Nhắc Lark › Danh sách người nhận: people switched off from the reminders. Everyone stays on by default.
ALTER TABLE "WorkspaceReminderPolicy" ADD COLUMN "excludedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
