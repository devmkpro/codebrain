export type OperationsLane = "working" | "attention" | "ready" | "idle";

export interface OperationalActor {
  pane_id: string;
  parent_pane_id?: string | null;
  agent?: string | null;
  label?: string | null;
  description?: string | null;
  status: string;
  workspace?: string | null;
  cwd?: string | null;
  provider_id?: string | null;
  model?: string | null;
  role?: string | null;
  mission_id?: string | null;
  turn_count?: number;
  last_turn_time?: number;
  last_outcome?: string | null;
  last_error?: string | null;
  time_created?: number;
  time_updated?: number;
  live?: boolean;
}

export interface OperationalTask {
  id: string;
  title: string;
  description?: string;
  column_name: string;
  assigned_to?: string | null;
  priority?: string;
  result?: string | null;
  workspace?: string | null;
  mission_id?: string | null;
  created_at?: number;
  updated_at?: number;
  completed_at?: number | null;
}

export interface OperationalHandoff {
  id: string;
  pane_id: string;
  summary?: string;
  status: "done" | "blocked" | "error";
  artifacts?: string[];
  submitted_at: number;
  workspace?: string | null;
}

export interface OperationalMessage {
  id: string;
  from_pane: string;
  to_pane: string;
  content: string;
  type: string;
  task_id?: string | null;
  parent_id?: string | null;
  read: number;
  created_at: number;
  workspace?: string | null;
}

export interface OperationalActivity {
  id: string;
  kind: "message" | "handoff" | "event" | "actor";
  at: number;
  paneId?: string;
  label?: string;
  text: string;
  status?: string;
}

export interface OperationalMission {
  id: string;
  title: string;
  summary?: string;
  status: string;
  workspace: string;
  worktreePath?: string | null;
  source: "backend" | "derived";
  lane: OperationsLane;
  actorIds: string[];
  orchestratorId?: string | null;
  counts: {
    actors: number;
    running: number;
    attention: number;
    tasks: number;
    tasksDone: number;
    handoffs: number;
    messages: number;
  };
  latestActivity?: OperationalActivity;
}

export interface OperationsSnapshot {
  ok: boolean;
  workspace: string;
  generatedAt: number;
  missions: OperationalMission[];
  actors: OperationalActor[];
  tasks: OperationalTask[];
  handoffs: OperationalHandoff[];
  messages: OperationalMessage[];
  activities: OperationalActivity[];
  totals: {
    actors: number;
    running: number;
    attention: number;
    tasks: number;
    handoffs: number;
    messages: number;
  };
  error?: string;
}
