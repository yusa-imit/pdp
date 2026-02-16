export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function text(content: string, status = 200) {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
