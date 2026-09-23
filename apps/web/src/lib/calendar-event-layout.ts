const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";

export type CalendarLayoutEvent = {
  id: string;
  startAt: string;
  endAt: string;
};

export type CalendarOverlapPlacement = {
  colIndex: number;
  totalCols: number;
};

export type CalendarEventGeometry = {
  top: number;
  height: number;
};

const vietnamClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: VIETNAM_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function vietnamMinuteOfDay(value: string) {
  const parts = vietnamClockFormatter.formatToParts(new Date(value));
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function getCalendarEventGeometry(
  event: CalendarLayoutEvent,
  options: { startHour: number; endHour: number; hourRowHeight: number; minimumHeight?: number }
): CalendarEventGeometry {
  const gridStartMinute = options.startHour * 60;
  const gridEndMinute = options.endHour * 60;
  const gridHeight = (options.endHour - options.startHour) * options.hourRowHeight;
  const startMinute = vietnamMinuteOfDay(event.startAt);
  const durationMinutes = Math.max(1, Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000));
  const visibleStart = Math.min(gridEndMinute, Math.max(gridStartMinute, startMinute));
  const visibleEnd = Math.min(gridEndMinute, Math.max(visibleStart, startMinute + durationMinutes));
  const top = Math.min(gridHeight, Math.max(0, ((visibleStart - gridStartMinute) / 60) * options.hourRowHeight));
  const temporalHeight = ((visibleEnd - visibleStart) / 60) * options.hourRowHeight;
  const requestedHeight = Math.max(options.minimumHeight ?? 32, temporalHeight) - 2;

  return {
    top,
    height: Math.max(1, Math.min(requestedHeight, gridHeight - top))
  };
}

export function computeCalendarOverlapLayout<T extends CalendarLayoutEvent>(
  events: T[]
): Map<string, CalendarOverlapPlacement> {
  const layout = new Map<string, CalendarOverlapPlacement>();
  const sorted = [...events].sort((left, right) => {
    const startDelta = Date.parse(left.startAt) - Date.parse(right.startAt);
    if (startDelta !== 0) return startDelta;
    const durationDelta = Date.parse(right.endAt) - Date.parse(right.startAt) - (Date.parse(left.endAt) - Date.parse(left.startAt));
    return durationDelta !== 0 ? durationDelta : left.id.localeCompare(right.id);
  });

  const clusters: T[][] = [];
  let cluster: T[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  for (const event of sorted) {
    const start = Date.parse(event.startAt);
    const end = Date.parse(event.endAt);
    if (cluster.length === 0 || start < clusterEnd) {
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, end);
    } else {
      clusters.push(cluster);
      cluster = [event];
      clusterEnd = end;
    }
  }
  if (cluster.length > 0) clusters.push(cluster);

  for (const currentCluster of clusters) {
    const columns: T[][] = [];
    for (const event of currentCluster) {
      const availableColumn = columns.find(column => Date.parse(column[column.length - 1].endAt) <= Date.parse(event.startAt));
      if (availableColumn) availableColumn.push(event);
      else columns.push([event]);
    }
    columns.forEach((column, colIndex) => {
      for (const event of column) layout.set(event.id, { colIndex, totalCols: columns.length });
    });
  }

  return layout;
}

export function getCalendarCardDensity(height: number, overlapLanes: number): "micro" | "compact" | "full" {
  if (height < 64 || overlapLanes >= 3) return "micro";
  if (height < 96 || overlapLanes === 2) return "compact";
  return "full";
}

export function splitDateRangeIntoChunks(startAt: string, endAt: string, maximumDays = 89) {
  const chunks: Array<{ startAt: string; endAt: string }> = [];
  const end = new Date(endAt);
  let cursor = new Date(startAt);
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + maximumDays * 24 * 60 * 60 * 1000));
    chunks.push({ startAt: cursor.toISOString(), endAt: chunkEnd.toISOString() });
    cursor = chunkEnd;
  }
  return chunks;
}
