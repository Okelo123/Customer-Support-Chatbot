export interface BugReport {
  ticketId: string;
  description: string;
  stepsToReproduce: string;
  environment: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCallRecord[];
  timestamp: string;
}
