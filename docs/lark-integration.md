# Lark integration: project groups, bots, personal leave

Rules: "Nguyên tắc nền tảng hệ thống PM" V-02, V-14, V-15, V-20, 7.5 (V-36, bảng "Bot và kênh nhận"), D-09.
Code: `apps/api/src/modules/lark-integration/`, worker `apps/worker/src/lark-direct-message.ts`, `lark-sweep-scheduler.ts`.

Nothing is sent to Lark until `LARK_MESSAGING_ENABLED=true` **and** `LARK_APP_ID` / `LARK_APP_SECRET` are set. Until
then every attempt is written to the table `LarkDeliveryLog` with status `disabled` and the note "chưa bật kênh Lark".
CRM no longer creates project groups or synchronizes their members. Existing group IDs are still used when sending
project notifications.

## Lark app: what the owner must grant

The custom app of `LARK_APP_ID` needs the **Bot** capability switched on and these tenant scopes (Developer Console →
Permissions & Scopes; publish a new app version after adding them):

| Scope | Used for |
|---|---|
| `im:chat` | create the two project groups, add and remove members |
| `im:chat:readonly` | read a group's members before syncing them |
| `im:message:send_as_bot` (or `im:message`) | bot messages to groups and private messages to people |
| `approval:approval:readonly` | read the instances of the leave Approval |
| `contact:user.id:readonly` | already used: map people to `open_id` |

Also required on the Lark side:

- The app's **availability range** must include every employee, or private messages fail with "Bot has NO availability to this user".
- The bot must be **added to the two fixed groups** it posts to (see `LARK_HANDOFF_REVIEW_CHAT_ID`).
- Customer contacts are outside the tenant. The app creates the customer group with the internal people who talk to
  the customer (PIC, BD, creator); the PM invites the customer contacts in Lark (the tenant must allow external groups).
- The Approval definition used for leave must contain the standard leave control (`leaveGroup` / `leaveGroupV2`).

## Environment keys

| Key | Service | Meaning |
|---|---|---|
| `LARK_MESSAGING_ENABLED` | api, worker | `true` switches the channel on. Anything else = off. |
| `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_OPEN_API_BASE_URL` | api, worker | existing app credentials |
| `LARK_HANDOFF_REVIEW_CHAT_ID` | api | chat id (`oc_…`) of the group "Xét duyệt chuyển tiếp giai đoạn dự án" (PM, Dx Director). Empty = only the repost to the project's internal group is sent. |
| `LARK_LEAVE_APPROVAL_CODE` | api | approval code of the leave Approval definition. Empty = no leave sync. |
| `LARK_LEAVE_SYNC_LOOKBACK_DAYS` | api | how far back instances are re-read (default 60) |
| `LARK_SWEEP_TOKEN` | api, worker | secret of `POST /api/internal/lark-sweep` (falls back to `ALERT_SCAN_TOKEN`) |
| `LARK_SWEEP_ENABLED`, `LARK_SWEEP_INTERVAL_MINUTES`, `LARK_SWEEP_API_URL` | worker | the worker calls the sweep every N minutes (default 60) |
| `PUBLIC_APP_URL` | api | origin of the links in the cards |
| `LARK_PROJECT_ALERT_WEBHOOK_URL` | api | existing: webhook of the group "Quản lý dự án" for project warnings |

Deployments without a worker (Render) call the sweep from a cron, e.g. hourly:

    curl -fsS -X POST -H "x-lark-sweep-token: $LARK_SWEEP_TOKEN" https://<api-host>/api/internal/lark-sweep

## Bots and routing

| Bot | Channel | When | Template (`lark-templates.ts`) |
|---|---|---|---|
| Hồ sơ chuyển tiếp | review group, reposted to the internal group | G1–G8 submitted; result; one reminder after "Hạn duyệt hồ sơ chuyển tiếp" naming the Admins (V-15) | `handoffSubmittedCard`, `handoffResultCard`, `handoffReviewOverdueCard` |
| Xác nhận khách hàng | customer group | G1, G2, G4, G7 approved internally; one reminder per working day, at most "Số lần nhắc tối đa trong nhóm khách hàng" (2); later reminders go to the internal group only | `customerConfirmationRequestCard`, `customerConfirmationReminderCard` |
| Trạng thái dự án | internal group | proposal created; confirmed / declined; one reminder after "Hạn xác nhận đề xuất trạng thái" (V-20) | `statusProposalCard`, `statusProposalDecidedCard`, `statusProposalReminderCard` |
| Sổ vấn đề dự án | internal group, mentions PM (PIC) and the project's BD | new record; severity changed; escalated | `issueLogCard` |
| Cảnh báo dự án | internal group of the project when the message is about one project that has one; otherwise the "Quản lý dự án" webhook | daily alert scan | `projectAlertCard` |
| Nhắc việc hằng ngày | private message per person and PM; group webhook when messaging is off or the private message fails | 08:30, 14:00, 17:00 | worker cards |

The customer group receives only the "Xác nhận khách hàng" messages (V-36).

Messages that follow an event are sent by one idempotent sweep (`LarkIntegrationService.sweep`): hooks call it for the
project right after the change, the scheduled call covers reminders and anything missed. "Sent once" is a dedupe key in
`LarkDeliveryLog`; a failed send is retried on later sweeps at most three times.

## Project groups (V-02)

CRM does not create project groups or manage their membership. If a project already has `larkInternalChatId` or
`larkCustomerChatId`, the notification sweep continues to use those existing chats. Group creation, naming and member
management are handled outside CRM.

## Personal leave (D-09)

- Source: APPROVED instances of `LARK_LEAVE_APPROVAL_CODE`, mirrored to `PersonalLeave` by the sweep and by
  Admin › Ngày nghỉ › "Đồng bộ ngay" (`POST /api/admin/personal-leave/sync`). An instance that is withdrawn later
  turns its row to `cancelled`.
- Effect: the day's cap of D-13 is reduced by the leave — a full day leaves 0 minutes (logging is refused), and the
  person is not reminded.
- **Assumption**: the document does not define half days. A leave that starts at or after 12:00 or ends at or before
  12:00 counts as half of "Giờ chuẩn một ngày" on that day.
