export type CallEvent = {
  ts: string;
  type: string;
  message: string;
  data: Record<string, unknown>;
};
