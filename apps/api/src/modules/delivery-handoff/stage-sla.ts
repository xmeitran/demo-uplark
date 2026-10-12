/**
 * Stage SLA in working days (8.1 template `slaDays`) with the customer-wait pause of V-19:
 * while the stage's gate waits for the customer the clock is stopped, and the days waited are counted
 * separately and pushed onto the due date instead of showing up as delay.
 */
import { addWorkingDays, workingDaysBetween } from "../../shared/working-days";

export interface StageSlaInput {
  slaDays?: number | null;
  /** When the stage started (actual, else planned). */
  startedAt?: Date | null;
  finishedAt?: Date | null;
  /** Set while the clock is stopped for a customer wait. */
  pausedAt?: Date | null;
  /** Working days of earlier, finished customer waits. */
  customerWaitDays?: number | null;
}

export interface StageSlaState {
  slaDays: number | null;
  /** Suggested due date: start + SLA + days waited for the customer, in working days. */
  dueAt?: Date;
  paused: boolean;
  customerWaitDays: number;
  overrun: boolean;
  overrunDays: number;
}

export function stageSlaState(input: StageSlaInput, now = new Date(), dayOffKeys: ReadonlySet<string> = new Set()): StageSlaState {
  const slaDays = Number.isFinite(Number(input.slaDays)) && input.slaDays !== null && input.slaDays !== undefined ? Math.max(0, Math.floor(Number(input.slaDays))) : null;
  const paused = Boolean(input.pausedAt) && !input.finishedAt;
  const waited = Math.max(0, input.customerWaitDays ?? 0) + (paused ? workingDaysBetween(input.pausedAt as Date, now, dayOffKeys) : 0);
  if (slaDays === null || !input.startedAt) return { slaDays, paused, customerWaitDays: waited, overrun: false, overrunDays: 0 };

  const dueAt = addWorkingDays(input.startedAt, slaDays + waited, dayOffKeys);
  // A stopped clock reads the moment it stopped: time passing during the wait never becomes delay.
  const measuredAt = input.finishedAt ?? (paused ? (input.pausedAt as Date) : now);
  const measuredDue = paused ? addWorkingDays(input.startedAt, slaDays + Math.max(0, input.customerWaitDays ?? 0), dayOffKeys) : dueAt;
  const overrun = measuredAt.getTime() > measuredDue.getTime();
  return { slaDays, dueAt, paused, customerWaitDays: waited, overrun, overrunDays: overrun ? workingDaysBetween(measuredDue, measuredAt, dayOffKeys) : 0 };
}

/** Working days a finished customer wait lasted, to add to the stage's separate counter. */
export function customerWaitWorkingDays(pausedAt: Date | null | undefined, resumedAt: Date, dayOffKeys: ReadonlySet<string> = new Set()): number {
  return pausedAt ? workingDaysBetween(pausedAt, resumedAt, dayOffKeys) : 0;
}
