import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

type RevalidateBody = {
  tags?: string[];
  paths?: string[];
  reason?: string;
};

function unauthorized() {
  return NextResponse.json(
    { success: false, error: { code: "UNAUTHORIZED", message: "Invalid secret" } },
    { status: 401 },
  );
}

export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MISCONFIGURED",
          message: "REVALIDATE_SECRET is not configured",
        },
      },
      { status: 503 },
    );
  }

  const headerSecret =
    req.headers.get("x-revalidate-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!headerSecret || headerSecret !== secret) {
    return unauthorized();
  }

  let body: RevalidateBody;
  try {
    body = (await req.json()) as RevalidateBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Invalid JSON body" },
      },
      { status: 400 },
    );
  }

  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map(String).filter(Boolean))]
    : [];
  const paths = Array.isArray(body.paths)
    ? [...new Set(body.paths.map(String).filter(Boolean))]
    : [];

  if (tags.length === 0 && paths.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Provide at least one tag or path",
        },
      },
      { status: 400 },
    );
  }

  const revalidated = { tags: [] as string[], paths: [] as string[] };

  for (const tag of tags) {
    try {
      revalidateTag(tag, "max");
      revalidated.tags.push(tag);
    } catch (err) {
      console.error("[revalidate] tag failed", tag, err);
    }
  }

  for (const path of paths) {
    try {
      revalidatePath(path);
      revalidated.paths.push(path);
    } catch (err) {
      console.error("[revalidate] path failed", path, err);
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      revalidated,
      reason: body.reason || null,
      at: new Date().toISOString(),
    },
    message: "Cache revalidation requested",
  });
}
