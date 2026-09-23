export interface LogWorkModalSession {
  isOpen: boolean;
  taskId?: string;
}

export function shouldResetLogWorkModal(
  previous: LogWorkModalSession,
  next: LogWorkModalSession
) {
  return next.isOpen && (!previous.isOpen || previous.taskId !== next.taskId);
}
