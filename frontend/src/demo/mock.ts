export function mockTool(name: string, args: Record<string, unknown>) {
  let hash = 2166136261;
  for (const ch of JSON.stringify(args)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const id = (hash >>> 0).toString(16).toUpperCase();
  return { simulated: true, tool: name, reference: `DEMO-${id}`, ...args };
}
