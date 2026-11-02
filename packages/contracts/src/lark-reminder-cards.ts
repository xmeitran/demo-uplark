/**
 * The Lark reminder cards, built from plain data: one source for the worker's scheduled reminders, the API's manual
 * sends and "Gửi nhắc lần 2", and the Admin preview. A card tags people only when it goes to a group webhook; pass
 * no open_id for a private message.
 */
// Only used inside functions, so the index <-> this module import cycle is safe.
import { normalizeBusinessRole } from "./index";

// A type alias, not an interface, so a card passes wherever a plain record payload is expected.
export type LarkReminderCard = {
  msg_type: "interactive";
  card: {
    config: { wide_screen_mode: true };
    header: { template: string; title: { tag: "plain_text"; content: string } };
    elements: Array<Record<string, unknown>>;
  };
};

export interface LarkReminderPlannedTask {
  title: string;
  projectName?: string;
  minutes: number;
  done: boolean;
}

export interface LarkReminderFieldIssue {
  taskTitle: string;
  projectName?: string;
  missingFields: string[];
}

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const EVERYONE_NOTE = "gửi mọi người; ngày nghỉ và người nghỉ phép cả ngày được bỏ qua.";
const SYSTEM_ROLE_CODES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN", "WORKSPACE_USER"]);

/** Today's planned Tasks, one per Task: several blocks of one Task add up, and it is done when every block is completed. */
export function larkReminderPlannedTasks(blocks: Array<{ taskId: string; plannedMinutes: number; status?: string; taskTitle?: string; projectName?: string }>): LarkReminderPlannedTask[] {
  const tasks = new Map<string, LarkReminderPlannedTask>();
  for (const block of blocks) {
    const task = tasks.get(block.taskId) ?? { title: block.taskTitle ?? "Task", projectName: block.projectName, minutes: 0, done: true };
    tasks.set(block.taskId, { ...task, minutes: task.minutes + block.plannedMinutes, done: task.done && block.status === "completed" });
  }
  return [...tasks.values()];
}

/** "Thứ Hai, 02/11/2026" */
export function larkReminderDayLabel(localDate: string) {
  const [year, month, day] = localDate.split("-");
  return `${WEEKDAYS[new Date(`${localDate}T00:00:00Z`).getUTCDay()]}, ${day}/${month}/${year}`;
}

