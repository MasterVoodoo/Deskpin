export interface GTask {
  id: string;
  title?: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  /** RFC 3339 at midnight UTC; only the date part is meaningful. */
  due?: string;
  completed?: string;
  updated?: string;
  parent?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export interface Task extends GTask {
  listId: string;
}

export interface TaskList {
  id: string;
  title: string;
}

export interface Calendar {
  id: string;
  summary?: string;
  selected?: boolean;
}

export interface EventTime {
  date?: string;
  dateTime?: string;
}

export interface CalEvent {
  id: string;
  summary?: string;
  status?: string;
  start: EventTime;
  end: EventTime;
  htmlLink: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

export interface Snapshot {
  tasks: Task[];
  events: CalEvent[];
  syncedAt: string;
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string | null;
  completed?: string | null;
}
