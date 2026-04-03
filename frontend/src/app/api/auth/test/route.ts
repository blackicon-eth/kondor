export async function GET(request: Request) {
  const userId = request.headers.get("x-privy-user-id");

  return Response.json({
    authenticated: true,
    userId,
  });
}