export function larkReminderHours(minutes: number) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} giờ`;
}

/** The role the People page shows: profile role, else department, else the first non-system role code; none when unassigned. */
export function larkReminderRole(person: { displayRole?: string | null; departmentCode?: string | null; roleCodes?: readonly string[] }) {
  const role = normalizeBusinessRole(person.displayRole ?? person.departmentCode ?? person.roleCodes?.find((code) => !SYSTEM_ROLE_CODES.has(code)));
  return role === "Chưa gán" ? undefined : role;
}

function greeting(displayName: string, mentionOpenId?: string) {
  return `${mentionOpenId ? `<at id=${mentionOpenId}></at> ` : ""}Chào **${displayName}**,`;
}

function card(template: string, title: string, lines: string[], footer: string, button: { text: string; url: string }): LarkReminderCard {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template, title: { tag: "plain_text", content: title } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
        { tag: "hr" },
        { tag: "note", elements: [{ tag: "plain_text", content: footer }] },
        { tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: button.text }, url: button.url }] }
      ]
    }
  };
}

/** Đầu ngày, to everyone: plan today's Tasks; lists a planned Task that lacks a field. */
export function larkPlanCard(input: { displayName: string; mentionOpenId?: string; localDate: string; fieldIssues?: LarkReminderFieldIssue[]; linkUrl: string }) {
  const fieldIssues = input.fieldIssues ?? [];
  return card("blue", "Lập kế hoạch Task hôm nay", [
    greeting(input.displayName, input.mentionOpenId),
    `Hôm nay, ${larkReminderDayLabel(input.localDate)}, vui lòng lập kế hoạch các Task sẽ làm trong ngày và ghi giờ kế hoạch cho từng Task.`,
    ...(fieldIssues.length ? ["", "Task cần bổ sung thông tin:", ...fieldIssues.slice(0, 5).map((task) => `• **${task.taskTitle}**${task.projectName ? ` · ${task.projectName}` : ""} — còn thiếu: ${task.missingFields.join(", ")}`)] : []),
    ...(fieldIssues.length > 5 ? [`• Và ${fieldIssues.length - 5} Task khác.`] : [])
  ], `Nhắc đầu ngày · ${EVERYONE_NOTE}`, { text: "Lập kế hoạch hôm nay", url: input.linkUrl });
}

/**
 * Cuối ngày, to everyone. With a plan: finish the Tasks planned today (each with its project and status). Without one:
 * plan today's Tasks and finish them.
 */
export function larkFinishPlanCard(input: { displayName: string; mentionOpenId?: string; localDate: string; tasks: LarkReminderPlannedTask[]; actualMinutes: number; targetMinutes: number; linkUrl: string }) {
  const { tasks } = input;
  const day = larkReminderDayLabel(input.localDate);
  const footer = `Nhắc cuối ngày · ${EVERYONE_NOTE}`;
  if (!tasks.length) {
    return card("red", "Yêu cầu lập kế hoạch và hoàn thành Task hôm nay", [
      greeting(input.displayName, input.mentionOpenId),
      `Đến cuối ngày ${day}, bạn chưa có kế hoạch Task nào trong ngày.`,
      "",
      "Vui lòng:",
      "1. Lập kế hoạch các Task đã làm hôm nay (Task, dự án và giờ kế hoạch).",
      "2. Bấm “Hoàn thành kế hoạch” cho từng Task để ghi giờ thực tế."
    ], footer, { text: "Lập và hoàn thành kế hoạch", url: input.linkUrl });
  }
  const open = tasks.filter((task) => !task.done);
  return card(open.length ? "orange" : "green", open.length ? "Hoàn thành Task hôm nay" : "Kế hoạch hôm nay đã hoàn thành", [
    greeting(input.displayName, input.mentionOpenId),
    open.length
      ? `Cuối ngày ${day}, vui lòng hoàn thành các Task đã lập kế hoạch hôm nay và bấm “Hoàn thành kế hoạch” trên Calendar để ghi giờ thực tế.`
      : `Bạn đã hoàn thành toàn bộ kế hoạch ngày ${day}. Cảm ơn bạn!`,
    "",
    "Task đã lập kế hoạch hôm nay:",
    ...tasks.slice(0, 8).map((task, index) => `${index + 1}. **${task.title}**\n    Dự án: ${task.projectName ?? "Không thuộc dự án"} · Kế hoạch: ${larkReminderHours(task.minutes)} · ${task.done ? "Đã hoàn thành" : "**Chưa hoàn thành**"}`),
    ...(tasks.length > 8 ? [`Và ${tasks.length - 8} Task khác.`] : []),
    "",
    `• Còn ${open.length}/${tasks.length} Task chưa hoàn thành`,
    `• Giờ thực tế đã ghi: ${larkReminderHours(input.actualMinutes)} / ${larkReminderHours(input.targetMinutes)}`
  ], footer, { text: "Hoàn thành kế hoạch hôm nay", url: input.linkUrl });
}

/** Buổi trưa, to the PMs: who still has no plan today (name and role), and one button that reminds them a second time. */
export function larkPmListCard(input: { people: Array<{ displayName: string; role?: string }>; localDate: string; time: string; mentionOpenIds?: string[]; nudgeUrl: string }) {
  return card("orange", "Nhân sự chưa lập kế hoạch Task hôm nay", [
    `${(input.mentionOpenIds ?? []).map((openId) => `<at id=${openId}></at> `).join("")}Chào PM,`,
    `Đến ${input.time}, ${larkReminderDayLabel(input.localDate)}, có **${input.people.length} nhân sự** chưa lập kế hoạch Task trong ngày:`,
    "",
    ...input.people.map((person, index) => `${index + 1}. **${person.displayName}** · ${person.role ?? "Chưa gán vai trò"}`),
    "",
    "Bấm “Gửi nhắc lần 2” để nhắc riêng những người vẫn chưa lập kế hoạch tại thời điểm bấm."
  ], "Danh sách được kiểm tra lại khi bấm; mỗi người nhận nhắc lần 2 tối đa một lần mỗi ngày.", { text: "Gửi nhắc lần 2", url: input.nudgeUrl });
}

/** "Gửi nhắc lần 2" from the PM card: one private card per person who still has no plan. */
export function larkSecondReminderCard(input: { displayName: string; localDate: string; time: string; pmName: string; linkUrl: string }) {
  return card("orange", "Nhắc lần 2: lập kế hoạch Task hôm nay", [
    greeting(input.displayName),
    `Đến ${input.time}, ${larkReminderDayLabel(input.localDate)}, bạn vẫn chưa lập kế hoạch Task cho hôm nay. Đây là lần nhắc thứ 2.`,
    "",
    "Vui lòng lập kế hoạch các Task trong ngày và ghi giờ kế hoạch cho từng Task ngay."
  ], `Gửi theo yêu cầu của PM ${input.pmName}.`, { text: "Lập kế hoạch hôm nay", url: input.linkUrl });
}
