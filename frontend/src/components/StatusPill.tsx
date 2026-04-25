type StatusPillProps = {
  status: string;
};

export function StatusPill({ status }: StatusPillProps) {
  const className = `status-pill status-${status.replace(/\s+/g, "-").toLowerCase()}`;
  return <span className={className}>{status}</span>;
}
