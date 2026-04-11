import { redirect } from "next/navigation";
import { requireSessionFromCookies } from "@/lib/auth";
import { db } from "@/db";
import { users, user_streak, pending_digests } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import ChatInterface from "@/components/ChatInterface";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  // Verify session server-side
  let session;
  try {
    session = await requireSessionFromCookies();
  } catch {
    redirect("/");
  }

  const { userId } = await params;
  const routeUserId = Number(userId);

  // Guard: logged-in user must match route userId
  if (session.userId !== routeUserId) {
    redirect("/");
  }

  // Fetch user, streak, and pending digest in parallel
  const [userRow, streakRow, digestRow] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        goal: users.goal,
        gender: users.gender,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, routeUserId))
      .then((rows) => rows[0] ?? null),
    db
      .select({ consecutive_weeks: user_streak.consecutive_weeks })
      .from(user_streak)
      .where(eq(user_streak.user_id, routeUserId))
      .then((rows) => rows[0] ?? null),
    db
      .select({ digest_text: pending_digests.digest_text })
      .from(pending_digests)
      .where(
        and(
          eq(pending_digests.user_id, routeUserId),
          isNull(pending_digests.shown_at)
        )
      )
      .orderBy(pending_digests.created_at)
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!userRow) redirect("/");

  return (
    <ChatInterface
      user={userRow}
      streak={streakRow?.consecutive_weeks ?? 0}
      pendingDigest={digestRow?.digest_text ?? null}
    />
  );
}
